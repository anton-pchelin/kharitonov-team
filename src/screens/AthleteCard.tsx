import { useEffect, useState } from 'react'
import { supabase, type Profile } from '../supabase'
import { extendAccess, today } from '../lib/dates'

/** Профиль атлета глазами тренера: анкета атлета + своя заметка. */
export function AthleteCard({ id }: { id: string }) {
  const [p, setP] = useState<Profile | null>(null)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(true)
  const [visible, setVisible] = useState<number | null>(null)
  const [until, setUntil] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      supabase.from('coach_athletes').select('note, visible_days, access_until').eq('athlete_id', id).single(),
    ]).then(([a, b]) => {
      setP(a.data)
      setNote(b.data?.note ?? '')
      setVisible(b.data?.visible_days ?? null)
      setUntil(b.data?.access_until ?? null)
    })
  }, [id])

  const saveNote = async () => {
    const { error } = await supabase.from('coach_athletes').update({ note }).eq('athlete_id', id)
    if (error) alert('Не сохранилось: ' + error.message)
    else setSaved(true)
  }

  const saveUntil = async (v: string | null) => {
    setPicking(false)
    const { error } = await supabase.from('coach_athletes').update({ access_until: v }).eq('athlete_id', id)
    if (error) alert('Не сохранилось: ' + error.message)
    else setUntil(v)
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
        <div className="row-between">
          <span>Доступ до: <b className={until && until < today() ? 'danger' : ''}>
            {until ? new Date(until + 'T00:00:00').toLocaleDateString('ru-RU') : 'Без ограничения'}
          </b></span>
        </div>
        <div className="row">
          <button className="btn" onClick={() => saveUntil(extendAccess(until))}>+1 мес</button>
          <button className="btn secondary" onClick={() => setPicking(!picking)}>До даты…</button>
        </div>
        {picking && (
          <div className="row">
            <input type="date" defaultValue={until ?? ''} aria-label="Доступ до"
              onChange={(e) => e.target.value && saveUntil(e.target.value)} />
            <button className="btn secondary" onClick={() => saveUntil(null)}>Стереть дату</button>
          </div>
        )}
      </div>
      <div className="card">
        {rows.map(([label, value]) => (
          <div key={label} className="field">
            <span className="muted">{label}</span>
            <span className="pre">{value || '—'}</span>
          </div>
        ))}
      </div>
      <label>Атлет видит план вперёд
        <select value={visible ?? ''} onChange={async (e) => {
          const v = e.target.value === '' ? null : Number(e.target.value)
          setVisible(v)
          const { error } = await supabase.from('coach_athletes').update({ visible_days: v }).eq('athlete_id', id)
          if (error) alert('Не сохранилось: ' + error.message)
        }}>
          <option value="">весь план</option>
          <option value="0">только сегодня</option>
          <option value="1">на 1 день вперёд</option>
          <option value="3">на 3 дня вперёд</option>
          <option value="7">на 7 дней вперёд</option>
        </select>
      </label>
      <label>Заметка тренера (атлет её не видит)
        <textarea rows={4} value={note} onChange={(e) => { setNote(e.target.value); setSaved(false) }} />
      </label>
      <button className="btn" onClick={saveNote} disabled={saved}>{saved ? 'Сохранено ✓' : 'Сохранить заметку'}</button>
    </>
  )
}
