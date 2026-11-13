import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { WorkoutView, progress } from './WorkoutView'
import { addDays, fmtDay, today } from '../lib/dates'
import type { Workout } from '../lib/workout'
import type { Comment, SetResult } from '../lib/offline'

type W = Workout & { reviewed_at: string | null; profiles: { name: string } | null }
type Event = { w: W; kind: 'done' | 'self' | 'missed'; comments: Comment[]; videos: number; needsReply: boolean; record: boolean }

const initials = (name: string) => name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || '?'

/** «Лента» тренера: кто что сделал за 2 недели, кто пропустил; фильтр «ждут ответа». */
export function Feed({ me }: { me: { id: string; name: string } }) {
  const [events, setEvents] = useState<Event[] | null>(null)
  const [results, setResults] = useState<SetResult[]>([])
  const [onlyReply, setOnlyReply] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('workouts').select('*, workout_items(*), profiles!workouts_athlete_id_fkey(name)')
      .gte('date', addDays(today(), -14)).lte('date', today()).order('date', { ascending: false })
    const ws = (data ?? []) as W[]
    const ids = ws.map((w) => w.id)
    const itemIds = ws.flatMap((w) => (w.workout_items ?? []).map((i) => i.id))
    const [c, r] = await Promise.all([
      ids.length ? supabase.from('comments').select('*').in('workout_id', ids).order('created_at') : { data: [] },
      itemIds.length ? supabase.from('set_results').select('*').in('item_id', itemIds) : { data: [] },
    ])
    const comments = (c.data ?? []) as Comment[]
    const res = (r.data ?? []) as SetResult[]
    const records = await Promise.all(ws.map((w) => (w.completed_at ? supabase.rpc('has_new_record', { p_workout: w.id }) : { data: false })))
    setResults(res)
    setEvents(ws.flatMap((w, k): Event[] => {
      const wc = comments.filter((x) => x.workout_id === w.id)
      const hasResults = res.some((x) => w.workout_items?.some((i) => i.id === x.item_id))
      const athleteWrote = wc.some((x) => x.author_id === w.athlete_id)
      const kind = w.self ? 'self' : w.completed_at || hasResults ? 'done' : w.published && w.date < today() ? 'missed' : null
      if (!kind) return []
      return [{
        w, kind, comments: wc, videos: wc.filter((x) => x.video_path || x.video_deleted).length,
        needsReply: kind !== 'missed' && athleteWrote && !w.reviewed_at, record: !!records[k].data,
      }]
    }))
  }, [])
  useEffect(() => { load() }, [load])

  if (!events) return <p className="muted">Загрузка…</p>
  const waiting = events.filter((e) => e.needsReply)
  const list = onlyReply ? waiting : events

  return (
    <>
      <div className="chips">
        <button className={!onlyReply ? 'chip on' : 'chip'} onClick={() => setOnlyReply(false)}>Все события</button>
        <button className={onlyReply ? 'chip on' : 'chip'} onClick={() => setOnlyReply(true)}>Ждут ответа · {waiting.length}</button>
      </div>
      {!list.length && <p className="muted">{onlyReply ? 'Все ответы даны.' : 'За две недели событий нет.'}</p>}
      {list.map((e) => {
        const name = e.w.profiles?.name || 'Атлет'
        const items = (e.w.workout_items ?? []).filter((i) => !i.self)
        const p = progress(items, results.filter((r) => items.some((i) => i.id === r.item_id)))
        return (
          <div key={e.w.id} className="card feed-card">
            <button className="feed-head link-row" onClick={() => setOpen(open === e.w.id ? null : e.w.id)}>
              <span className="avatar">{initials(name)}</span>
              <span>
                <b>{name}</b> <span className="muted">· {fmtDay(e.w.date)}</span><br />
                {e.kind === 'missed'
                  ? <span className="missed">пропустил(а) «{e.w.title || 'Тренировка'}»</span>
                  : <span>{e.kind === 'self' ? 'своё: ' : ''}«{e.w.title || 'Тренировка'}»{e.kind === 'done' && ` · ${p.done}/${p.total}`}</span>}
                {e.record && <span className="tag tag-done">рекорд</span>}
                {e.kind === 'self' && <span className="tag">сам</span>}
                {e.comments.length > 0 && <span className="muted"> · 💬 {e.comments.length}</span>}
                {e.videos > 0 && <span className="muted"> · 🎬 {e.videos}</span>}
                {e.needsReply && <span className="tag">ждёт ответа</span>}
              </span>
            </button>
            {open === e.w.id && (
              <>
                <WorkoutView workout={e.w} results={results} comments={e.comments} history={[]}
                  me={me.id} names={{ [me.id]: me.name, [e.w.athlete_id]: name }} editable={false}
                  onComment={async (item_id, text) => {
                    const { error } = await supabase.from('comments').insert({ workout_id: e.w.id, item_id, text })
                    if (error) return alert('Не отправилось: ' + error.message)
                    await supabase.from('workouts').update({ reviewed_at: new Date().toISOString() }).eq('id', e.w.id)
                    load()
                  }} />
                {e.needsReply && (
                  <button className="btn secondary" onClick={async () => {
                    await supabase.from('workouts').update({ reviewed_at: new Date().toISOString() }).eq('id', e.w.id)
                    load()
                  }}>Просмотрено</button>
                )}
                <a className="link-btn" href={`#/plan/${e.w.athlete_id}/${e.w.date}`}>Открыть неделю атлета</a>
              </>
            )}
          </div>
        )
      })}
    </>
  )
}
