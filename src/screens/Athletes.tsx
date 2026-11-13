import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { addDays, today } from '../lib/dates'

type Row = { athlete_id: string; profiles: { name: string; email: string | null; city: string } | null }

export function Athletes() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [pct, setPct] = useState<Record<string, string>>({})

  useEffect(() => {
    // % выполнения плана за неделю и месяц
    Promise.all([7, 30].map((d) => supabase.rpc('completion_stats', { p_from: addDays(today(), -d) }))).then(([w, m]) => {
      const f = (r: { athlete_id: string; planned: number; done: number }) => (r.planned ? Math.round((r.done / r.planned) * 100) + '%' : '—')
      const week = Object.fromEntries(((w.data ?? []) as Parameters<typeof f>[0][]).map((r) => [r.athlete_id, f(r)]))
      const month = Object.fromEntries(((m.data ?? []) as Parameters<typeof f>[0][]).map((r) => [r.athlete_id, f(r)]))
      setPct(Object.fromEntries([...new Set([...Object.keys(week), ...Object.keys(month)])].map((id) => [id, `неделя ${week[id] ?? '—'} · месяц ${month[id] ?? '—'}`])))
    })
  }, [])

  useEffect(() => {
    supabase
      .from('coach_athletes')
      .select('athlete_id, profiles!coach_athletes_athlete_id_fkey(name, email, city)')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) alert('Не загрузилось: ' + error.message)
        setRows((data as unknown as Row[]) ?? [])
      })
  }, [])

  const invite = async () => {
    const { data, error } = await supabase.from('invites').insert({}).select('token').single()
    if (error) return alert('Не получилось: ' + error.message)
    setLink(`${location.origin}${location.pathname}#/invite/${data.token}`)
    setCopied(false)
  }

  const copy = async () => {
    await navigator.clipboard.writeText(link)
    setCopied(true)
  }

  return (
    <>
      <div className="row-between">
        <h2>Атлеты {rows && <span className="muted">· {rows.length}</span>}</h2>
        <button className="btn small" onClick={invite}>Пригласить</button>
      </div>
      {link && (
        <div className="card">
          <p>Ссылка для одного атлета, действует 7 дней:</p>
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <div className="row">
            <button className="btn" onClick={copy}>{copied ? 'Скопировано ✓' : 'Скопировать'}</button>
            {'share' in navigator && (
              <button className="btn secondary" onClick={() => navigator.share({ title: 'Kharitonov team', text: 'Приглашение на тренировки', url: link })}>
                Отправить
              </button>
            )}
          </div>
        </div>
      )}
      {rows === null && <p className="muted">Загрузка…</p>}
      {rows?.length === 0 && <p className="muted">Пока никого. Нажмите «Пригласить» и отправьте ссылку атлету.</p>}
      {rows?.map((r) => (
        <a key={r.athlete_id} className="card link" href={`#/athlete/${r.athlete_id}`}>
          <b>{r.profiles?.name || r.profiles?.email}</b>
          <span className="muted">{[pct[r.athlete_id], r.profiles?.city].filter(Boolean).join(' · ')}</span>
        </a>
      ))}
    </>
  )
}
