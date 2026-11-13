import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { addDays, today } from '../lib/dates'
import { loadGroups } from './WeekTools'

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
      {rows && rows.length > 0 && <Groups athletes={rows.map((r) => ({ id: r.athlete_id, name: r.profiles?.name || 'Без имени' }))} />}
    </>
  )
}

/** Группы атлетов: тренировка или программа группе = копия каждому. Удаление из группы не трогает назначенное. */
function Groups({ athletes }: { athletes: { id: string; name: string }[] }) {
  const [groups, setGroups] = useState<Awaited<ReturnType<typeof loadGroups>>>([])
  const [name, setName] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = () => { loadGroups().then(setGroups) }
  useEffect(load, [])

  const toggle = async (groupId: string, athleteId: string, on: boolean) => {
    const { error } = on
      ? await supabase.from('group_members').insert({ group_id: groupId, athlete_id: athleteId })
      : await supabase.from('group_members').delete().eq('group_id', groupId).eq('athlete_id', athleteId)
    if (error) alert('Не получилось: ' + error.message)
    load()
  }
  return (
    <>
      <h2>Группы</h2>
      {groups.map((g) => (
        <div key={g.id} className="card">
          <button className="row-between link-row" onClick={() => setOpen(open === g.id ? null : g.id)}>
            <b>{g.name}</b><span className="muted">{g.members.length} атл. {open === g.id ? '▲' : '▼'}</span>
          </button>
          {open === g.id && (
            <>
              {athletes.map((a) => (
                <label key={a.id} className="switch">
                  <input type="checkbox" checked={g.members.includes(a.id)} onChange={(e) => toggle(g.id, a.id, e.target.checked)} />
                  <span>{a.name}</span>
                </label>
              ))}
              <button className="link-btn" onClick={async () => {
                if (confirm(`Удалить группу «${g.name}»? Назначенные тренировки останутся.`)) { await supabase.from('athlete_groups').delete().eq('id', g.id); load() }
              }}>Удалить группу</button>
            </>
          )}
        </div>
      ))}
      <form className="row" onSubmit={async (e) => {
        e.preventDefault()
        const { error } = await supabase.from('athlete_groups').insert({ name: name.trim() })
        if (error) return alert('Не получилось: ' + error.message)
        setName('')
        load()
      }}>
        <input placeholder="Новая группа" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="btn small">Создать</button>
      </form>
    </>
  )
}
