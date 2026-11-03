import { useState, type FormEvent } from 'react'
import type { Profile } from '../supabase'
import { Logo } from '../App'

const FIELDS: [keyof Profile, string, boolean][] = [
  ['name', 'Имя и фамилия', false],
  ['city', 'Город', false],
  ['timezone', 'Часовой пояс', false],
  ['goals', 'Цели', true],
  ['equipment', 'Оборудование (что есть дома / в зале)', true],
  ['health_limits', 'Ограничения по здоровью', true],
]

/** Анкета атлета (и имя тренера). first — первый вход: спрашиваем только имя. */
export function MyProfile({ profile, onSave, first }: { profile: Profile; onSave: (p: Partial<Profile>) => Promise<void>; first?: boolean }) {
  const [form, setForm] = useState(profile)
  const [saved, setSaved] = useState(false)
  const fields = first ? FIELDS.slice(0, 1) : FIELDS

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const patch = Object.fromEntries(fields.map(([k]) => [k, String(form[k] ?? '').trim()])) as Partial<Profile>
    if (first) patch.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    await onSave(patch)
    setSaved(true)
  }

  const body = (
    <form onSubmit={submit}>
      {first && <h2>Как вас зовут?</h2>}
      {fields.map(([k, label, multi]) => (
        <label key={k}>{label}
          {multi
            ? <textarea rows={3} value={String(form[k] ?? '')} onChange={(e) => { setForm({ ...form, [k]: e.target.value }); setSaved(false) }} />
            : <input required={k === 'name'} value={String(form[k] ?? '')} onChange={(e) => { setForm({ ...form, [k]: e.target.value }); setSaved(false) }} />}
        </label>
      ))}
      <button className="btn">{first ? 'Продолжить' : saved ? 'Сохранено ✓' : 'Сохранить'}</button>
    </form>
  )

  if (!first) return body
  return (
    <div className="page">
      <header className="top"><Logo /></header>
      <main className="narrow">{body}</main>
    </div>
  )
}
