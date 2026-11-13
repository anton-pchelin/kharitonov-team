import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { addDays, fmtShort, mondayOf } from '../lib/dates'

type Athlete = { id: string; name: string }
type Group = { id: string; name: string; members: string[] }
type Conflict = 'add' | 'replace' | 'skip'

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
  const run = async () => {
    const { data, error } = await supabase.rpc('copy_week', {
      p_from_athlete: athlete.id, p_from_monday: monday, p_athletes: to, p_to_monday: mondayOf(week), p_conflict: conflict, p_move: move,
    })
    if (error) return alert('Не получилось: ' + error.message)
    alert(`Готово: тренировок положено — ${data}`)
    onDone()
  }
  return (
    <div className="card dialog">
      <b>{move ? 'Перенести' : 'Скопировать'} неделю {fmtShort(monday)} — {fmtShort(addDays(monday, 6))}</b>
      <Targets athletes={athletes} value={to} onChange={setTo} />
      <label>На неделю, начиная с<input type="date" value={week} onChange={(e) => setWeek(e.target.value)} /></label>
      <ConflictPick value={conflict} onChange={setConflict} />
      <label className="switch"><input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} /><span>Перенести (убрать с этой недели)</span></label>
      <button className="btn" disabled={!to.length} onClick={run}>{move ? 'Перенести' : 'Скопировать'}</button>
      <button className="btn secondary" onClick={onDone}>Отмена</button>
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
  const run = async () => {
    const { data, error } = await supabase.rpc('assign_program', { p_program: program, p_athletes: to, p_start: mondayOf(start), p_conflict: conflict })
    if (error) return alert('Не получилось: ' + error.message)
    alert(`Готово: тренировок положено — ${data}`)
    onDone()
  }
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
          <button className="btn" disabled={!to.length || !program} onClick={run}>Назначить</button>
        </>
      )}
      <button className="btn secondary" onClick={onDone}>Отмена</button>
    </div>
  )
}
