import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { addDays, dayShort, fmtShort, mondayOf } from '../lib/dates'
import type { Workout } from '../lib/workout'
import { loadMyAthletes } from './Plan'

type Athlete = { id: string; name: string }
type Group = { id: string; name: string; members: string[] }
type Conflict = 'add' | 'replace' | 'skip'
const REASONS = {
  occupied: 'день занят',
  target_history: 'в этом дне есть тренировка с результатами или комментариями',
  same_day: 'та же неделя и тот же атлет',
  source_history: 'исходная тренировка с историей осталась на месте',
  source_kept: 'исходная тренировка осталась на месте, так как перенеслась не всем',
}
type Report = {
  placed: number
  moved: number
  issues: { athlete_id: string; date: string; reason: keyof typeof REASONS }[]
}

function OperationReport({ report, athletes, onDone }: { report: Report; athletes: Athlete[]; onDone: () => void }) {
  return (
    <div className="card dialog">
      <b>Добавлено в планы — {report.placed}. Перенесено исходных тренировок — {report.moved}.</b>
      {report.issues.length > 0 && <ul>{report.issues.map((issue, i) => (
        <li key={i}>{athletes.find((a) => a.id === issue.athlete_id)?.name ?? 'Атлет'} · {fmtShort(issue.date)} · {REASONS[issue.reason]}</li>
      ))}</ul>}
      <button className="btn" onClick={onDone}>Готово</button>
    </div>
  )
}

export async function loadGroups(): Promise<Group[]> {
  const { data } = await supabase.from('athlete_groups').select('id, name, group_members(athlete_id)').order('name')
  return ((data ?? []) as { id: string; name: string; group_members: { athlete_id: string }[] }[])
    .map((g) => ({ id: g.id, name: g.name, members: g.group_members.map((m) => m.athlete_id) }))
}

/** Кому: атлеты и группы (группа = все её атлеты, каждому своя копия). */
function Targets({ athletes, value, onChange }: { athletes: Athlete[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [groups, setGroups] = useState<Group[]>([])
  useEffect(() => { loadGroups().then(setGroups) }, [])
  const toggle = (ids: string[], on: boolean) => onChange(on ? [...new Set([...value, ...ids])] : value.filter((v) => !ids.includes(v)))
  return (
    <div className="targets">
      {groups.map((g) => (
        <label key={g.id} className="switch">
          <input type="checkbox" checked={g.members.length > 0 && g.members.every((m) => value.includes(m))} onChange={(e) => toggle(g.members, e.target.checked)} />
          <span><b>Группа: {g.name}</b> <span className="muted">({g.members.length})</span></span>
        </label>
      ))}
      {athletes.map((a) => (
        <label key={a.id} className="switch">
          <input type="checkbox" checked={value.includes(a.id)} onChange={(e) => toggle([a.id], e.target.checked)} />
          <span>{a.name}</span>
        </label>
      ))}
    </div>
  )
}

function ConflictPick({ value, onChange }: { value: Conflict; onChange: (c: Conflict) => void }) {
  return (
    <label>Если в этот день уже есть тренировка
      <select value={value} onChange={(e) => onChange(e.target.value as Conflict)}>
        <option value="add">добавить рядом</option>
        <option value="replace">заменить</option>
        <option value="skip">пропустить день</option>
      </select>
    </label>
  )
}

/** «Копировать неделю»: эту неделю атлета — атлетам или группе на выбранную неделю (можно перенести). */
export function CopyWeek({ athlete, monday, athletes, onDone }: { athlete: Athlete; monday: string; athletes: Athlete[]; onDone: () => void }) {
  const [to, setTo] = useState<string[]>([athlete.id])
  const [week, setWeek] = useState(addDays(monday, 7))
  const [conflict, setConflict] = useState<Conflict>('add')
  const [move, setMove] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('copy_week_report', {
      p_from_athlete: athlete.id, p_from_monday: monday, p_athletes: to, p_to_monday: mondayOf(week), p_conflict: conflict, p_move: move,
    })
    setBusy(false)
    if (error) return alert('Не получилось: ' + error.message)
    setReport(data as Report)
  }
  if (report) return <OperationReport report={report} athletes={athletes} onDone={onDone} />
  return (
    <div className="card dialog">
      <b>{move ? 'Перенести' : 'Скопировать'} неделю {fmtShort(monday)} — {fmtShort(addDays(monday, 6))}</b>
      <Targets athletes={athletes} value={to} onChange={setTo} />
      <label>На неделю, начиная с<input type="date" value={week} onChange={(e) => setWeek(e.target.value)} /></label>
      <ConflictPick value={conflict} onChange={setConflict} />
      <label className="switch"><input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} /><span>Перенести (убрать с этой недели)</span></label>
      <button className="btn" disabled={busy || !to.length || !week} onClick={run}>{busy ? 'Выполняю…' : move ? 'Перенести' : 'Скопировать'}</button>
      <button className="btn secondary" disabled={busy} onClick={onDone}>Отмена</button>
    </div>
  )
}

/** «Назначить программу»: атлету или группе с выбранного понедельника. */
export function AssignProgram({ athlete, monday, athletes, onDone }: { athlete: Athlete; monday: string; athletes: Athlete[]; onDone: () => void }) {
  const [programs, setPrograms] = useState<{ id: string; name: string; weeks: number }[]>([])
  const [program, setProgram] = useState('')
  const [to, setTo] = useState<string[]>([athlete.id])
  const [start, setStart] = useState(monday)
  const [conflict, setConflict] = useState<Conflict>('add')
  useEffect(() => {
    supabase.from('programs').select('id, name, weeks').order('name').then(({ data }) => {
      setPrograms(data ?? [])
      setProgram(data?.[0]?.id ?? '')
    })
  }, [])
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('assign_program_report', { p_program: program, p_athletes: to, p_start: mondayOf(start), p_conflict: conflict })
    setBusy(false)
    if (error) return alert('Не получилось: ' + error.message)
    setReport(data as Report)
  }
  if (report) return <OperationReport report={report} athletes={athletes} onDone={onDone} />
  return (
    <div className="card dialog">
      <b>Назначить программу</b>
      {!programs.length && <p className="muted">Программ пока нет — создайте в разделе <a href="#/programs">«Шаблоны и программы»</a>.</p>}
      {programs.length > 0 && (
        <>
          <select value={program} onChange={(e) => setProgram(e.target.value)} aria-label="Программа">
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.weeks} нед.)</option>)}
          </select>
          <Targets athletes={athletes} value={to} onChange={setTo} />
          <label>С понедельника<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <ConflictPick value={conflict} onChange={setConflict} />
          <button className="btn" disabled={busy || !to.length || !program || !start} onClick={run}>{busy ? 'Назначаю…' : 'Назначить'}</button>
        </>
      )}
      <button className="btn secondary" disabled={busy} onClick={onDone}>Отмена</button>
    </div>
  )
}

/** Готовая тренировка из другого дня: атлет (из своих), неделя ‹ ›, тренировка → «Взять». Свои тренировки атлета не предлагаются. */
export function PickWorkout({ athleteId, monday, onPick, onCancel }: {
  athleteId: string; monday: string; onPick: (w: Workout) => void; onCancel: () => void
}) {
  const [athletes, setAthletes] = useState<Athlete[]>([])
  const [who, setWho] = useState(athleteId)
  const [mon, setMon] = useState(addDays(monday, -7))
  const [list, setList] = useState<Workout[] | null>(null)
  const [sel, setSel] = useState<Workout | null>(null)
  useEffect(() => { loadMyAthletes().then(setAthletes, () => {}) }, [])
  useEffect(() => {
    setList(null)
    setSel(null)
    supabase.from('workouts').select('*, workout_items(*)').eq('athlete_id', who).eq('self', false)
      .gte('date', mon).lte('date', addDays(mon, 6)).order('date')
      .then(({ data, error }) => { if (error) alert('Не загрузилось: ' + error.message); setList((data ?? []) as Workout[]) })
  }, [who, mon])

  return (
    <div className="card pick-workout">
      <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Атлет">
        {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <div className="week-nav">
        <button className="btn small secondary" onClick={() => setMon(addDays(mon, -7))} aria-label="Неделя раньше">‹</button>
        <span>{fmtShort(mon)} — {fmtShort(addDays(mon, 6))}</span>
        <button className="btn small secondary" onClick={() => setMon(addDays(mon, 7))} aria-label="Неделя позже">›</button>
      </div>
      {list === null && <p className="muted">Загрузка…</p>}
      {list?.length === 0 && <p className="muted">На этой неделе тренировок нет</p>}
      {list && list.length > 0 && (
        <div className="suggest">
          {list.map((w) => (
            <button key={w.id} className={sel?.id === w.id ? 'active' : ''} aria-pressed={sel?.id === w.id} onClick={() => setSel(w)}>
              <b>{dayShort(w.date)} {fmtShort(w.date)} · {w.title || 'Тренировка'}</b>
              <br /><span className="muted">{(w.workout_items ?? []).filter((i) => !i.self).sort((a, b) => a.position - b.position).map((i) => i.name).join(', ')}</span>
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn" disabled={!sel} onClick={() => sel && onPick(sel)}>Взять</button>
        <button className="btn secondary" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  )
}
