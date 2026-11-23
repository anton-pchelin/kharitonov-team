import { useCallback, useEffect, useRef, useState } from 'react'
import { sendCoachComment, supabase } from '../supabase'
import { LoadError, recordFailure } from '../lib/diagnostics'
import { withDeadline } from '../lib/request'
import { WorkoutView, progress } from './WorkoutView'
import { addDays, fmtDay, today } from '../lib/dates'
import type { Workout } from '../lib/workout'
import { loadCardioHistory, type Comment, type PastSet, type SetResult } from '../lib/offline'
import { cardioSummary } from '../lib/cardio'
import { exerciseKey } from '../lib/progress'

type W = Workout & { reviewed_at: string | null; profiles: { name: string } | null }
type Event = { w: W; kind: 'done' | 'self' | 'missed'; comments: Comment[]; videos: number; needsReply: boolean }

const initials = (name: string) => name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || '?'

/** «Лента» тренера: кто что сделал за 2 недели, кто пропустил; фильтр «ждут ответа». */
export function Feed({ me }: { me: { id: string; name: string } }) {
  const [events, setEvents] = useState<Event[] | null>(null)
  const [results, setResults] = useState<SetResult[]>([])
  const [history, setHistory] = useState<(PastSet & { athlete_id: string })[]>([])
  const [onlyReply, setOnlyReply] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const [recordIds, setRecordIds] = useState<Set<string>>(() => new Set())
  const request = useRef(0)
  const load = useCallback(async () => {
    const version = ++request.current
    setFailure(null)
    try {
      const { ws, comments, res } = await withDeadline(async (signal) => {
        const { data, error } = await supabase.from('workouts').select('*, workout_items(*), profiles!workouts_athlete_id_fkey(name)')
          .neq('athlete_id', me.id).gte('date', addDays(today(), -14)).lte('date', today()).order('date', { ascending: false }).abortSignal(signal)
        if (error) throw error
        const ws = data as W[]
        const ids = ws.map((w) => w.id)
        const itemIds = ws.flatMap((w) => (w.workout_items ?? []).map((i) => i.id))
        const [c, r] = await Promise.all([
          ids.length ? supabase.from('comments').select('*').in('workout_id', ids).order('created_at').abortSignal(signal) : { data: [], error: null },
          itemIds.length ? supabase.from('set_results').select('*').in('item_id', itemIds).abortSignal(signal) : { data: [], error: null },
        ])
        if (c.error || r.error) throw c.error ?? r.error
        return { ws, comments: c.data as Comment[], res: r.data as SetResult[] }
      })
      if (version !== request.current) return
      const daysToday = today()
      const withResults = new Set(res.map((r) => r.item_id))
      const byWorkout = new Map<string, Comment[]>()
      for (const c of comments) {
        const group = byWorkout.get(c.workout_id)
        if (group) group.push(c)
        else byWorkout.set(c.workout_id, [c])
      }
      const next = ws.flatMap((w): Event[] => {
        const wc = byWorkout.get(w.id) ?? []
        const hasResults = w.workout_items?.some((i) => withResults.has(i.id))
        const athleteWrote = wc.some((x) => x.author_id === w.athlete_id)
        const kind = w.self ? 'self' : w.completed_at || hasResults ? 'done' : w.published && w.date < daysToday ? 'missed' : null
        if (!kind) return []
        return [{
          w, kind, comments: wc, videos: wc.filter((x) => x.video_path || x.video_deleted).length,
          needsReply: kind !== 'missed' && athleteWrote && !w.reviewed_at,
        }]
      })
      setResults(res)
      setEvents(next)
      const completed = next.filter((e) => e.w.completed_at).map((e) => e.w.id)
      if (completed.length) {
        supabase.rpc('workout_records', { p_workouts: completed }).then(({ data, error }) => {
          if (version === request.current && !error) setRecordIds(new Set(data as string[]))
        })
      } else setRecordIds(new Set())
      const cardioAthletes = [...new Set(next.filter((e) => e.w.workout_items?.some((i) => i.result_type === 'cardio')).map((e) => e.w.athlete_id))]
      if (cardioAthletes.length) loadCardioHistory(cardioAthletes).then((data) => {
        if (version === request.current) setHistory(data)
      }, () => {})
    } catch (cause) {
      if (version === request.current) setFailure({ cause })
    }
  }, [me.id])
  useEffect(() => {
    load()
    return () => { request.current++ }
  }, [load])

  const markReviewed = async (workoutId: string) => {
    const { error } = await supabase.from('workouts').update({ reviewed_at: new Date().toISOString() }).eq('id', workoutId)
    if (error) recordFailure('Лента', 'Сохранение', error)
    load()
  }

  // кардио-подходы атлета: «Гребля 30:00 · 7000 м · пульс 140 · 1,67 м/уд ▲ 4%»
  const cardio = (w: W) => (w.workout_items ?? []).filter((i) => i.result_type === 'cardio').flatMap((i) => {
    const past = history.filter((h) => h.athlete_id === w.athlete_id && h.date < w.date && exerciseKey(h) === exerciseKey(i))
    return results.filter((r) => r.item_id === i.id).sort((a, b) => a.set_no - b.set_no)
      .map((r) => cardioSummary(i.name, r, past)).filter((l): l is string => !!l)
  })

  const loadError = failure && <LoadError screen="Лента" cause={failure.cause} message="Не удалось загрузить ленту" onRetry={load} />
  if (!events) return loadError || <p className="muted">Загрузка…</p>
  const waiting = events.filter((e) => e.needsReply)
  const list = onlyReply ? waiting : events

  return (
    <>
      {loadError}
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
                {recordIds.has(e.w.id) && <span className="tag tag-done">рекорд</span>}
                {e.kind === 'self' && <span className="tag">сам</span>}
                {e.comments.length > 0 && <span className="muted"> · 💬 {e.comments.length}</span>}
                {e.videos > 0 && <span className="muted"> · 🎬 {e.videos}</span>}
                {e.needsReply && <span className="tag">ждёт ответа</span>}
                {cardio(e.w).map((l, k) => <span key={k} className="feed-cardio">{l}</span>)}
              </span>
            </button>
            {open === e.w.id && (
              <>
                <WorkoutView workout={e.w} results={results} comments={e.comments} history={history.filter((h) => h.athlete_id === e.w.athlete_id)}
                  me={me.id} names={{ [me.id]: me.name, [e.w.athlete_id]: name }} editable={false}
                  onComment={async (itemId, text, id) => {
                    await sendCoachComment(e.w.id, itemId, text, id)
                    void markReviewed(e.w.id)
                  }} />
                {e.needsReply && (
                  <button className="btn secondary" onClick={() => markReviewed(e.w.id)}>Просмотрено</button>
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
