import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { Exercise } from '../search'
import { loadExercises } from './Exercises'
import { WorkoutEditor, type Draft, snapshot } from './WorkoutEditor'
import { DAY_SHORT } from '../lib/dates'
import type { WorkoutItem } from '../lib/workout'

type Program = { id: string; name: string; weeks: number }
type PW = { id: string; week: number; day: number; title: string; prescription: string; items: WorkoutItem[] }
type Template = { id: string; title: string; items: WorkoutItem[] }

/** «Шаблоны и программы» тренера: список программ, конструктор программы N недель × 7 дней, шаблоны тренировок. */
export function Programs({ id }: { id?: string }) {
  if (id) return <ProgramEditor id={id} />
  return <ProgramList />
}

function ProgramList() {
  const [programs, setPrograms] = useState<Program[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [name, setName] = useState('')
  const [weeks, setWeeks] = useState(4)
  const load = () => {
    supabase.from('programs').select('*').order('name').then(({ data }) => setPrograms(data ?? []))
    supabase.from('workout_templates').select('id, title, items').order('title').then(({ data }) => setTemplates((data ?? []) as Template[]))
  }
  useEffect(load, [])

  const create = async () => {
    const { data, error } = await supabase.from('programs').insert({ name: name.trim(), weeks }).select('id').single()
    if (error) return alert('Не получилось: ' + error.message)
    location.hash = `#/programs/${data.id}`
  }
  return (
    <>
      <a href="#/plan" className="back">← План</a>
      <h2>Программы</h2>
      {programs.map((p) => (
        <a key={p.id} className="card link" href={`#/programs/${p.id}`}><b>{p.name}</b><span className="muted">{p.weeks} нед.</span></a>
      ))}
      <div className="card">
        <input placeholder="Название программы, например «Неделя 1»" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <span className="muted">Недель:</span>
          <div className="stepper">
            <button type="button" onClick={() => setWeeks(Math.max(1, weeks - 1))} aria-label="Меньше недель">−</button>
            <span>{weeks}</span>
            <button type="button" onClick={() => setWeeks(Math.min(52, weeks + 1))} aria-label="Больше недель">+</button>
          </div>
        </div>
        <button className="btn" disabled={!name.trim()} onClick={create}>Создать программу</button>
      </div>

      <h2>Шаблоны тренировок</h2>
      {!templates.length && <p className="muted">Сохраните любую тренировку как шаблон: меню ⋯ у карточки в «Плане».</p>}
      {templates.map((t) => (
        <div key={t.id} className="card row-between">
          <span><b>{t.title || 'Тренировка'}</b> <span className="muted">{t.items.map((i) => i.name).join(', ')}</span></span>
          <button className="link-btn" aria-label="Удалить шаблон" onClick={async () => {
            if (confirm(`Удалить шаблон «${t.title}»? Уже назначенные тренировки не изменятся.`)) {
              await supabase.from('workout_templates').delete().eq('id', t.id)
              load()
            }
          }}>✕</button>
        </div>
      ))}
    </>
  )
}

function ProgramEditor({ id }: { id: string }) {
  const [program, setProgram] = useState<Program | null>(null)
  const [days, setDays] = useState<PW[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [editing, setEditing] = useState<{ week: number; day: number; pw: PW | null } | null>(null)
  const load = () => {
    supabase.from('programs').select('*').eq('id', id).single().then(({ data }) => setProgram(data))
    supabase.from('program_workouts').select('*').eq('program_id', id).order('created_at').then(({ data }) => setDays((data ?? []) as PW[]))
  }
  useEffect(() => { load(); loadExercises().then(setExercises, () => {}) }, [id])
  if (!program) return <p className="muted">Загрузка…</p>

  const save = (week: number, day: number, pw: PW | null) => async (d: Draft) => {
    const row = { program_id: id, week, day, title: d.title, prescription: d.prescription, items: snapshot(d.items) }
    const { error } = pw ? await supabase.from('program_workouts').update(row).eq('id', pw.id) : await supabase.from('program_workouts').insert(row)
    return error?.message ?? null
  }
  const setWeeks = async (weeks: number) => {
    await supabase.from('programs').update({ weeks }).eq('id', id)
    load()
  }

  return (
    <>
      <a href="#/programs" className="back">← Программы</a>
      <div className="row-between">
        <h2>{program.name}</h2>
        <button className="link-btn" onClick={async () => {
          if (confirm(`Удалить программу «${program.name}»? Уже назначенные тренировки останутся.`)) {
            await supabase.from('programs').delete().eq('id', id)
            location.hash = '#/programs'
          }
        }}>Удалить</button>
      </div>
      {Array.from({ length: program.weeks }, (_, w) => w + 1).map((week) => (
        <div key={week}>
          <h3>Неделя {week}</h3>
          <div className="week">
            {DAY_SHORT.map((label, day) => (
              <div key={day} className="day">
                <div className="day-head">{label}</div>
                {days.filter((d) => d.week === week && d.day === day).map((d) => (
                  <div key={d.id} className="wcard">
                    <button className="wcard-open" onClick={() => setEditing({ week, day, pw: d })}>
                      <b>{d.title || 'Тренировка'}</b>
                      <ul>{d.items.slice(0, 6).map((i, k) => <li key={k}>{i.name}</li>)}</ul>
                    </button>
                    <details className="menu">
                      <summary aria-label="Меню дня программы">⋯</summary>
                      <div className="menu-list">
                        <button onClick={() => setEditing({ week, day, pw: d })}>Редактировать</button>
                        <button onClick={async () => { await supabase.from('program_workouts').delete().eq('id', d.id); load() }}>Удалить</button>
                      </div>
                    </details>
                  </div>
                ))}
                <button className="add-day" onClick={() => setEditing({ week, day, pw: null })} aria-label={`Добавить: неделя ${week}, ${label}`}>+</button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <button className="btn secondary" onClick={() => setWeeks(program.weeks + 1)}>+ неделя</button>
      {program.weeks > 1 && <button className="btn secondary" onClick={() => setWeeks(program.weeks - 1)}>− убрать последнюю неделю</button>}

      {editing && (
        <WorkoutEditor key={`${editing.week}-${editing.day}-${editing.pw?.id ?? 'new'}`}
          heading={`${program.name}: неделя ${editing.week}, ${DAY_SHORT[editing.day]}`}
          workout={null} template={editing.pw ?? undefined} exercises={exercises}
          save={save(editing.week, editing.day, editing.pw)}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </>
  )
}
