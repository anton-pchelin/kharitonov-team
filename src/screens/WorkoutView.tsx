import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../supabase'
import { Markup } from '../lib/markup'
import { Video } from '../lib/video'
import { fmtNum, fmtTime, parseNum, parseTime } from '../lib/format'
import { itemLabels, resultLabel, type ResultType, type Workout, type WorkoutItem } from '../lib/workout'
import { previousSets, type Comment, type PastSet, type SetResult } from '../lib/offline'
import { exerciseKey, isRecordSet, maxFor, pctWeight, type MaxRecord } from '../lib/progress'

export type ViewProps = {
  workout: Workout
  results: SetResult[]
  comments: Comment[]
  history: PastSet[]
  me: string
  names: Record<string, string>
  editable: boolean
  maxes?: MaxRecord[]  // рекорды вручную; нет — это экран тренера, показываем только «70% от 1ПМ»
  onMax?: (item: WorkoutItem, weight: number) => void
  onSet?: (r: SetResult) => void
  onUnset?: (itemId: string, setNo: number) => void
  onComment?: (itemId: string | null, text: string) => void
  onVideo?: (itemId: string, text: string, file: File) => Promise<void>  // атлет прикладывает видео подхода
  extra?: (item: WorkoutItem) => ReactNode  // доп. кнопки задания (видео, таймер — следующие этапы)
}

type Field = 'weight' | 'reps' | 'time_sec' | 'meters' | 'calories' | 'rounds'
const FIELDS: Record<ResultType, Field[]> = {
  weight_reps: ['weight', 'reps'], reps: ['reps'], weight: ['weight'], time: ['time_sec'],
  meters: ['meters'], calories: ['calories'], rounds: ['rounds'], check: [],
}
const UNIT: Record<Field, string> = { weight: 'кг', reps: 'повт', time_sec: 'мм:сс', meters: 'м', calories: 'ккал', rounds: 'кругов' }
const show = (f: Field, v: number | null | undefined) => (f === 'time_sec' ? fmtTime(v) : fmtNum(v))
const parse = (f: Field, s: string) => (f === 'time_sec' ? parseTime(s) : f === 'reps' || f === 'rounds' ? (parseNum(s) == null ? null : Math.round(parseNum(s)!)) : parseNum(s))

/** Сколько заданий сделано: у задания есть хотя бы один отмеченный или заполненный подход. */
export function progress(items: WorkoutItem[], results: SetResult[]) {
  const done = items.filter((i) => results.some((r) => r.item_id === i.id && (r.done || FIELDS[i.result_type].some((f) => r[f] != null)))).length
  const tonnage = results.reduce((s, r) => s + (r.weight ?? 0) * (r.reps ?? 0), 0)
  return { done, total: items.length, tonnage }
}

/** Тренировка глазами атлета («Список») — у атлета с вводом, у тренера только чтение и комментарии. */
export function WorkoutView(p: ViewProps) {
  const items = [...(p.workout.workout_items ?? [])].sort((a, b) => a.position - b.position)
  const plan = items.filter((i) => !i.self)
  const own = items.filter((i) => i.self)
  const labels = itemLabels(plan)
  const workoutComments = p.comments.filter((c) => c.workout_id === p.workout.id && !c.item_id)

  return (
    <article className="workout">
      <h3>{p.workout.title || 'Тренировка'} {p.workout.self && <span className="tag">сам</span>}</h3>
      {p.workout.prescription && <Markup text={p.workout.prescription} />}
      {plan.map((it, i) => (
        <ItemView key={it.id} {...p} item={it} label={labels[i]}
          note={it.superset != null && plan[i - 1]?.superset !== it.superset ? it.block_note : ''} />
      ))}
      {own.length > 0 && <div className="divider">моё</div>}
      {own.map((it) => <ItemView key={it.id} {...p} item={it} label="+" note="" />)}
      <Comments {...p} itemId={null} list={workoutComments} />
    </article>
  )
}

function ItemView(p: ViewProps & { item: WorkoutItem; label: string; note: string }) {
  const { item } = p
  const mine = p.results.filter((r) => r.item_id === item.id)
  const prev = previousSets(p.history, item, p.workout.date)
  const earlier = p.history.filter((h) => h.date < p.workout.date && exerciseKey(h) === exerciseKey(item))
  const [extraRows, setExtraRows] = useState(0)
  const rows = Math.max(item.result_type === 'check' ? 1 : item.planned_sets, ...mine.map((r) => r.set_no), 1) + extraRows

  const put = (setNo: number, patch: Partial<SetResult>) => {
    const cur = mine.find((r) => r.set_no === setNo) ?? { item_id: item.id, set_no: setNo, done: false }
    p.onSet?.({ ...cur, ...patch })
  }

  return (
    <section className={'task' + (item.superset != null ? ' superset' : '')}>
      {p.note && <div className="block-label">{p.note}</div>}
      <div className="task-head">
        {item.result_type === 'check' ? (
          <button className={'round-check' + (mine[0]?.done ? ' on' : '')} disabled={!p.editable} aria-label="Выполнено"
            onClick={() => put(1, { done: !mine[0]?.done })}>✓</button>
        ) : <b className="item-label">{p.label}</b>}
        <b className="task-name">{item.name}</b>
        {item.result_type !== 'check' && <span className="muted">{item.planned_sets}× {resultLabel(item.result_type)}</span>}
      </div>
      {item.pct != null && <PctHint {...p} item={item} />}
      <Markup text={item.plan_text} />
      <div className="row-wrap">
        <Video url={item.video_url} />
        {p.extra?.(item)}
      </div>
      {item.result_type !== 'check' && Array.from({ length: rows }, (_, k) => k + 1).map((n) => (
        <SetRow key={n} n={n} type={item.result_type} value={mine.find((r) => r.set_no === n)} hint={prev.find((r) => r.set_no === n)}
          record={isRecordSet(mine.find((r) => r.set_no === n)?.weight, mine.find((r) => r.set_no === n)?.reps, earlier)}
          editable={p.editable} onPut={(patch) => put(n, patch)} />
      ))}
      {item.result_type !== 'check' && prev.length > 0 && (
        <small className="muted">прошлый раз: {prev.map((s) => FIELDS[item.result_type].map((f) => show(f, s[f])).filter(Boolean).join('×')).join(', ')}</small>
      )}
      {p.editable && item.result_type !== 'check' && (
        <button className="link-btn" onClick={() => setExtraRows(extraRows + 1)}>+ подход</button>
      )}
      <Comments {...p} itemId={item.id} list={p.comments.filter((c) => c.item_id === item.id)} />
    </section>
  )
}

function PctHint(p: ViewProps & { item: WorkoutItem }) {
  const [v, setV] = useState('')
  const pct = p.item.pct!
  if (!p.maxes) return <span className="pct">{fmtNum(pct)}% от 1ПМ</span>
  const max = maxFor(p.item, p.history, p.maxes)
  if (max) return <span className="pct">≈ {fmtNum(pctWeight(pct, max))} кг ({fmtNum(pct)}% от {fmtNum(Math.round(max * 10) / 10)})</span>
  return (
    <form className="pct pct-ask" onSubmit={(e) => { e.preventDefault(); const n = parseNum(v); if (n && p.onMax) p.onMax(p.item, n) }}>
      <span>{fmtNum(pct)}% от максимума — введите свой максимум:</span>
      <input inputMode="decimal" placeholder="кг" value={v} onChange={(e) => setV(e.target.value)} disabled={!p.onMax} />
      <button className="btn small" disabled={!p.onMax}>OK</button>
    </form>
  )
}

function SetRow({ n, type, value, hint, record, editable, onPut }: {
  n: number; type: ResultType; value?: SetResult; hint?: SetResult; record: boolean; editable: boolean; onPut: (p: Partial<SetResult>) => void
}) {
  const fields = FIELDS[type]
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({})
  const text = (f: Field) => draft[f] ?? show(f, value?.[f])
  const commit = (f: Field) => {
    if (draft[f] === undefined) return
    const v = parse(f, draft[f]!)
    setDraft((d) => ({ ...d, [f]: undefined }))
    if (v !== (value?.[f] ?? null)) onPut({ [f]: v })
  }
  return (
    <div className={'set-row' + (value?.done ? ' done' : '')}>
      <span className="set-no">{record ? '🏆' : n}</span>
      {fields.map((f, i) => (
        <span key={f} className="set-field">
          {i > 0 && <span className="muted">×</span>}
          <input inputMode={f === 'time_sec' ? 'numeric' : 'decimal'} disabled={!editable} aria-label={`${UNIT[f]}, подход ${n}`}
            placeholder={show(f, hint?.[f]) || (f === 'weight' ? '' : UNIT[f])} value={text(f)}
            onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
            onBlur={() => commit(f)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          {f === 'weight' && <span className="muted">кг</span>}
        </span>
      ))}
      <button className={'round-check' + (value?.done ? ' on' : '')} disabled={!editable} aria-label={`Подход ${n} выполнен`}
        onClick={() => {
          // ✓ на пустом подходе берёт подсказку «прошлый раз» — как в TRNR
          const filled = Object.fromEntries(fields.map((f) => [f, value?.[f] ?? (draft[f] ? parse(f, draft[f]!) : hint?.[f] ?? null)]))
          onPut({ ...filled, done: !value?.done })
          setDraft({})
        }}>✓</button>
    </div>
  )
}

function Comments(p: ViewProps & { itemId: string | null; list: Comment[] }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const canWrite = !!p.onComment
  if (!p.list.length && !canWrite) return null
  return (
    <div className="comments">
      {p.list.map((c) => (
        <div key={c.id} className={'comment' + (c.author_id === p.me ? ' mine' : '')}>
          💬 {c.author_id !== p.me && <b>{p.names[c.author_id] ?? ''}: </b>}{c.text}
          {c.video_path?.startsWith('local:') && <small className="muted"> 🎬 видео отправится, когда появится сеть</small>}
          {c.video_path && !c.video_path.startsWith('local:') && <CommentVideo path={c.video_path} />}
          {c.video_deleted && <small className="muted"> 🎬 видео удалено (старше 30 дней)</small>}
        </div>
      ))}
      {canWrite && !open && <button className="link-btn" onClick={() => setOpen(true)}>💬 {p.itemId ? 'Комментарий' : 'Комментарий к тренировке'}</button>}
      {canWrite && open && (
        <form className="comment-form" onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          p.onComment!(p.itemId, text.trim())
          setText('')
          setOpen(false)
        }}>
          <textarea rows={2} value={text} autoFocus onChange={(e) => setText(e.target.value)} placeholder="Например: резина синяя" />
          <button className="btn small">Отправить</button>
          {p.onVideo && p.itemId && (
            <label className="btn small secondary">{busy || '🎬 Прикрепить видео'}
              <input type="file" accept="video/*" hidden disabled={!!busy} onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setBusy('Готовлю видео…')
                try {
                  await p.onVideo!(p.itemId!, text.trim(), f)
                  setText('')
                  setOpen(false)
                } catch (err) {
                  alert((err as Error).message)
                } finally {
                  setBusy('')
                }
              }} />
            </label>
          )}
        </form>
      )}
    </div>
  )
}

/** Видео из закрытого хранилища: ссылка на час, плеер открывается в комментарии. */
function CommentVideo({ path }: { path: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    supabase.storage.from('videos').createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? ''))
  }, [path])
  return url ? <video className="comment-video" src={url} controls playsInline preload="metadata" /> : <small className="muted"> 🎬 загрузка видео…</small>
}
