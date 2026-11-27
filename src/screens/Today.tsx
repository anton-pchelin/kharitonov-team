import { useEffect, useState, useSyncExternalStore } from 'react'
import { createCatalogExercise, supabase, type Profile } from '../supabase'
import { exactExercise, searchExercises, type Exercise } from '../search'
import { loadExercises } from './Exercises'
import { WorkoutView, progress } from './WorkoutView'
import { OfflineStore, type ItemEdit } from '../lib/offline'
import { prepareVideo, putBlob } from '../lib/videoUpload'
import { Timer } from './Timer'
import { TimerFields } from './TimerFields'
import { defaultTimer, type TimerCfg } from '../lib/timer'
import type { WorkoutItem } from '../lib/workout'
import { addDays, dayShort, fmtDay, mondayOf, parseIso, today, weekDays } from '../lib/dates'
import { fmtNum } from '../lib/format'
import { COMPLEX_RESULTS, MAX_RESULT_ROWS, RESULT_TYPES, complexName, complexPerRound, complexRounds, complexTimerRounds, complexTitle, isComplex, type ResultType, type Workout } from '../lib/workout'

const stores = new Map<string, OfflineStore>()
export const storeFor = (userId: string) => {
  if (!stores.has(userId)) stores.set(userId, new OfflineStore(userId))
  return stores.get(userId)!
}

const STATUS = { synced: '✓ отправлено', pending: 'отправляется…', offline: '● без сети — сохранится позже' }

/** «Тренировки» атлета: день списком, ввод подходов, свои упражнения и тренировки. Работает без сети. */
export function Today({ profile, date: routeDate }: { profile: Profile; date?: string }) {
  const store = storeFor(profile.id)
  const data = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [coachName, setCoachName] = useState('Тренер')
  const [timer, setTimer] = useState<WorkoutItem | null>(null)
  const [freeTimer, setFreeTimer] = useState<'setup' | 'running' | null>(null)
  const [freeConfig, setFreeConfig] = useState<TimerCfg | null>(() => defaultTimer('fortime'))
  const [editId, setEditId] = useState<string | null>(null)
  const date = routeDate ?? today()
  const go = (d: string) => { location.hash = `#/today/${d}` }

  useEffect(() => {
    store.flush()
    loadExercises().then(setExercises, () => {})
    supabase.rpc('my_coach_id').then(({ data: id }) => id && supabase.from('profiles').select('name').eq('id', id).single()
      .then(({ data: c }) => c?.name && setCoachName(c.name)))
    const t = setInterval(() => store.flush(), 30_000)
    return () => clearInterval(t)
  }, [store])

  const day = data.workouts.filter((w) => w.date === date)
  const editable = date >= addDays(today(), -7)  // правка своих результатов — 7 дней назад
  const names = { [profile.id]: profile.name, ...Object.fromEntries(data.comments.filter((c) => c.author_id !== profile.id).map((c) => [c.author_id, coachName])) }

  const addOwnWorkout = (id: string, title: string, prescription: string, items: OwnItem[]) => store.do(
    { t: 'workout', row: { id, athlete_id: profile.id, date, title, prescription, published: true, self: true, completed_at: null, workout_items: [] } },
    ...items.map((row) => ({ t: 'item' as const, row })),
  )
  const rememberExercise = (exercise: Exercise) => setExercises((list) => list.some((x) => x.id === exercise.id) ? list : [...list, exercise])

  return (
    <>
      <div className="row-between">
        <button className="btn small secondary" onClick={() => go(addDays(date, -7))} aria-label="Предыдущая неделя">←</button>
        <b>{fmtDay(date)}</b>
        <button className="btn small secondary" onClick={() => go(addDays(date, 7))} aria-label="Следующая неделя">→</button>
      </div>
      {/* неделя: точка — тренировка запланирована, закрашенная — выполнена */}
      <nav className="week-strip" aria-label="Дни недели">
        {weekDays(mondayOf(date)).map((d) => {
          const ws = data.workouts.filter((w) => w.date === d)
          const mark = !ws.length ? '' : ws.every((w) => w.completed_at) ? ' done' : ' planned'
          return (
            <button key={d} className={(d === date ? 'active' : '') + (d === today() ? ' now' : '')} onClick={() => go(d)}
              aria-current={d === date ? 'date' : undefined}
              aria-label={fmtDay(d) + (mark === ' done' ? ', тренировка выполнена' : mark ? ', есть тренировка' : '')}>
              <b>{parseIso(d).getDate()}</b><small>{dayShort(d)}</small><i className={'dot' + mark} />
            </button>
          )
        })}
      </nav>
      <p className={'sync ' + store.status}>{STATUS[store.status]}{store.lastError && ` · ошибка: ${store.lastError}`}</p>
      {date !== today() && <button className="link-btn" onClick={() => go(today())}>← к сегодняшнему дню</button>}

      <button className="btn small secondary" onClick={() => setFreeTimer('setup')}>Свободный таймер</button>
      {!data.syncedAt && !day.length && <p className="muted">Загрузка…</p>}
      {data.syncedAt && !day.length && <p className="muted">Отдых — тренировок на этот день нет.</p>}

      {day.map((w) => (
        <div key={w.id}>
          <WorkoutView workout={w} results={data.results} comments={data.comments} history={data.history}
            me={profile.id} names={names} editable={editable} maxes={data.records ?? []}
            gym={{ bar: profile.bar ?? 20, plates: profile.plates ?? [25, 20, 15, 10, 5, 2.5, 1.25] }}
            extra={(item) => item.timer?.kind && editable && <button className="btn small" onClick={() => setTimer(item)}>▶ Таймер</button>}
            onMax={(item, weight) => store.do({ t: 'record', row: { id: crypto.randomUUID(), athlete_id: profile.id, exercise_id: item.exercise_id, name: item.name, weight, reps: 1 } })}
            onSet={(row) => store.do({ t: 'set', row })}
            onEdit={(item) => setEditId(item.id)}
            onReorder={(item_ids) => store.do({ t: 'reorder_items', workout_id: w.id, item_ids })}
            itemEditor={(item) => item.id === editId && <OwnItemEditor key={item.id} item={item}
              mode={isComplex(item) ? 'complex' : 'exercise'}
              hasResults={data.results.some((r) => r.item_id === item.id)}
              exercises={exercises} source={profile.role} onCatalog={rememberExercise}
              onSave={(patch) => { store.do({ t: 'edit_item', id: item.id, workout_id: w.id, patch }); setEditId(null) }}
              onClose={() => setEditId(null)} />}
            onDelete={(item) => {
              if (!item) {
                if (confirm(`Удалить тренировку «${w.title || 'Тренировка'}» и все её подходы?`)) store.do({ t: 'delete_workout', id: w.id })
              } else if (confirm('Удалить «' + item.name + '» и его подходы?')) {
                if (editId === item.id) setEditId(null)
                store.do({ t: 'delete_item', id: item.id, workout_id: w.id })
              }
            }}
            onUnset={(item_id, set_no) => store.do({ t: 'unset', item_id, set_no })}
            onVideo={async (item_id, text, file) => {
              const blob = await prepareVideo(file)
              const id = crypto.randomUUID()
              await putBlob(id, blob)
              store.do({ t: 'video', row: { id, workout_id: w.id, item_id, author_id: profile.id, text: text || 'видео подхода', created_at: new Date().toISOString() } })
            }}
            onComment={(item_id, text, id) => store.do({
              t: 'comment',
              row: { id, workout_id: w.id, item_id, author_id: profile.id, text, created_at: new Date().toISOString() },
            })} />
          {editable && <AddOwnItem workout={w} exercises={exercises} source={profile.role} onCatalog={rememberExercise}
            onAdd={(row) => store.do({ t: 'item', row })} />}
          {editable && <Finish workout={w} results={data.results} onDone={() => store.do({ t: 'complete', id: w.id, at: new Date().toISOString() })} />}
        </div>
      ))}

      {editable && <AddOwnWorkout onAdd={addOwnWorkout} exercises={exercises} source={profile.role} onCatalog={rememberExercise} />}
      {freeTimer === 'setup' && <section className="card own-form">
        <b>Свободный таймер</b>
        <TimerFields cfg={freeConfig} onChange={setFreeConfig} />
        <button className="btn" disabled={!freeConfig} onClick={() => setFreeTimer('running')}>Открыть таймер</button>
        <button className="btn secondary" onClick={() => setFreeTimer(null)}>Отмена</button>
      </section>}
      {freeTimer === 'running' && freeConfig && <Timer id="free" cfg={freeConfig} title="Таймер" onClose={() => setFreeTimer(null)} />}
      {timer?.timer && (
        <Timer id={timer.id} cfg={timer.timer} title={timer.name} task={[timer.block_note, timer.plan_text].filter(Boolean).join('\n\n')} onClose={() => setTimer(null)}
          manualResult={isComplex(timer) && timer.result_type !== 'check' && timer.result_type !== 'time' && !(timer.result_type === 'rounds' && timer.timer.kind === 'amrap')}
          onResult={(r) => store.do({ t: 'set', row: {
            ...data.results.find((x) => x.item_id === timer.id && x.set_no === 1), item_id: timer.id, set_no: 1, done: r.done,
            ...(timer.result_type === 'rounds' && r.rounds !== undefined ? { rounds: r.rounds } : {}),
            ...(timer.result_type === 'time' && (isComplex(timer) || timer.timer?.kind === 'fortime') && r.time_sec !== undefined ? { time_sec: r.time_sec } : {}),
          } })} />
      )}
    </>
  )
}

function Finish({ workout, results, onDone }: { workout: Workout; results: Parameters<typeof progress>[1]; onDone: () => void }) {
  const p = progress(workout.workout_items ?? [], results.filter((r) => workout.workout_items?.some((i) => i.id === r.item_id)))
  if (!workout.completed_at) return <button className="btn" onClick={onDone}>Завершить тренировку</button>
  return (
    <p className="note">
      Тренировка завершена: сделано {p.done} из {p.total}{p.tonnage > 0 && `, поднято ${fmtNum(Math.round(p.tonnage))} кг`}.
    </p>
  )
}

type OwnItem = WorkoutItem & { workout_id: string }
type CatalogProps = {
  exercises: Exercise[]
  source: 'coach' | 'athlete'
  onCatalog: (exercise: Exercise) => void
}
type ItemMode = 'exercise' | 'complex'

function AddOwnItem({ workout, onAdd, onOpenChange, ...catalog }: CatalogProps & {
  workout: Pick<Workout, 'id' | 'workout_items'>
  onAdd: (item: OwnItem) => void
  onOpenChange?: (open: boolean) => void
}) {
  const [mode, setMode] = useState<ItemMode | null>(null)
  const selectMode = (next: ItemMode | null) => {
    setMode(next)
    onOpenChange?.(!!next)
  }
  if (!mode) return <div className="row">
    <button type="button" className="btn secondary" onClick={() => selectMode('exercise')}>+ моё упражнение</button>
    <button type="button" className="btn secondary" onClick={() => selectMode('complex')}>+ комплекс</button>
  </div>
  return <OwnItemEditor {...catalog} mode={mode} onClose={() => selectMode(null)} onSave={(patch) => {
    const position = Math.max(999, ...(workout.workout_items ?? []).map((i) => i.position)) + 1
    onAdd({ ...patch, id: crypto.randomUUID(), workout_id: workout.id, position, video_url: null, superset: null, block_note: '', self: true })
    selectMode(null)
  }} />
}

function OwnItemEditor({ mode, item, hasResults = false, exercises, source, onCatalog, onSave, onClose }: CatalogProps & {
  mode: ItemMode; item?: WorkoutItem; hasResults?: boolean; onSave: (patch: ItemEdit) => void; onClose: () => void
}) {
  const complex = mode === 'complex'
  const [name, setName] = useState(complex ? complexTitle(item?.name ?? '') : item?.name ?? '')
  const [linked, setLinked] = useState(item?.exercise_id ?? null)
  const [type, setType] = useState<ResultType>(item?.result_type ?? (complex ? 'time' : 'weight_reps'))
  const [sets, setSets] = useState(item?.planned_sets ?? 3)
  const [plan, setPlan] = useState(item?.plan_text ?? '')
  const [rounds, setRounds] = useState(item ? complexRounds(item.name) ?? 5 : 5)
  const [timer, setTimer] = useState<TimerCfg | null>(item?.timer ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending] = useState(() => new Map<string, string>())
  const timerRounds = complex && complexPerRound(type) ? complexTimerRounds(timer) : null
  const input = name.trim()
  const match = !complex && !hasResults && input ? exactExercise(exercises, input) : undefined
  const found = input && !linked && !complex && !hasResults ? searchExercises(exercises, input).slice(0, 6) : []

  const save = async (inCatalog: boolean) => {
    if (busy || (complex ? !plan.trim() : !input)) return
    let exercise_id = linked ?? match?.id ?? null
    if (inCatalog && !exercise_id) {
      if (!navigator.onLine) { setError('Чтобы добавить упражнение в базу, нужен интернет.'); return }
      const id = pending.get(input) ?? crypto.randomUUID()
      pending.set(input, id)
      setBusy(true)
      setError('')
      try {
        const exercise = await createCatalogExercise(id, input, source)
        onCatalog(exercise)
        exercise_id = exercise.id
      } catch {
        setError('Не удалось добавить в базу. Проверьте связь и повторите.')
        return
      } finally { setBusy(false) }
    }
    onSave({
      exercise_id, name: complex ? complexName(type === 'rounds' ? null : timerRounds ?? rounds, input) : input,
      plan_text: plan.trim(), result_type: type, planned_sets: complex || type === 'check' ? 1 : sets, timer,
    })
  }

  return <div className="card own-form">
    <b>{item ? 'Редактировать задание' : complex ? 'Комплекс' : 'Моё упражнение'}</b>
    {complex ? <input aria-label="Название комплекса" placeholder="Название комплекса" value={name} disabled={busy}
      onChange={(e) => setName(e.target.value)} /> : <>
      <input autoFocus type="search" aria-label="Название упражнения" placeholder={hasResults ? 'Название в тренировке' : 'Поиск или новое название'}
        value={name} disabled={busy} onChange={(e) => {
          setName(e.target.value)
          if (!hasResults) setLinked(null)
          setError('')
        }} />
      {found.length > 0 && <div className="suggest">{found.map((e) => (
        <button key={e.id} type="button" disabled={busy} onClick={() => {
          setName(e.name)
          setLinked(e.id)
          if (e.default_result_type) setType(e.default_result_type)
          if (e.default_result_type === 'cardio') setSets(1)
        }}>{e.name}</button>
      ))}</div>}
    </>}
    <textarea autoFocus={complex} rows={3} aria-label="Описание задания" placeholder={complex ? 'Что делать в комплексе' : 'Описание: 3×10, резина синяя'}
      value={plan} disabled={busy} onChange={(e) => setPlan(e.target.value)} />
    <div className="row">
      <select value={type} disabled={busy || hasResults} onChange={(e) => setType(e.target.value as ResultType)} aria-label="Тип результата">
        {(complex ? COMPLEX_RESULTS : RESULT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {(complex ? type !== 'rounds' && timerRounds == null : type !== 'check') && <label>{complex ? 'Раундов' : 'Подходов'}
        <input type="number" inputMode="numeric" min={1} max={complex ? MAX_RESULT_ROWS : 50} disabled={busy}
          value={complex ? rounds : sets} onChange={(e) => (complex ? setRounds : setSets)(
            Math.min(complex ? MAX_RESULT_ROWS : 50, Math.max(1, Math.round(Number(e.target.value)) || 1))
          )} />
      </label>}
    </div>
    {hasResults && <small className="muted">Подходы сохранятся. Тип результата для записанных подходов зафиксирован.</small>}
    <fieldset disabled={busy} className="workout-fields">
      <TimerFields cfg={timer} onChange={setTimer} />
    </fieldset>
    {timerRounds != null && <small className="muted">Раундов для записи: {Math.min(timerRounds, MAX_RESULT_ROWS)}{timerRounds > MAX_RESULT_ROWS && ` из ${timerRounds}`}</small>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="row">
      {!complex && !linked && !match && !hasResults && <button type="button" className="btn" disabled={busy || !input}
        onClick={() => save(true)}>{busy ? 'Добавляю в базу…' : 'В базу и в тренировку'}</button>}
      <button type="button" className="btn secondary" disabled={busy || (complex ? !plan.trim() : !input)} onClick={() => save(false)}>
        {item ? 'Сохранить' : !complex && !linked && !match ? 'Только в тренировку' : 'Добавить'}
      </button>
      <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Отмена</button>
    </div>
  </div>
}

function AddOwnWorkout({ onAdd, ...catalog }: CatalogProps & {
  onAdd: (id: string, title: string, prescription: string, items: OwnItem[]) => void
}) {
  const [id, setId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [items, setItems] = useState<OwnItem[]>([])
  const [editing, setEditing] = useState<OwnItem | null>(null)
  const [adding, setAdding] = useState(false)
  const close = () => { setId(null); setTitle(''); setText(''); setItems([]); setEditing(null); setAdding(false) }
  if (!id) return <button className="btn secondary" onClick={() => setId(crypto.randomUUID())}>+ своя тренировка</button>
  return (
    <form className="card own-form" onSubmit={(e) => { e.preventDefault(); if (title.trim() && !editing && !adding) { onAdd(id, title.trim(), text.trim(), items); close() } }}>
      <b>Своя тренировка</b>
      <input autoFocus placeholder="Например: Бег 5 км, 28:30" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea rows={2} placeholder="Описание: разминка, темп, самочувствие" value={text} onChange={(e) => setText(e.target.value)} />
      {items.map((item) => <div className="row workout-item-actions" key={item.id}>
        <b>{item.name}</b>
        <button type="button" className="link-btn" disabled={adding} onClick={() => setEditing(item)}>Редактировать</button>
        <button type="button" className="link-btn" onClick={() => { setItems((list) => list.filter((i) => i.id !== item.id)); if (editing?.id === item.id) setEditing(null) }}>Удалить</button>
      </div>)}
      {editing
        ? <OwnItemEditor {...catalog} key={editing.id} item={editing} mode={isComplex(editing) ? 'complex' : 'exercise'}
            onSave={(patch) => { setItems((list) => list.map((i) => i.id === editing.id ? { ...i, ...patch } : i)); setEditing(null) }}
            onClose={() => setEditing(null)} />
        : <AddOwnItem {...catalog} workout={{ id, workout_items: items }} onOpenChange={setAdding} onAdd={(item) => setItems((list) => [...list, item])} />}
      <button className="btn" disabled={!title.trim() || !!editing || adding}>Добавить тренировку</button>
      <button type="button" className="btn secondary" disabled={adding} onClick={close}>Отмена</button>
    </form>
  )
}
