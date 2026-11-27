import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DiagnosticButton, recordFailure } from '../lib/diagnostics'
import { supabase } from '../supabase'
import { Markup } from '../lib/markup'
import { Video } from '../lib/video'
import { fmtNum, fmtTime, parseNum, parseTime } from '../lib/format'
import { MAX_RESULT_ROWS, complexPerRound, complexRounds, complexTimerRounds, isComplex, itemLabels, resultLabel, type ResultType, type Workout, type WorkoutItem } from '../lib/workout'
import { previousSets, type Comment, type PastSet, type SetResult } from '../lib/offline'
import { exerciseKey, isRecordSet, matchSet, maxFor, pctWeight, type MaxRecord } from '../lib/progress'
import { platesFor } from '../lib/plates'
import { cardioLines, hrOk } from '../lib/cardio'

export type ViewProps = {
  workout: Workout
  results: SetResult[]
  comments: Comment[]
  history: PastSet[]
  me: string
  names: Record<string, string>
  editable: boolean
  gym?: { bar: number; plates: number[] }  // гриф и блины атлета — для калькулятора 🏋
  maxes?: MaxRecord[]  // рекорды вручную; нет — это экран тренера, показываем только «70% от 1ПМ»
  onMax?: (item: WorkoutItem, weight: number) => void
  onSet?: (r: SetResult) => void
  onUnset?: (itemId: string, setNo: number) => void
  onComment?: (itemId: string | null, text: string, id: string) => void | Promise<void>
  onVideo?: (itemId: string, text: string, file: File) => Promise<void>  // атлет прикладывает видео подхода
  extra?: (item: WorkoutItem) => ReactNode  // доп. кнопки задания (видео, таймер — следующие этапы)
  onEdit?: (item: WorkoutItem) => void
  onReorder?: (itemIds: string[]) => void
  itemEditor?: (item: WorkoutItem) => ReactNode
  onDelete?: (item: WorkoutItem | null) => void  // атлет удаляет своё: задание «сам» или (null) свою тренировку
}

type Field = 'weight' | 'reps' | 'time_sec' | 'meters' | 'calories' | 'rounds' | 'hr'
const FIELDS: Record<ResultType, Field[]> = {
  weight_reps: ['weight', 'reps'], reps: ['reps'], weight: ['weight'], time: ['time_sec'],
  meters: ['meters'], calories: ['calories'], rounds: ['rounds'], check: [], cardio: ['time_sec', 'meters', 'hr'],
}
const UNIT: Record<Field, string> = { weight: 'кг', reps: 'повт', time_sec: 'мм:сс', meters: 'м', calories: 'ккал', rounds: 'кругов', hr: 'пульс' }
const show = (f: Field, v: number | null | undefined) => (f === 'time_sec' ? fmtTime(v) : fmtNum(v))
function parse(f: Field, text: string) {
  if (f === 'time_sec') {
    const [minutes, seconds] = text.split(':')
    return minutes || seconds ? parseTime(`${minutes || '0'}:${seconds || '0'}`) : null
  }
  const value = parseNum(text)
  return value != null && (f === 'reps' || f === 'rounds' || f === 'hr') ? Math.round(value) : value
}

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
      <div className="row-between">
        <h3>{p.workout.title || 'Тренировка'} {p.workout.self && <span className="tag">сам</span>}</h3>
        {p.workout.self && p.onDelete && (
          <details className="menu">
            <summary aria-label="Меню тренировки">⋯</summary>
            <div className="menu-list"><button onClick={() => p.onDelete!(null)}>Удалить</button></div>
          </details>
        )}
      </div>
      {p.workout.prescription && <Markup text={p.workout.prescription} />}
      {plan.map((it, i) => (
        <ItemView key={it.id} {...p} item={it} label={labels[i]}
          note={it.superset != null && plan[i - 1]?.superset !== it.superset ? it.block_note : ''} />
      ))}
      {own.length > 0 && <div className="divider">моё</div>}
      {p.editable && p.onReorder && own.length > 1
        ? <SortableOwnItems items={own} view={p} onReorder={p.onReorder} />
        : own.map((it, i) => <ItemView key={it.id} {...p} item={it} label={String(i + 1)} note="" />)}
      <Comments {...p} itemId={null} list={workoutComments} />
    </article>
  )
}

function SortableOwnItems({ items, view, onReorder }: {
  items: WorkoutItem[]; view: ViewProps; onReorder: (ids: string[]) => void
}) {
  const ids = items.map((item) => item.id)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    accessibility={{ screenReaderInstructions: { draggable: 'Нажмите пробел, чтобы взять упражнение. Стрелки меняют позицию, пробел сохраняет, Escape отменяет.' }, announcements: {
      onDragStart: () => 'Упражнение взято.',
      onDragOver: ({ over }) => over ? 'Позиция ' + (ids.indexOf(String(over.id)) + 1) : undefined,
      onDragEnd: () => 'Перетаскивание завершено.',
      onDragCancel: () => 'Перетаскивание отменено.',
    } }}
    onDragEnd={({ active, over }) => {
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over?.id))
      if (from >= 0 && to >= 0 && from !== to) onReorder(arrayMove(ids, from, to))
    }}>
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {items.map((item, i) => <SortableOwnItem key={item.id} view={view} item={item} label={String(i + 1)} />)}
    </SortableContext>
  </DndContext>
}

function SortableOwnItem({ view, item, label }: { view: ViewProps; item: WorkoutItem; label: string }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  return <div ref={setNodeRef} className={isDragging ? 'moving-task' : undefined}
    style={{ transform: CSS.Transform.toString(transform), transition }}>
    <ItemView {...view} item={item} label={label} note="" handle={
      <button type="button" className="handle" ref={setActivatorNodeRef} {...attributes} {...listeners}
        aria-label={'Перетащить «' + item.name + '»'}>⋮⋮</button>
    } />
  </div>
}

function ItemView(p: ViewProps & { item: WorkoutItem; label: string; note: string; handle?: ReactNode }) {
  const { item } = p
  const mine = p.results.filter((r) => r.item_id === item.id)
  const prev = previousSets(p.history, item, p.workout.date)
  const earlier = p.history.filter((h) => h.date < p.workout.date && exerciseKey(h) === exerciseKey(item))
  const [visibleRows, setVisibleRows] = useState(0)
  const complex = isComplex(item)
  const perRound = complex && complexPerRound(item.result_type)
  const planned = perRound ? complexTimerRounds(item.timer) ?? complexRounds(item.name) ?? item.planned_sets : item.planned_sets
  const rows = Math.min(MAX_RESULT_ROWS, Math.max(planned, ...mine.map((r) => r.set_no), visibleRows, 1))

  const put = (setNo: number, patch: Partial<SetResult>) => {
    const cur = mine.find((r) => r.set_no === setNo) ?? { item_id: item.id, set_no: setNo, done: false }
    p.onSet?.({ ...cur, ...patch })
  }

  return (
    <section className={'task' + (item.superset != null ? ' superset' : '')}>
      {p.note && <div className="block-label">{p.note}</div>}
      <div className="task-head">
        {p.handle}
        {item.result_type === 'check' ? (
          <button className={'round-check' + (mine[0]?.done ? ' on' : '')} disabled={!p.editable} aria-label="Выполнено"
            onClick={() => put(1, { done: !mine[0]?.done })}>✓</button>
        ) : <b className="item-label">{p.label}</b>}
        <b className="task-name">{item.name}</b>
        {item.result_type !== 'check' && <span className="muted">{complex ? '' : `${item.planned_sets}× `}{resultLabel(item.result_type)}</span>}

      </div>
      {item.pct != null && <PctHint {...p} item={item} />}
      <Markup text={item.plan_text} />
      {item.self && p.editable && (p.onEdit || p.onDelete) && <div className="workout-item-actions">
        {p.onEdit && <button className="link-btn" onClick={() => p.onEdit!(item)} aria-label={'Редактировать «' + item.name + '»'}>Редактировать</button>}
        {p.onDelete && <button className="link-btn" onClick={() => p.onDelete!(item)} aria-label={'Удалить «' + item.name + '»'}>Удалить</button>}
      </div>}
      {item.self && p.editable && p.itemEditor?.(item)}
      <div className="row-wrap">
        <Video url={item.video_url} />
        {p.extra?.(item)}
      </div>
      {item.result_type !== 'check' && Array.from({ length: rows }, (_, k) => k + 1).map((n) => (
        <SetRow key={n} n={n} perRound={perRound} type={item.result_type} value={mine.find((r) => r.set_no === n)} hint={prev.find((r) => r.set_no === n)}
          record={isRecordSet(mine.find((r) => r.set_no === n)?.weight, mine.find((r) => r.set_no === n)?.reps, earlier)}
          gym={p.gym} pctKg={item.pct != null && p.maxes ? (() => { const m = maxFor(item, p.history, p.maxes); return m ? pctWeight(item.pct, m) : null })() : null}
          editable={p.editable} onPut={(patch) => put(n, patch)} />
      )).flatMap((row, k) => {
        const v = mine.find((r) => r.set_no === k + 1)
        const lines = item.result_type === 'cardio' && v ? cardioLines(v, earlier) : []
        return [row, ...lines.map((l, j) => <small key={`c${k}-${j}`} className="cardio-line">{l}</small>)]
      })}
      {item.result_type !== 'check' && prev.length > 0 && (
        <small className="muted">прошлый раз: {prev.map((s) => FIELDS[item.result_type].map((f) => show(f, s[f])).filter(Boolean).join(item.result_type === 'cardio' ? ' · ' : '×')).join(', ')}</small>
      )}
      {p.editable && item.result_type !== 'check' && rows < MAX_RESULT_ROWS && (
        <button className="link-btn" onClick={() => setVisibleRows(rows + 1)}>{perRound ? '+ раунд' : '+ подход'}</button>
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

function SetRow({ n, perRound, type, value, hint, record, editable, onPut, gym, pctKg }: {
  n: number; perRound: boolean; type: ResultType; value?: SetResult; hint?: SetResult; record: boolean; editable: boolean; onPut: (p: Partial<SetResult>) => void
  gym?: { bar: number; plates: number[] }; pctKg?: number | null
}) {
  const fields = FIELDS[type]
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({})
  const [calc, setCalc] = useState(false)
  const rowLabel = `${perRound ? 'раунд' : 'подход'} ${n}`
  const text = (f: Field) => draft[f] ?? show(f, value?.[f])
  // ерунда в кардио (0 метров, пульс 300) — подсветить; сохранять не мешаем
  const bad = (f: Field) => type === 'cardio' && value?.[f] != null && (f === 'hr' ? !hrOk(value.hr) : Number(value[f]) <= 0)
  // ввёл повторы — в поле веса серым вес той же трудности, что в прошлый раз (и наоборот)
  const typed = (f: 'weight' | 'reps') => (draft[f] !== undefined ? parseNum(draft[f]!) : value?.[f]) ?? null
  const match: Partial<Record<Field, number>> = type === 'weight_reps' && hint ? matchSet(hint, { weight: typed('weight'), reps: typed('reps') }) : {}
  const commit = (f: Field) => {
    if (draft[f] === undefined) return
    const v = parse(f, draft[f]!)
    setDraft((d) => ({ ...d, [f]: undefined }))
    if (v !== (value?.[f] ?? null)) onPut({ [f]: v })
  }
  return (
    <div className={'set-row' + (value?.done ? ' done' : '')}>
      <span className="set-no">{record ? '🏆' : n}</span>
      {fields.map((f, i) => f === 'time_sec' && editable ? (
        <TimeInput key={f} draft={draft[f]} value={value?.[f]} hint={hint?.[f]} rowLabel={rowLabel}
          bad={bad(f)} onChange={(t) => setDraft((d) => ({ ...d, [f]: t }))} onCommit={() => commit(f)} />
      ) : (
        <span key={f} className="set-field">
          {i > 0 && type !== 'cardio' && <span className="muted">×</span>}
          <input inputMode={f === 'reps' || f === 'rounds' || f === 'hr' ? 'numeric' : 'decimal'} className={bad(f) ? 'bad' : undefined} disabled={!editable} aria-label={`${UNIT[f]}, ${rowLabel}`}
            placeholder={(match[f] != null ? '≈ ' + show(f, match[f]) : show(f, hint?.[f])) || (f === 'weight' ? '' : UNIT[f])} value={text(f)}
            onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
            onBlur={() => commit(f)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          {f === 'weight' && <span className="muted">кг</span>}
          {f === 'weight' && gym && <button type="button" className="plate-btn" aria-label="Какие блины повесить" onClick={() => setCalc(!calc)}>🏋</button>}
        </span>
      ))}
      {calc && gym && <Plates weight={parseNum(draft.weight ?? '') ?? value?.weight ?? match.weight ?? hint?.weight ?? pctKg ?? null} gym={gym} />}
      <button className={'round-check' + (value?.done ? ' on' : '')} disabled={!editable} aria-label={`${perRound ? 'Раунд' : 'Подход'} ${n} выполнен`}
        onClick={() => {
          // ✓ на пустом подходе берёт подсказку «прошлый раз»
          const filled = Object.fromEntries(fields.map((f) => [f, draft[f] !== undefined ? parse(f, draft[f]!) : value?.[f] ?? match[f] ?? hint?.[f] ?? null]))
          onPut({ ...filled, done: !value?.done })
          setDraft({})
        }}>✓</button>
    </div>
  )
}

function TimeInput({ draft, value, hint, rowLabel, bad, onChange, onCommit }: {
  draft?: string; value?: number | null; hint?: number | null; rowLabel: string; bad: boolean
  onChange: (value: string) => void; onCommit: () => void
}) {
  const parts = (s?: number | null) => s == null ? ['', ''] : [String(Math.floor(s / 60)), String(s % 60).padStart(2, '0')]
  const values = draft === undefined ? parts(value) : draft.split(':')
  const placeholders = parts(hint)
  return <span className="set-field set-time" role="group" aria-label={`Время, ${rowLabel}`}
    onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onCommit() }}>
    {['мин', 'сек'].map((unit, i) => <label key={unit}>
      <input inputMode="numeric" maxLength={i === 0 ? 7 : 2} className={bad ? 'bad' : undefined}
        aria-label={`${i === 0 ? 'Минуты' : 'Секунды'}, ${rowLabel}`} value={values[i]} placeholder={placeholders[i] || '0'}
        onChange={(e) => {
          const v = e.target.value
          if (!/^\d*$/.test(v)) return
          onChange(i === 0 ? `${v}:${values[1]}` : `${values[0]}:${v}`)
        }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
      <small className="muted">{unit}</small>
    </label>)}
  </span>
}

function Comments(p: ViewProps & { itemId: string | null; list: Comment[] }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const pendingId = useRef<string | null>(null)
  const canWrite = !!p.onComment
  if (!p.list.length && !canWrite) return null
  return (
    <div className="comments">
      {p.list.map((c) => (
        <div key={c.id} className={'comment' + (c.author_id === p.me ? ' mine' : '')}>
          💬 {c.author_id !== p.me && <b>{p.names[c.author_id] ?? ''}: </b>}<span className="pre">{c.text}</span>
          {c.video_path?.startsWith('local:') && <small className="muted"> 🎬 видео отправится, когда появится сеть</small>}
          {c.video_path && !c.video_path.startsWith('local:') && <CommentVideo path={c.video_path} />}
          {c.video_deleted && <small className="muted"> 🎬 видео удалено (старше 30 дней)</small>}
        </div>
      ))}
      {canWrite && !open && <button className="link-btn" onClick={() => setOpen(true)}>💬 {p.itemId ? 'Комментарий' : 'Комментарий к тренировке'}</button>}
      {canWrite && open && (
        <form className="comment-form" onSubmit={async (e) => {
          e.preventDefault()
          if (!text.trim() || sending || busy) return
          const id = pendingId.current ?? crypto.randomUUID()
          pendingId.current = id
          setSending(true)
          try {
            await p.onComment!(p.itemId, text.trim(), id)
            pendingId.current = null
            setFailed(false)
            setText('')
            setOpen(false)
          } catch (cause) {
            recordFailure(p.editable ? 'Тренировки' : location.hash.startsWith('#/plan') ? 'План' : 'Лента', 'Отправка комментария', cause)
            setFailed(true)
          } finally {
            setSending(false)
          }
        }}>
          <textarea rows={2} value={text} autoFocus readOnly={sending || failed} onChange={(e) => setText(e.target.value)} placeholder="Например: резина синяя" />
          <button className="btn small" disabled={sending || !!busy || !text.trim()}>{sending ? 'Отправляю…' : failed ? 'Повторить' : 'Отправить'}</button>
          {failed && <><p className="error" role="alert">Не удалось отправить комментарий.</p><DiagnosticButton /></>}
          {p.onVideo && p.itemId && (
            <label className="btn small secondary">{busy || '🎬 Прикрепить видео'}
              <input type="file" accept="video/*" hidden disabled={!!busy || sending} onChange={async (e) => {
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

/** Калькулятор блинов: что повесить на каждую сторону грифа. */
function Plates({ weight, gym }: { weight: number | null; gym: { bar: number; plates: number[] } }) {
  const [bar, setBar] = useState(gym.bar)
  if (!weight) return <div className="plates muted">Введите вес — покажу, какие блины повесить.</div>
  const r = platesFor(Number(weight), bar, gym.plates)
  return (
    <div className="plates">
      <div className="segmented">
        {[20, 15, 10].map((b) => <button key={b} type="button" className={bar === b ? 'active' : ''} onClick={() => setBar(b)}>гриф {b}</button>)}
      </div>
      <b>{r.perSide.length ? r.perSide.map(fmtNum).join(' + ') + ' на каждую сторону' : 'только гриф'}</b>
      {r.diff !== 0 && <span className="muted"> — выйдет {fmtNum(r.got)} кг ({r.diff > 0 ? 'меньше' : 'больше'} на {fmtNum(Math.abs(r.diff))})</span>}
    </div>
  )
}
