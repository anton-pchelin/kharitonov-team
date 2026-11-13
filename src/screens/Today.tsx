import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase, type Profile } from '../supabase'
import { searchExercises, type Exercise } from '../search'
import { loadExercises } from './Exercises'
import { WorkoutView, progress } from './WorkoutView'
import { OfflineStore } from '../lib/offline'
import { addDays, fmtDay, today } from '../lib/dates'
import { fmtNum } from '../lib/format'
import { RESULT_TYPES, type ResultType, type Workout } from '../lib/workout'

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

  const addOwnWorkout = (title: string) => store.do({
    t: 'workout',
    row: { id: crypto.randomUUID(), athlete_id: profile.id, date, title, prescription: '', published: true, self: true, completed_at: null, workout_items: [] },
  })

  return (
    <>
      <div className="row-between">
        <button className="btn small secondary" onClick={() => go(addDays(date, -1))} aria-label="Предыдущий день">←</button>
        <b>{fmtDay(date)}</b>
        <button className="btn small secondary" onClick={() => go(addDays(date, 1))} aria-label="Следующий день">→</button>
      </div>
      <p className={'sync ' + store.status}>{STATUS[store.status]}{store.lastError && ` · ошибка: ${store.lastError}`}</p>
      {date !== today() && <button className="link-btn" onClick={() => go(today())}>← к сегодняшнему дню</button>}

      {!data.syncedAt && !day.length && <p className="muted">Загрузка…</p>}
      {data.syncedAt && !day.length && <p className="muted">Отдых — тренировок на этот день нет.</p>}

      {day.map((w) => (
        <div key={w.id}>
          <WorkoutView workout={w} results={data.results} comments={data.comments} history={data.history}
            me={profile.id} names={names} editable={editable} maxes={data.records ?? []}
            onMax={(item, weight) => store.do({ t: 'record', row: { id: crypto.randomUUID(), athlete_id: profile.id, exercise_id: item.exercise_id, name: item.name, weight, reps: 1 } })}
            onSet={(row) => store.do({ t: 'set', row })}
            onUnset={(item_id, set_no) => store.do({ t: 'unset', item_id, set_no })}
            onComment={(item_id, text) => store.do({
              t: 'comment',
              row: { id: crypto.randomUUID(), workout_id: w.id, item_id, author_id: profile.id, text, created_at: new Date().toISOString() },
            })} />
          {editable && <AddOwnItem workout={w} exercises={exercises} onAdd={(row) => store.do({ t: 'item', row })} />}
          {editable && <Finish workout={w} results={data.results} onDone={() => store.do({ t: 'complete', id: w.id, at: new Date().toISOString() })} />}
        </div>
      ))}

      {editable && <AddOwnWorkout onAdd={addOwnWorkout} />}
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

function AddOwnItem({ workout, exercises, onAdd }: {
  workout: Workout; exercises: Exercise[]; onAdd: (row: NonNullable<Workout['workout_items']>[number] & { workout_id: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ name: string; exercise_id: string | null } | null>(null)
  const [type, setType] = useState<ResultType>('weight_reps')
  const [sets, setSets] = useState(3)

  if (!open) return <button className="btn secondary" onClick={() => setOpen(true)}>+ моё упражнение</button>

  const add = async () => {
    let it = picked ?? { name: q.trim(), exercise_id: null }
    if (!it.name) return
    if (!it.exercise_id && navigator.onLine) {
      // новое название — в общую базу, чтобы потом находилось; без сети просто сохраним в тренировке
      const { data } = await supabase.from('exercises').insert({ name: it.name, source: 'athlete' }).select('id').single()
      if (data) it = { ...it, exercise_id: data.id }
    }
    onAdd({
      id: crypto.randomUUID(), workout_id: workout.id, position: 1000 + (workout.workout_items?.length ?? 0),
      exercise_id: it.exercise_id, name: it.name, plan_text: '', video_url: null, result_type: type,
      planned_sets: type === 'check' ? 1 : sets, superset: null, block_note: '', self: true,
    })
    setOpen(false); setQ(''); setPicked(null)
  }

  const found = q && !picked ? searchExercises(exercises, q).slice(0, 6) : []
  return (
    <div className="card own-form">
      <b>Моё упражнение</b>
      <input type="search" placeholder="Поиск или новое название" value={picked?.name ?? q}
        onChange={(e) => { setPicked(null); setQ(e.target.value) }} />
      {found.length > 0 && (
        <div className="suggest">
          {found.map((e) => <button key={e.id} onClick={() => setPicked({ name: e.name, exercise_id: e.id })}>{e.name}</button>)}
        </div>
      )}
      <div className="row">
        <select value={type} onChange={(e) => setType(e.target.value as ResultType)} aria-label="Тип результата">
          {RESULT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {type !== 'check' && (
          <div className="stepper">
            <button type="button" onClick={() => setSets(Math.max(1, sets - 1))} aria-label="Меньше подходов">−</button>
            <span>{sets}</span>
            <button type="button" onClick={() => setSets(sets + 1)} aria-label="Больше подходов">+</button>
          </div>
        )}
      </div>
      <button className="btn" onClick={add}>Добавить</button>
      <button className="btn secondary" onClick={() => setOpen(false)}>Отмена</button>
    </div>
  )
}

function AddOwnWorkout({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  if (!open) return <button className="btn secondary" onClick={() => setOpen(true)}>+ своя тренировка</button>
  return (
    <form className="card own-form" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { onAdd(title.trim()); setOpen(false); setTitle('') } }}>
      <b>Своя тренировка</b>
      <input autoFocus placeholder="Например: Бег 5 км, 28:30" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button className="btn">Добавить</button>
      <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Отмена</button>
    </form>
  )
}
