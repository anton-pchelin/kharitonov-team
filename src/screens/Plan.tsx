import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { Exercise } from '../search'
import { loadExercises } from './Exercises'
import { WorkoutEditor } from './WorkoutEditor'
import { addDays, dayShort, fmtShort, mondayOf, today, weekDays } from '../lib/dates'
import type { Workout } from '../lib/workout'
import type { Comment, SetResult } from '../lib/offline'
import { WorkoutView, progress } from './WorkoutView'

type Athlete = { id: string; name: string }

export async function loadMyAthletes(): Promise<Athlete[]> {
  const { data } = await supabase.from('coach_athletes').select('athlete_id, profiles!coach_athletes_athlete_id_fkey(name)')
  return ((data ?? []) as unknown as { athlete_id: string; profiles: { name: string } | null }[])
    .map((r) => ({ id: r.athlete_id, name: r.profiles?.name || 'Без имени' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

/** Неделя атлета таблицей (7 колонок, на телефоне — список дней) + редактор тренировки под ней. */
export function Plan({ athleteId, week, me }: { athleteId?: string; week?: string; me: { id: string; name: string } }) {
  const [athletes, setAthletes] = useState<Athlete[] | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [editing, setEditing] = useState<{ date: string; workout: Workout | null } | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [results, setResults] = useState<SetResult[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const monday = mondayOf(week ?? today())

  useEffect(() => {
    loadMyAthletes().then(setAthletes)
    loadExercises().then(setExercises, () => setExercises([]))
  }, [])

  const athlete = athletes?.find((a) => a.id === athleteId) ?? athletes?.[0]
  const go = (id: string, mon: string) => { location.hash = `#/plan/${id}/${mon}` }

  const reload = useCallback(async () => {
    if (!athlete) return
    const { data, error } = await supabase.from('workouts').select('*, workout_items(*)')
      .eq('athlete_id', athlete.id).gte('date', monday).lte('date', addDays(monday, 6)).order('created_at')
    if (error) alert('Не загрузилось: ' + error.message)
    const ws = (data ?? []) as Workout[]
    const itemIds = ws.flatMap((w) => (w.workout_items ?? []).map((i) => i.id))
    const [r, c] = await Promise.all([
      itemIds.length ? supabase.from('set_results').select('*').in('item_id', itemIds) : { data: [] },
      ws.length ? supabase.from('comments').select('*').in('workout_id', ws.map((w) => w.id)).order('created_at') : { data: [] },
    ])
    setResults((r.data ?? []) as SetResult[])
    setComments((c.data ?? []) as Comment[])
    setWorkouts(ws)
  }, [athlete?.id, monday])

  useEffect(() => { reload() }, [reload])
  useEffect(() => { setEditing(null); setViewing(null) }, [athlete?.id, monday])

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

      <div className="week">
        {weekDays(monday).map((d) => {
          const day = workouts.filter((w) => w.date === d)
          return (
            <div key={d} className={'day' + (d === today() ? ' is-today' : '')}>
              <div className="day-head">{dayShort(d)} <span className="muted">{fmtShort(d)}</span></div>
              {day.map((w) => (
                <WorkoutCard key={w.id} w={w} athletes={athletes} results={results}
                  onOpen={() => { setViewing(null); setEditing({ date: d, workout: w }) }}
                  onResults={() => { setEditing(null); setViewing(w.id) }} onChanged={reload} />
              ))}
              {day.length === 0 && <span className="muted rest">отдых</span>}
              <button className="add-day" onClick={() => setEditing({ date: d, workout: null })} aria-label={`Добавить тренировку ${d}`}>+</button>
            </div>
          )
        })}
      </div>

      {viewing && workouts.some((w) => w.id === viewing) && (
        <section className="editor card">
          <div className="row-between"><b>Результаты — {athlete.name}</b><button className="back" onClick={() => setViewing(null)}>✕</button></div>
          <WorkoutView workout={workouts.find((w) => w.id === viewing)!} results={results} comments={comments} history={[]}
            me={me.id} names={{ [me.id]: me.name, [athlete.id]: athlete.name }} editable={false}
            onComment={async (item_id, text) => {
              const { error } = await supabase.from('comments').insert({ workout_id: viewing, item_id, text })
              if (error) alert('Не отправилось: ' + error.message)
              reload()
            }} />
        </section>
      )}

      {editing && (
        <WorkoutEditor key={(editing.workout?.id ?? 'new') + editing.date}
          athleteId={athlete.id} athleteName={athlete.name} date={editing.date} workout={editing.workout}
          exercises={exercises} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }} />
      )}
    </>
  )
}

function WorkoutCard({ w, athletes, results, onOpen, onResults, onChanged }: {
  w: Workout; athletes: Athlete[]; results: SetResult[]; onOpen: () => void; onResults: () => void; onChanged: () => void
}) {
  const [mode, setMode] = useState<'copy' | 'move' | null>(null)
  const [to, setTo] = useState(w.athlete_id)
  const [date, setDate] = useState(addDays(w.date, 7))
  const items = (w.workout_items ?? []).sort((a, b) => a.position - b.position)
  const mine = results.filter((r) => items.some((i) => i.id === r.item_id))
  const p = progress(items, mine)

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    if (error) return alert('Не получилось: ' + error.message)
    setMode(null)
    onChanged()
  }
  const remove = () => {
    const warn = mine.length ? '\n\nАтлет уже внёс результаты — они тоже удалятся.' : ''
    if (confirm(`Удалить тренировку «${w.title || 'Тренировка'}»?${warn}`)) run(supabase.from('workouts').delete().eq('id', w.id))
  }

  return (
    <div className={'wcard' + (w.published ? '' : ' draft')}>
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
