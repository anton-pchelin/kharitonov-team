import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { LineChart } from '../lib/LineChart'
import { compressImage } from '../lib/photo'
import { exerciseKey, fieldSeries, records, weeklyStats, weightSeries } from '../lib/progress'
import { fmtNum, fmtTime, parseNum } from '../lib/format'
import { addDays, fmtShort, mondayOf, today } from '../lib/dates'
import type { PastSet } from '../lib/offline'

type SetRow = PastSet & { workout_id: string; result_type: string }
type ManualRecord = { id: string; name: string; weight: number | null; reps: number | null; time_sec: number | null; meters: number | null; date: string; note: string }
type Measurement = { id: string; kind: string; value: number; date: string }
type Photo = { id: string; date: string; pose: 'front' | 'side' | 'back'; path: string; url?: string | null }

const TABS = [['ex', 'Упражнения'], ['rec', 'Рекорды'], ['meas', 'Замеры'], ['photo', 'Фото'], ['week', 'Регулярность']] as const
const KINDS = ['Вес', 'Рост', 'Талия', 'Грудь', 'Бёдра', 'Руки']
const POSES = { front: 'спереди', side: 'сбоку', back: 'сзади' }

async function loadSets(athleteId: string): Promise<SetRow[]> {
  const { data } = await supabase.from('set_results')
    .select('item_id, set_no, weight, reps, time_sec, meters, calories, rounds, done, workout_items!inner(name, exercise_id, result_type, workout_id, workouts!inner(date))')
    .eq('athlete_id', athleteId)
  type Row = PastSet & { workout_items: { name: string; exercise_id: string | null; result_type: string; workout_id: string; workouts: { date: string } } }
  return ((data ?? []) as unknown as Row[]).map(({ workout_items: i, ...s }) => ({
    ...s, weight: s.weight == null ? null : Number(s.weight), meters: s.meters == null ? null : Number(s.meters),
    name: i.name, exercise_id: i.exercise_id, result_type: i.result_type, workout_id: i.workout_id, date: i.workouts.date,
  }))
}

/** «Прогресс» атлета: графики по упражнениям, рекорды, замеры, фото, регулярность. Тренер видит то же. */
export function Progress({ athleteId, title }: { athleteId: string; title?: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('ex')
  const [sets, setSets] = useState<SetRow[] | null>(null)
  const [lowerBetter, setLowerBetter] = useState<Record<string, boolean>>({})
  useEffect(() => {
    loadSets(athleteId).then(setSets)
    supabase.from('exercises').select('id').eq('lower_is_better', true)
      .then(({ data }) => setLowerBetter(Object.fromEntries((data ?? []).map((e) => [e.id, true]))))
  }, [athleteId])

  return (
    <>
      {title && <h2>{title}</h2>}
      <div className="chips">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'chip on' : 'chip'} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {sets === null && <p className="muted">Загрузка…</p>}
      {sets && tab === 'ex' && <ByExercise sets={sets} lowerBetter={lowerBetter} />}
      {sets && tab === 'rec' && <Records sets={sets} lowerBetter={lowerBetter} athleteId={athleteId} />}
      {tab === 'meas' && <Measurements athleteId={athleteId} />}
      {tab === 'photo' && <Photos athleteId={athleteId} />}
      {sets && tab === 'week' && <Weekly sets={sets} athleteId={athleteId} />}
    </>
  )
}

function groups(sets: SetRow[]) {
  const m = new Map<string, { name: string; sets: SetRow[] }>()
  for (const s of sets) {
    const k = exerciseKey(s)
    const g = m.get(k) ?? { name: s.name, sets: [] }
    g.sets.push(s)
    m.set(k, g)
  }
  return [...m.entries()].sort((a, b) => b[1].sets.length - a[1].sets.length)
}

function ByExercise({ sets, lowerBetter }: { sets: SetRow[]; lowerBetter: Record<string, boolean> }) {
  const list = useMemo(() => groups(sets), [sets])
  const [key, setKey] = useState(list[0]?.[0] ?? '')
  const g = list.find(([k]) => k === key)?.[1]
  if (!list.length) return <p className="muted">Пока нет результатов — они появятся после первой тренировки.</p>
  const withWeight = g?.sets.some((s) => s.weight)
  const lower = !!lowerBetter[key]
  return (
    <>
      <select value={key} onChange={(e) => setKey(e.target.value)} aria-label="Упражнение">
        {list.map(([k, v]) => <option key={k} value={k}>{v.name} ({new Set(v.sets.map((s) => s.date)).size})</option>)}
      </select>
      {g && withWeight && (() => {
        const { best, e1rm } = weightSeries(g.sets)
        return <LineChart unit="кг" format={fmtNum} series={[{ label: 'Лучший вес', points: best }, { label: 'Расчётный 1ПМ', points: e1rm, muted: true }]} />
      })()}
      {g && !withWeight && g.sets.some((s) => s.time_sec != null) && (
        <LineChart unit="" format={fmtTime} series={[{ label: lower ? 'Лучшее время (меньше — лучше)' : 'Лучшее время', points: fieldSeries(g.sets, 'time_sec', lower) }]} />
      )}
      {g && !withWeight && !g.sets.some((s) => s.time_sec != null) && (
        <LineChart unit="повт" series={[{ label: 'Повторения', points: fieldSeries(g.sets, g.sets.some((s) => s.reps != null) ? 'reps' : g.sets.some((s) => s.meters != null) ? 'meters' : 'rounds') }]} />
      )}
      <table className="history">
        <thead><tr><th>Дата</th><th>Подходы</th></tr></thead>
        <tbody>
          {[...new Set(g?.sets.map((s) => s.date))].sort().reverse().map((d) => (
            <tr key={d}>
              <td>{fmtShort(d)}</td>
              <td>{g!.sets.filter((s) => s.date === d).sort((a, b) => a.set_no - b.set_no).map((s) =>
                [s.weight != null && `${fmtNum(s.weight)} кг`, s.reps != null && `${s.reps}`, s.time_sec != null && fmtTime(s.time_sec),
                  s.meters != null && `${fmtNum(s.meters)} м`, s.rounds != null && `${s.rounds} кр.`].filter(Boolean).join(' × ') || '✓').join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function Records({ sets, lowerBetter, athleteId }: { sets: SetRow[]; lowerBetter: Record<string, boolean>; athleteId: string }) {
  const [manual, setManual] = useState<ManualRecord[]>([])
  const [form, setForm] = useState({ name: '', weight: '', reps: '', date: today(), note: '' })
  const load = () => supabase.from('records').select('*').eq('athlete_id', athleteId).order('date', { ascending: false })
    .then(({ data }) => setManual((data ?? []) as ManualRecord[]))
  useEffect(() => { load() }, [athleteId])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('records').insert({
      athlete_id: athleteId, name: form.name.trim(), weight: parseNum(form.weight), reps: parseNum(form.reps), date: form.date, note: form.note,
    })
    if (error) return alert('Не сохранилось: ' + error.message)
    setForm({ ...form, name: '', weight: '', reps: '', note: '' })
    load()
  }
  const remove = async (id: string) => {
    if (!confirm('Удалить этот рекорд?')) return
    await supabase.from('records').delete().eq('id', id)
    load()
  }

  return (
    <>
      {groups(sets).map(([k, g]) => {
        const r = records(g.sets, lowerBetter[k])
        const parts = [
          ...r.byReps.map((b) => `${b.reps} повт: ${fmtNum(b.weight)} кг`),
          r.e1rm && `1ПМ ≈ ${fmtNum(r.e1rm)} кг`,
          !r.byReps.length && r.maxReps != null && `макс. ${r.maxReps} повт`,
          r.bestTime != null && `время ${fmtTime(r.bestTime)}`,
          r.bestMeters != null && `${fmtNum(r.bestMeters)} м`,
        ].filter(Boolean)
        return parts.length ? <div key={k} className="card"><b>🏆 {g.name}</b><br /><span className="muted">{parts.join(' · ')}</span></div> : null
      })}
      <h3>Рекорды вручную</h3>
      {manual.map((m) => (
        <div key={m.id} className="card row-between">
          <span><b>{m.name}</b> {m.weight != null && `${fmtNum(m.weight)} кг`}{m.reps != null && ` × ${m.reps}`} <span className="muted">{fmtShort(m.date)} {m.note}</span></span>
          <button className="link-btn" onClick={() => remove(m.id)} aria-label="Удалить рекорд">✕</button>
        </div>
      ))}
      <form className="card" onSubmit={add}>
        <input required placeholder="Упражнение (например, становая на соревнованиях)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="row">
          <input inputMode="decimal" placeholder="кг" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
          <input inputMode="numeric" placeholder="повторы" value={form.reps} onChange={(e) => setForm({ ...form, reps: e.target.value })} />
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <input placeholder="Заметка" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button className="btn">Добавить рекорд</button>
      </form>
    </>
  )
}

function Measurements({ athleteId }: { athleteId: string }) {
  const [list, setList] = useState<Measurement[]>([])
  const [kind, setKind] = useState('Вес')
  const [custom, setCustom] = useState('')
  const [value, setValue] = useState('')
  const [date, setDate] = useState(today())
  const load = () => supabase.from('measurements').select('*').eq('athlete_id', athleteId).order('date')
    .then(({ data }) => setList(((data ?? []) as Measurement[]).map((m) => ({ ...m, value: Number(m.value) }))))
  useEffect(() => { load() }, [athleteId])
  const kinds = [...new Set([...KINDS, ...list.map((m) => m.kind)])]

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const v = parseNum(value)
    const k = kind === 'своё' ? custom.trim() : kind
    if (v == null || !k) return
    const { error } = await supabase.from('measurements').insert({ athlete_id: athleteId, kind: k, value: v, date })
    if (error) return alert('Не сохранилось: ' + error.message)
    setValue('')
    setKind(k)
    load()
  }
  const shown = list.filter((m) => m.kind === kind)
  return (
    <>
      <form className="card" onSubmit={add}>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Замер">
            {kinds.map((k) => <option key={k}>{k}</option>)}
            <option value="своё">своё…</option>
          </select>
          {kind === 'своё' && <input placeholder="Название" value={custom} onChange={(e) => setCustom(e.target.value)} />}
        </div>
        <div className="row">
          <input required inputMode="decimal" placeholder={kind === 'Вес' ? 'кг' : 'см'} value={value} onChange={(e) => setValue(e.target.value)} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button className="btn">Записать</button>
      </form>
      {kind !== 'своё' && (
        <>
          <LineChart unit={kind === 'Вес' ? 'кг' : 'см'} format={fmtNum} series={[{ label: kind, points: shown.map((m) => ({ x: m.date, y: m.value })) }]} />
          {shown.slice().reverse().map((m) => (
            <div key={m.id} className="row-between list-row">
              <span>{fmtShort(m.date)}: <b>{fmtNum(m.value)}</b></span>
              <button className="link-btn" aria-label="Удалить замер" onClick={async () => {
                if (confirm('Удалить замер?')) { await supabase.from('measurements').delete().eq('id', m.id); load() }
              }}>✕</button>
            </div>
          ))}
        </>
      )}
    </>
  )
}

function Photos({ athleteId }: { athleteId: string }) {
  const [list, setList] = useState<Photo[]>([])
  const [pose, setPose] = useState<Photo['pose']>('front')
  const [busy, setBusy] = useState(false)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const load = async () => {
    const { data } = await supabase.from('progress_photos').select('*').eq('athlete_id', athleteId).order('date')
    const rows = (data ?? []) as Photo[]
    const signed = rows.length ? await supabase.storage.from('progress').createSignedUrls(rows.map((r) => r.path), 3600) : { data: [] }
    setList(rows.map((r, i) => ({ ...r, url: signed.data?.[i]?.signedUrl })))
  }
  useEffect(() => { load() }, [athleteId])
  const dates = [...new Set(list.map((p) => p.date))]
  useEffect(() => { setA(dates[0] ?? ''); setB(dates[dates.length - 1] ?? '') }, [list.length])

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const blob = await compressImage(file)
      const id = crypto.randomUUID()
      const path = `${athleteId}/${id}.jpg`
      const up = await supabase.storage.from('progress').upload(path, blob, { contentType: 'image/jpeg' })
      if (up.error) throw up.error
      const { error } = await supabase.from('progress_photos').insert({ id, athlete_id: athleteId, pose, path, date: today() })
      if (error) throw error
      await load()
    } catch (e) {
      alert('Не загрузилось: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const pick = (d: string) => list.filter((p) => p.date === d)

  return (
    <>
      <div className="card">
        <div className="segmented">
          {(Object.keys(POSES) as Photo['pose'][]).map((p) => <button key={p} className={pose === p ? 'active' : ''} onClick={() => setPose(p)}>{POSES[p]}</button>)}
        </div>
        <label className="btn">{busy ? 'Загружаю…' : 'Добавить фото'}
          <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        <small className="muted">Фото видите только вы и ваш тренер. Перед отправкой сжимается до ~300 КБ.</small>
      </div>
      {dates.length > 0 && (
        <>
          <h3>Сравнение</h3>
          <div className="row">
            <select value={a} onChange={(e) => setA(e.target.value)} aria-label="Первая дата">{dates.map((d) => <option key={d} value={d}>{fmtShort(d)}</option>)}</select>
            <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Вторая дата">{dates.map((d) => <option key={d} value={d}>{fmtShort(d)}</option>)}</select>
          </div>
          {(Object.keys(POSES) as Photo['pose'][]).filter((p) => pick(a).some((x) => x.pose === p) || pick(b).some((x) => x.pose === p)).map((p) => (
            <div key={p} className="compare">
              {[a, b].map((d, i) => {
                const ph = pick(d).find((x) => x.pose === p)
                return <figure key={i}>{ph?.url ? <img src={ph.url} alt={`${POSES[p]}, ${fmtShort(d)}`} /> : <div className="ex-noimg">—</div>}<figcaption>{POSES[p]} · {fmtShort(d)}</figcaption></figure>
              })}
            </div>
          ))}
        </>
      )}
    </>
  )
}

function Weekly({ sets, athleteId }: { sets: SetRow[]; athleteId: string }) {
  const weeks = weeklyStats(sets).slice(-12)
  const [planned, setPlanned] = useState<{ date: string; ids: string[] }[]>([])
  useEffect(() => {
    supabase.from('workouts').select('date, workout_items(id, self)').eq('athlete_id', athleteId).eq('published', true).eq('self', false)
      .gte('date', addDays(today(), -84)).lte('date', today())
      .then(({ data }) => setPlanned(((data ?? []) as { date: string; workout_items: { id: string; self: boolean }[] }[])
        .map((w) => ({ date: w.date, ids: w.workout_items.filter((i) => !i.self).map((i) => i.id) }))))
  }, [athleteId])
  const doneIds = new Set(sets.map((s) => s.item_id))
  const pct = (monday: string) => {
    const ids = planned.filter((w) => mondayOf(w.date) === monday).flatMap((w) => w.ids)
    return ids.length ? Math.round((ids.filter((i) => doneIds.has(i)).length / ids.length) * 100) + '%' : '—'
  }
  if (!weeks.length) return <p className="muted">Пока нет данных.</p>
  return (
    <>
      <LineChart unit="трен." series={[{ label: 'Тренировок за неделю', points: weeks.map((w) => ({ x: w.monday, y: w.workouts })) }]} />
      <LineChart unit="кг" format={fmtNum} series={[{ label: 'Тоннаж за неделю', points: weeks.map((w) => ({ x: w.monday, y: w.tonnage })) }]} />
      <table className="history">
        <thead><tr><th>Неделя</th><th>Тренировок</th><th>План</th><th>Тоннаж</th></tr></thead>
        <tbody>{weeks.slice().reverse().map((w) => <tr key={w.monday}><td>с {fmtShort(w.monday)}</td><td>{w.workouts}</td><td>{pct(w.monday)}</td><td>{fmtNum(w.tonnage)} кг</td></tr>)}</tbody>
      </table>
    </>
  )
}
