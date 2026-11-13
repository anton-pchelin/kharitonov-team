import { useEffect, useState } from 'react'
import { supabase, type Profile } from '../supabase'

/** Профиль атлета глазами тренера: анкета атлета + своя заметка. */
export function AthleteCard({ id }: { id: string }) {
  const [p, setP] = useState<Profile | null>(null)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      supabase.from('coach_athletes').select('note').eq('athlete_id', id).single(),
    ]).then(([a, b]) => {
      setP(a.data)
      setNote(b.data?.note ?? '')
    })
  }, [id])

  const saveNote = async () => {
    const { error } = await supabase.from('coach_athletes').update({ note }).eq('athlete_id', id)
    if (error) alert('Не сохранилось: ' + error.message)
    else setSaved(true)
  }

  if (!p) return <p className="muted">Загрузка…</p>
  const rows: [string, string][] = [
    ['Email', p.email ?? ''], ['Город', p.city], ['Часовой пояс', p.timezone],
    ['Цели', p.goals], ['Оборудование', p.equipment], ['Ограничения по здоровью', p.health_limits],
  ]
  return (
    <>
      <a href="#/athletes" className="back">← Атлеты</a>
      <h2>{p.name || p.email}</h2>
      <div className="row">
        <a className="btn" href={`#/plan/${id}`}>План тренировок</a>
        <a className="btn secondary" href={`#/progress/${id}`}>Прогресс</a>
      </div>
      <div className="card">
        {rows.map(([label, value]) => (
          <div key={label} className="field">
            <span className="muted">{label}</span>
            <span className="pre">{value || '—'}</span>
          </div>
        ))}
      </div>
      <label>Заметка тренера (атлет её не видит)
        <textarea rows={4} value={note} onChange={(e) => { setNote(e.target.value); setSaved(false) }} />
      </label>
      <button className="btn" onClick={saveNote} disabled={saved}>{saved ? 'Сохранено ✓' : 'Сохранить заметку'}</button>
    </>
  )
}
