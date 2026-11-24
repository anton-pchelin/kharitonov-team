import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { myId, sendCoachComment, supabase } from '../supabase'
import type { Exercise } from '../search'
import { loadExercises } from './Exercises'
import { WorkoutEditor, snapshot } from './WorkoutEditor'
import { AssignProgram, CopyWeek, PickWorkout } from './WeekTools'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import type { WorkoutItem } from '../lib/workout'
import { addDays, dayShort, fmtShort, mondayOf, today, weekDays } from '../lib/dates'
import type { Workout } from '../lib/workout'
import { loadCardioHistory, type Comment, type PastSet, type SetResult } from '../lib/offline'
import { WorkoutView, progress } from './WorkoutView'
import { LoadError } from '../lib/diagnostics'
import { withDeadline } from '../lib/request'

type Athlete = { id: string; name: string }

export async function loadMyAthletes(id?: string, signal?: AbortSignal): Promise<Athlete[]> {
  const query = supabase.from('coach_athletes').select('athlete_id, profiles!coach_athletes_athlete_id_fkey(name)').eq('coach_id', id ?? await myId())
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw error
  return ((data ?? []) as unknown as { athlete_id: string; profiles: { name: string } | null }[])
    .map((r) => ({ id: r.athlete_id, name: r.profiles?.name || 'Без имени' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

/** Неделя атлета таблицей (7 колонок, на телефоне — список дней) + редактор тренировки под ней. */
export function Plan({ athleteId, week, open, me }: { athleteId?: string; week?: string; open?: string; me: { id: string; name: string } }) {
  const [athletes, setAthletes] = useState<Athlete[] | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const monday = mondayOf(week ?? today())
  const athlete = athletes?.find((a) => a.id === athleteId) ?? athletes?.[0]
  const go = (id: string, mon: string) => { location.hash = '#/plan/' + id + '/' + mon }
  const load = useCallback(async () => {
    setFailure(null)
    try { setAthletes(await withDeadline((signal) => loadMyAthletes(me.id, signal))) } catch (cause) { setFailure({ cause }) }
  }, [me.id])

  useEffect(() => {
    load()
    loadExercises().then(setExercises, () => setExercises([]))
  }, [load])

  if (failure) return <LoadError screen="План" cause={failure.cause} message="Не удалось загрузить атлетов" onRetry={load} />
  if (athletes === null) return <p className="muted">Загрузка…</p>
  if (!athlete) return <p className="muted">Пока нет атлетов. Пригласите кого-нибудь во вкладке «Атлеты».</p>

  return (
    <>
      <div className="plan-head">
        <select value={athlete.id} onChange={(e) => go(e.target.value, monday)} aria-label="Атлет">
          {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div className="week-nav">
          <button className="btn small secondary" onClick={() => go(athlete.id, addDays(monday, -7))} aria-label="Прошлая неделя">←</button>
          <span>{fmtShort(monday)} — {fmtShort(addDays(monday, 6))}</span>
          <button className="btn small secondary" onClick={() => go(athlete.id, addDays(monday, 7))} aria-label="Следующая неделя">→</button>
        </div>
      </div>
      <PlanWeek key={athlete.id + '/' + monday} athlete={athlete} athletes={athletes} monday={monday}
        open={open} me={me} exercises={exercises} />
    </>
  )
}

function PlanWeek({ athlete, athletes, monday, open, me, exercises }: {
  athlete: Athlete; athletes: Athlete[]; monday: string; open?: string; me: { id: string; name: string }; exercises: Exercise[]
}) {
  const [workouts, setWorkouts] = useState<Workout[] | null>(null)
  const [editing, setEditing] = useState<{ date: string; workout: Workout | null; template?: Template } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const [tool, setTool] = useState<'copy' | 'assign' | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [viewing, setViewing] = useState<string | null>(open ?? null)
  const [results, setResults] = useState<SetResult[]>([])
  const [history, setHistory] = useState<PastSet[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const request = useRef(0)

  const loadTemplates = () => supabase.from('workout_templates').select('*').order('title').then(({ data }) => setTemplates((data ?? []) as Template[]))
  useEffect(() => { loadTemplates() }, [])

  // перетаскивание карточки тренировки на другой день
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const w = workouts?.find((x) => x.id === active.id)
    if (!w || !over || over.id === w.date) return
    setWorkouts((l) => l?.map((x) => (x.id === w.id ? { ...x, date: String(over.id) } : x)) ?? null)
    const { error } = await supabase.from('workouts').update({ date: over.id }).eq('id', w.id)
    if (error) alert('Не перенеслось: ' + error.message)
    reload()
  }

  const reload = useCallback(async () => {
    const version = ++request.current
    setFailure(null)
    try {
      const { ws, r, c } = await withDeadline(async (signal) => {
        const { data, error } = await supabase.from('workouts').select('*, workout_items(*)')
          .eq('athlete_id', athlete.id).gte('date', monday).lte('date', addDays(monday, 6)).order('created_at').abortSignal(signal)
        if (error) throw error
        const ws = data as Workout[]
        const itemIds = ws.flatMap((w) => (w.workout_items ?? []).map((i) => i.id))
        const [r, c] = await Promise.all([
          itemIds.length ? supabase.from('set_results').select('*').in('item_id', itemIds).abortSignal(signal) : { data: [], error: null },
          ws.length ? supabase.from('comments').select('*').in('workout_id', ws.map((w) => w.id)).order('created_at').abortSignal(signal) : { data: [], error: null },
        ])
        if (r.error || c.error) throw r.error ?? c.error
        return { ws, r: r.data, c: c.data }
      })
      if (version !== request.current) return
      setResults(r as SetResult[])
      setComments(c as Comment[])
      setWorkouts(ws)
      if (ws.some((w) => w.workout_items?.some((i) => i.result_type === 'cardio'))) {
        loadCardioHistory([athlete.id]).then((rows) => { if (version === request.current) setHistory(rows) }, () => {})
      }
    } catch (cause) { if (version === request.current) setFailure({ cause }) }
  }, [athlete.id, monday])

  useEffect(() => {
    reload()
    return () => { request.current++ }
  }, [reload])
  useEffect(() => { setViewing(open ?? null) }, [open])

  // «Из другого дня»: копия черновиком в выбранный день, сразу в редактор
  const take = async (src: Workout, date: string) => {
    setPicking(null)
    const { data: id, error } = await supabase.rpc('copy_workout', { src: src.id, to_athlete: athlete!.id, to_date: date })
    if (error) return alert('Не получилось: ' + error.message)
    const { data } = await supabase.from('workouts').update({ published: false }).eq('id', id).select('*, workout_items(*)').single()
    await reload()
    if (data) setEditing({ date, workout: data as Workout })
  }

  if (!workouts && failure) return <LoadError screen="План" cause={failure.cause} message="Не удалось загрузить неделю" onRetry={reload} />
  if (!workouts) return <p className="muted">Загрузка…</p>

  const viewedWorkout = workouts.find((w) => w.id === viewing)
  return (
    <>
      {failure && <LoadError screen="План" cause={failure.cause} message="Не удалось обновить неделю" onRetry={reload} />}
      <div className="plan-tools">
        <button className="btn small secondary" onClick={() => setTool(tool === 'copy' ? null : 'copy')}>Копировать неделю</button>
        <button className="btn small secondary" onClick={() => setTool(tool === 'assign' ? null : 'assign')}>Назначить программу</button>
        <a className="btn small secondary" href="#/programs">Шаблоны и программы</a>
        <RemindNow />
      </div>
      {tool === 'copy' && <CopyWeek athlete={athlete} monday={monday} athletes={athletes} onDone={() => { setTool(null); reload() }} />}
      {tool === 'assign' && <AssignProgram athlete={athlete} monday={monday} athletes={athletes} onDone={() => { setTool(null); reload() }} />}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="week">
          {weekDays(monday).map((d) => {
            const day = workouts.filter((w) => w.date === d)
            const open = (template?: Template) => { setAdding(null); setViewing(null); setEditing({ date: d, workout: null, template }) }
            return (
              <Day key={d} date={d}>
                <div className="day-head">{dayShort(d)} <span className="muted">{fmtShort(d)}</span></div>
                {day.map((w) => (
                  <WorkoutCard key={w.id} w={w} athletes={athletes} results={results} comments={comments}
                    onOpen={() => { setViewing(null); setEditing({ date: d, workout: w }) }}
                    onResults={() => { setEditing(null); setViewing(w.id) }} onChanged={() => { reload(); loadTemplates() }} />
                ))}
                {day.length === 0 && <span className="muted rest">отдых</span>}
                {adding === d ? (
                  <div className="suggest">
                    <button onClick={() => open()}>Пустая тренировка</button>
                    {templates.map((t) => <button key={t.id} onClick={() => open(t)}>Из шаблона: {t.title || 'Тренировка'}</button>)}
                    <button onClick={() => { setAdding(null); setEditing(null); setViewing(null); setPicking(d) }}>Из другого дня</button>
                    <button onClick={() => setAdding(null)}>Отмена</button>
                  </div>
                ) : (
                  <button className="add-day" onClick={() => setAdding(d)} aria-label={`Добавить тренировку ${d}`}>+</button>
                )}
              </Day>
            )
          })}
        </div>
      </DndContext>

      {picking && (
        <section className="editor card" key={picking} ref={toTop}>
          <div className="row-between"><b>Из другого дня → {dayShort(picking)} {fmtShort(picking)}</b><button className="back" onClick={() => setPicking(null)}>✕</button></div>
          <PickWorkout athleteId={athlete.id} monday={monday} onPick={(w) => take(w, picking)} onCancel={() => setPicking(null)} />
        </section>
      )}

      {viewedWorkout && viewing && (
        <section className="editor card" key={viewing} ref={toTop}>
          <div className="row-between"><b>Результаты — {athlete.name}</b><button className="back" onClick={() => setViewing(null)}>✕</button></div>
          {!viewedWorkout.self && <button className="btn small secondary" onClick={() => {
            setViewing(null)
            setEditing({ date: viewedWorkout.date, workout: viewedWorkout })
          }}>Редактировать тренировку</button>}
          <WorkoutView workout={viewedWorkout} results={results} comments={comments} history={history}
            me={me.id} names={{ [me.id]: me.name, [athlete.id]: athlete.name }} editable={false}
            onComment={async (itemId, text, id) => {
              await sendCoachComment(viewing, itemId, text, id)
              reload()
            }} />
        </section>
      )}

      {editing && (
        <WorkoutEditor key={(editing.workout?.id ?? 'new') + editing.date}
          athleteId={athlete.id} athleteName={athlete.name} date={editing.date} workout={editing.workout} template={editing.template}
          draftScope={[me.id, 'plan', athlete.id, editing.date, editing.workout?.id ?? 'new']}
          exercises={exercises} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }} />
      )}
    </>
  )
}

type Template = { id: string; title: string; prescription: string; items: WorkoutItem[] }

/** На телефоне блоки под неделей не видно — прокручиваем к ним при открытии. */
const toTop = (el: HTMLElement | null) => el?.scrollIntoView({ block: 'start' })

function Day({ date, children }: { date: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: date })
  return <div ref={setNodeRef} className={'day' + (date === today() ? ' is-today' : '') + (isOver ? ' drop' : '')}>{children}</div>
}

/** Проверка напоминаний: сразу шлёт атлетам тренера сообщения о завтрашних тренировках. */
function RemindNow() {
  const [msg, setMsg] = useState('')
  const run = async () => {
    setMsg('Отправляю…')
    const { data, error } = await supabase.functions.invoke('telegram', { body: { action: 'remind_now' } })
    setMsg(error ? 'Не получилось' : `Напоминаний: ${data.queued}, отправлено: ${data.sent}`)
  }
  return (
    <span className="remind-now">
      <button className="btn small secondary" onClick={run}>Отправить напоминания сейчас</button>
      {msg && <small className="muted"> {msg}</small>}
    </span>
  )
}

function WorkoutCard({ w, athletes, results, comments, onOpen, onResults, onChanged }: {
  w: Workout; athletes: Athlete[]; results: SetResult[]; comments: Comment[]; onOpen: () => void; onResults: () => void; onChanged: () => void
}) {
  const [mode, setMode] = useState<'copy' | 'move' | null>(null)
  const [to, setTo] = useState(w.athlete_id)
  const [date, setDate] = useState(addDays(w.date, 7))
  const items = (w.workout_items ?? []).sort((a, b) => a.position - b.position)
  const mine = results.filter((r) => items.some((i) => i.id === r.item_id))
  const p = progress(items.filter((i) => !i.self), mine)  // «4/4» — по плану тренера, свои упражнения атлета не в счёт
  const drag = useDraggable({ id: w.id, disabled: w.self })

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    if (error) return alert('Не получилось: ' + error.message)
    setMode(null)
    onChanged()
  }
  const remove = () => {
    const warn = mine.length || comments.some((c) => c.workout_id === w.id) ? '\n\nУ атлета есть результаты — удалятся вместе.' : ''
    if (confirm(`Удалить тренировку «${w.title || 'Тренировка'}»?${warn}`)) run(supabase.from('workouts').delete().eq('id', w.id))
  }

  return (
    <div ref={drag.setNodeRef} className={'wcard' + (w.published ? '' : ' draft') + (drag.isDragging ? ' dragging' : '')}
      style={drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`, zIndex: 10 } : undefined}>
      {!w.self && <button className="drag-handle" {...drag.listeners} {...drag.attributes} aria-label="Перетащить на другой день">⠿</button>}
      <button className="wcard-open" onClick={w.self || w.completed_at ? onResults : onOpen}>
        <b>{w.title || 'Тренировка'}</b>
        {w.self && <span className="tag">сам</span>}
        {!w.published && !w.self && <span className="tag">черновик</span>}
        {p.done > 0 && <span className={'tag' + (p.done === p.total ? ' tag-done' : '')}>{p.done}/{p.total}</span>}
        <ul>{items.slice(0, 6).map((i) => <li key={i.id}>{i.name}{i.self && ' (сам)'}</li>)}</ul>
        {items.length > 6 && <span className="muted">ещё {items.length - 6}</span>}
      </button>
      {!w.self && (
        <details className="menu">
          <summary aria-label="Меню тренировки">⋯</summary>
          <div className="menu-list">
            <button onClick={onOpen}>Редактировать</button>
            <button onClick={onResults}>Результаты и комментарии</button>
            <button onClick={async () => {
              const { error } = await supabase.from('workout_templates').insert({ title: w.title, prescription: w.prescription, items: snapshot(items) })
              alert(error ? 'Не сохранилось: ' + error.message : `«${w.title || 'Тренировка'}» сохранена как шаблон`)
              onChanged()
            }}>Сохранить как шаблон</button>
            <button onClick={() => run(supabase.from('workouts').update({ published: !w.published }).eq('id', w.id))}>
              {w.published ? 'Снять с публикации' : 'Опубликовать'}
            </button>
            <button onClick={() => setMode('copy')}>Скопировать…</button>
            <button onClick={() => { setDate(w.date); setMode('move') }}>Перенести…</button>
            <button onClick={remove}>Удалить</button>
          </div>
        </details>
      )}
      {mode && (
        <div className="inline-form">
          {mode === 'copy' && (
            <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Кому">
              {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn small" onClick={() => run(mode === 'copy'
            ? supabase.rpc('copy_workout', { src: w.id, to_athlete: to, to_date: date })
            : supabase.from('workouts').update({ date }).eq('id', w.id))}>
            {mode === 'copy' ? 'Скопировать' : 'Перенести'}
          </button>
          <button className="btn small secondary" onClick={() => setMode(null)}>Отмена</button>
        </div>
      )}
    </div>
  )
}
