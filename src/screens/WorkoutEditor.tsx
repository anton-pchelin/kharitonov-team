import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../supabase'
import { searchExercises, type Exercise } from '../search'
import { fmtDay, mondayOf } from '../lib/dates'
import { COMPLEX_RESULTS, RESULT_TYPES, appendItems, complexName, complexRounds, isComplex, isGroupStart, itemLabels, type ResultType, type Workout, type WorkoutItem } from '../lib/workout'
import { TIMER_KINDS, type TimerCfg } from '../lib/timer'
import { PickWorkout } from './WeekTools'
import { draftKey, readDraft, type Draft } from '../lib/workoutDraft'
import { DiagnosticButton, recordFailure } from '../lib/diagnostics'

export type { Draft } from '../lib/workoutDraft'

type Suggestion = {
  name: string
  exercise_id: string | null
  plan_text: string
  video_url: string | null
  result_type: ResultType
  planned_sets: number
}
type Template = Suggestion & { id: string }

const blank = (s: Partial<Suggestion> & { name: string }, position: number): WorkoutItem => ({
  id: crypto.randomUUID(),
  position,
  exercise_id: s.exercise_id ?? null,
  name: s.name,
  plan_text: s.plan_text ?? '',
  video_url: s.video_url ?? null,
  result_type: s.result_type ?? 'weight_reps',
  planned_sets: s.planned_sets ?? (s.result_type === 'check' ? 1 : 3),
  superset: null,
  block_note: '',
})

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е')

/** Редактор тренировки тренера. Ничего не создаётся в базе до «Сохранить». */


/** Снимок тренировки для шаблона или дня программы — без id, чтобы копии не путались с оригиналом. */
export const snapshot = (items: WorkoutItem[]) =>
  items.filter((i) => !i.self).sort((a, b) => a.position - b.position)
    .map(({ id: _id, workout_id: _w, self: _s, ...rest }, position) => ({ ...rest, position }))

export function WorkoutEditor({ athleteId, athleteName = '', date = '', workout, template, heading, save: saveOverride, draftScope, existingId, exercises, onClose, onSaved }: {
  athleteId?: string
  athleteName?: string
  date?: string
  workout: Workout | null
  template?: { title: string; prescription: string; items: Partial<WorkoutItem>[] }  // «Из шаблона» / день программы
  heading?: string
  save?: (d: Draft, id: string) => Promise<string | null>
  draftScope: readonly (string | number)[]
  existingId?: string
  exercises: Exercise[]
  onClose: () => void
  onSaved: () => void
}) {
  const initial = useState(() => ({
    title: workout?.title ?? template?.title ?? '',
    prescription: workout?.prescription ?? template?.prescription ?? '',
    published: workout?.published ?? true,
    items: workout ? (workout.workout_items ?? []).filter((i) => !i.self).sort((a, b) => a.position - b.position)
      : (template?.items ?? []).map((i, position) => ({ ...blank({ name: '', ...i } as Suggestion, position), ...i, id: crypto.randomUUID() }) as WorkoutItem),
  }))[0]
  const key = draftKey(draftScope)
  const [stored, setStored] = useState(() => readDraft(localStorage, key))
  const [id, setId] = useState(() => workout?.id ?? existingId ?? crypto.randomUUID())
  const wasStored = useRef(false)
  const [storageError, setStorageError] = useState(false)
  const [title, setTitle] = useState(initial.title)
  const [prescription, setPrescription] = useState(initial.prescription)
  const [published, setPublished] = useState(initial.published)
  const [items, setItems] = useState<WorkoutItem[]>(initial.items)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const box = useRef<HTMLElement>(null)
  useEffect(() => { box.current?.scrollIntoView({ block: 'start' }) }, [])  // на телефоне редактор ниже всей недели
  const dirty = JSON.stringify({ title, prescription, published, items }) !== JSON.stringify(initial)

  useLayoutEffect(() => {
    if (stored || (!dirty && !wasStored.current)) return
    try {
      localStorage.setItem(key, JSON.stringify({ id, title, prescription, published, items }))
      wasStored.current = true
      setStorageError(false)
    } catch { setStorageError(true) }
  }, [key, id, title, prescription, published, items, stored, dirty])

  const deleteDraft = () => {
    try { localStorage.removeItem(key); return true } catch { setStorageError(true); return false }
  }
  const restore = () => {
    if (!stored) return
    wasStored.current = true
    setId(stored.id)
    setTitle(stored.title)
    setPrescription(stored.prescription)
    setPublished(stored.published)
    setItems(stored.items)
    setStored(null)
  }

  useEffect(() => {
    if (!dirty || !storageError) return
    const f = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', f)
    return () => removeEventListener('beforeunload', f)
  }, [dirty, storageError])

  const close = () => {
    if (!dirty || !storageError || confirm('Черновик не записался в телефон. Закрыть редактор?')) onClose()
  }

  const update = (id: string, patch: Partial<WorkoutItem>) => setItems((l) => l.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const labels = itemLabels(items)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setItems((l) => arrayMove(l, l.findIndex((i) => i.id === active.id), l.findIndex((i) => i.id === over.id)))
  }

  const menu = {
    superset: (i: number) => setItems((l) => {
      const next = l[i + 1]
      if (!next) return l
      const group = l[i].superset ?? next.superset ?? Math.max(0, ...l.map((x) => x.superset ?? 0)) + 1
      return l.map((x, j) => (j === i || j === i + 1 ? { ...x, superset: group } : x))
    }),
    unsuperset: (i: number) => setItems((l) => l.map((x, j) => (j === i ? { ...x, superset: null, block_note: '' } : x))),
    duplicate: (i: number) => setItems((l) => [...l.slice(0, i + 1), { ...l[i], id: crypto.randomUUID() }, ...l.slice(i + 1)]),
    remove: (i: number) => setItems((l) => l.filter((_, j) => j !== i)),
    toTemplate: async (it: WorkoutItem) => {
      const { error } = await supabase.from('item_templates').insert({
        name: it.name, exercise_id: it.exercise_id, plan_text: it.plan_text, video_url: it.video_url,
        result_type: it.result_type, planned_sets: it.planned_sets,
      })
      alert(error ? 'Не сохранилось: ' + error.message : `«${it.name}» сохранено в «Мои шаблоны»`)
    },
  }

  const save = async () => {
    if (!items.length) return setError('Добавьте хотя бы одно задание')
    if (items.some((i) => !i.name.trim())) return setError('У каждого задания должно быть название')
    setBusy(true)
    setError('')
    const clean = items.map((i, position) => ({ ...i, position, name: i.name.trim() }))
    try {
      if (saveOverride) {
        const error = await saveOverride({ title: title.trim(), prescription, published, items: clean }, id)
        if (error) throw new Error(error)
      } else {
        const { error } = await supabase.rpc('save_workout', {
          w: { id, athlete_id: athleteId, date: workout?.date ?? date, title: title.trim(), prescription, published },
          items: clean,
        })
        if (error) throw error
      }
      deleteDraft()
      onSaved()
    } catch (cause) {
      recordFailure('Редактор тренировки', 'Сохранение', cause)
      setError('Не сохранилось. Проверьте связь и повторите.')
    } finally {
      setBusy(false)
    }
  }

  if (stored) return <section ref={box} className="editor card">
    <div className="row-between"><b>Есть черновик на этом телефоне</b><button className="back" onClick={close}>✕</button></div>
    <div className="row">
      <button className="btn" onClick={restore}>Восстановить</button>
      <button className="btn secondary" onClick={() => { if (deleteDraft()) setStored(null) }}>Удалить черновик</button>
    </div>
    {storageError && <p className="error">Не удалось удалить черновик с телефона.</p>}
  </section>

  return (
    <section ref={box} className="editor card">
      <div className="row-between">
        <b>{heading ?? `${fmtDay(workout?.date ?? date)} — ${athleteName}`}</b>
        <button className="back" onClick={close} disabled={busy}>✕</button>
      </div>
      <fieldset disabled={busy} className="workout-fields">
      {!saveOverride && (
        <div className="segmented">
          <button className={!published ? 'active' : ''} onClick={() => setPublished(false)}>Черновик</button>
          <button className={published ? 'active' : ''} onClick={() => setPublished(true)}>Опубликовано</button>
        </div>
      )}
      <input placeholder="Название тренировки" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea rows={2} placeholder="Предписание к тренировке" value={prescription} onChange={(e) => setPrescription(e.target.value)} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((it, i) => (
            <ItemRow key={it.id} item={it} label={labels[i]} groupStart={isGroupStart(items, i)}
              inGroup={labels[i].length > String(parseInt(labels[i])).length}
              hasNext={i < items.length - 1}
              onChange={(p) => update(it.id, p)}
              onMenu={(action) => (action === 'template' ? menu.toTemplate(it) : menu[action](i))} />
          ))}
        </SortableContext>
      </DndContext>

      <AddItem athleteId={athleteId} exercises={exercises} onAdd={(s) => setItems((l) => [...l, blank(s, l.length)])} />
      <button className="btn secondary" onClick={() => setItems((l) => [...l, blank({ name: complexName(5), result_type: 'time', planned_sets: 1 }, l.length)])}>+ Комплекс</button>
      {athleteId && (picking
        ? <PickWorkout athleteId={athleteId} monday={mondayOf(workout?.date ?? date)}
            onPick={(w) => { setItems((l) => appendItems(l, w.workout_items ?? [])); setPicking(false) }} onCancel={() => setPicking(false)} />
        : <button className="btn secondary" onClick={() => setPicking(true)}>Вставить из другой тренировки</button>)}

      </fieldset>
      {storageError && <p className="error">Не удалось записать черновик на телефон. Сохраните тренировку перед выходом.</p>}
      {error && <><p className="error" role="alert">{error}</p><DiagnosticButton /></>}
      <button className="btn" onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
    </section>
  )
}

function ItemRow({ item, label, groupStart, inGroup, hasNext, onChange, onMenu }: {
  item: WorkoutItem
  label: string
  groupStart: boolean
  inGroup: boolean
  hasNext: boolean
  onChange: (p: Partial<WorkoutItem>) => void
  onMenu: (a: 'superset' | 'unsuperset' | 'duplicate' | 'remove' | 'template') => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id })
  const plan = useRef<HTMLTextAreaElement>(null)
  const wrap = (mark: string) => {
    const t = plan.current
    if (!t) return
    const { selectionStart: a, selectionEnd: b, value } = t
    onChange({ plan_text: value.slice(0, a) + mark + value.slice(a, b) + mark + value.slice(b) })
  }
  const list = () => onChange({ plan_text: item.plan_text.split('\n').map((l) => (l.startsWith('- ') ? l : '- ' + l)).join('\n') })

  const complex = isComplex(item)
  const rounds = complexRounds(item.name) ?? 5

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={'item' + (inGroup ? ' superset' : '')}>
      {groupStart && (
        <input className="block-note" placeholder="Подпись суперсета: 5 раундов, отдых 2 мин" value={item.block_note}
          onChange={(e) => onChange({ block_note: e.target.value })} />
      )}
      <div className="item-head">
        <button className="handle" {...attributes} {...listeners} aria-label="Перетащить">⋮⋮</button>
        <b className="item-label">{label}</b>
        {complex ? <b className="item-name">Комплекс</b>
          : <input className="item-name" value={item.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Название" />}
        <details className="menu">
          <summary aria-label="Меню задания">⋯</summary>
          <div className="menu-list">
            {hasNext && <button onClick={() => onMenu('superset')}>В суперсет со следующим</button>}
            {inGroup && <button onClick={() => onMenu('unsuperset')}>Убрать из суперсета</button>}
            <button onClick={() => onMenu('duplicate')}>Дублировать</button>
            <button onClick={() => onMenu('template')}>Сохранить в шаблоны</button>
            <button onClick={() => onMenu('remove')}>Удалить</button>
          </div>
        </details>
      </div>
      <div className="format-bar">
        <button type="button" onClick={() => wrap('**')}><b>Ж</b></button>
        <button type="button" onClick={() => wrap('*')}><i>К</i></button>
        <button type="button" onClick={list}>• список</button>
      </div>
      <label>Описание задания
      <textarea ref={plan} className="plan-text" rows={6} placeholder={complex ? 'Что делать: 10 подтягиваний, 15 приседов, 200 м бег' : 'Текст плана'} value={item.plan_text} onChange={(e) => onChange({ plan_text: e.target.value })} /></label>
      <div className="row timer-row">
        <select value={item.timer?.kind ?? ''} aria-label="Таймер комплекса" onChange={(e) => {
          const kind = e.target.value as TimerCfg['kind'] | ''
          // таймер сам подставит результат: круги для АМРАП, время для «на время»
          onChange(kind ? { timer: kind === 'tabata' ? { kind, work: 20, rest: 10, rounds: 8 } : { kind, minutes: item.timer?.minutes ?? 12 },
            ...(kind === 'amrap' ? { result_type: 'rounds' as const, ...(complex && { name: complexName(null) }) } : kind === 'fortime' ? { result_type: 'time' as const } : {}) } : { timer: null })
        }}>
          <option value="">без таймера</option>
          {TIMER_KINDS.map(([k, l]) => <option key={k} value={k}>Таймер: {l}</option>)}
        </select>
        {item.timer && item.timer.kind !== 'tabata' && (
          <label className="pct-input">
            <input inputMode="numeric" value={item.timer.minutes ?? ''} aria-label="Минут"
              onChange={(e) => onChange({ timer: { ...item.timer!, minutes: Number(e.target.value) || undefined } })} />
            <span className="muted">мин</span>
          </label>
        )}
      </div>
      <input type="url" inputMode="url" placeholder="Видео: ссылка Rutube / VK / YouTube" value={item.video_url ?? ''}
        onChange={(e) => onChange({ video_url: e.target.value || null })} />
      {complex ? (
        <div className="row">
          <select value={item.result_type} aria-label="Результат комплекса" onChange={(e) => {
            const t = e.target.value as ResultType
            onChange({ result_type: t, name: complexName(t === 'rounds' ? null : rounds) })  // у АМРАП раундов нет — считают круги
          }}>
            {COMPLEX_RESULTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {item.result_type !== 'rounds' && (
            <div className="stepper">
              <button type="button" onClick={() => onChange({ name: complexName(Math.max(1, rounds - 1)) })} aria-label="Меньше раундов">−</button>
              <span>{rounds} р.</span>
              <button type="button" onClick={() => onChange({ name: complexName(rounds + 1) })} aria-label="Больше раундов">+</button>
            </div>
          )}
        </div>
      ) : <div className="row">
        <select value={item.result_type} onChange={(e) => onChange({ result_type: e.target.value as ResultType })} aria-label="Тип результата">
          {RESULT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {['weight_reps', 'weight'].includes(item.result_type) && (
          <label className="pct-input">
            <input inputMode="decimal" placeholder="%" value={item.pct ?? ''} aria-label="% от 1ПМ"
              onChange={(e) => onChange({ pct: e.target.value ? Number(e.target.value.replace(',', '.')) || null : null })} />
            <span className="muted">% 1ПМ</span>
          </label>
        )}
        <div className="stepper">
          <button type="button" onClick={() => onChange({ planned_sets: Math.max(0, item.planned_sets - 1) })} aria-label="Меньше подходов">−</button>
          <span>{item.planned_sets}</span>
          <button type="button" onClick={() => onChange({ planned_sets: Math.min(50, item.planned_sets + 1) })} aria-label="Больше подходов">+</button>
        </div>
      </div>}
    </div>
  )
}

/** «+ Задание»: поиск сразу в истории атлета, шаблонах тренера и базе упражнений. */
function AddItem({ athleteId, exercises, onAdd }: { athleteId?: string; exercises: Exercise[]; onAdd: (s: Suggestion) => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const pending = useRef(new Map<string, string>())
  const [added, setAdded] = useState<Exercise[]>([])
  const [history, setHistory] = useState<Suggestion[]>([])
  const [templates, setTemplates] = useState<Template[]>([])

  useEffect(() => {
    if (athleteId) supabase.from('workout_items')
      .select('name, exercise_id, plan_text, video_url, result_type, planned_sets, workouts!inner(athlete_id, date)')
      .eq('workouts.athlete_id', athleteId).eq('self', false).limit(1000)
      .then(({ data }) => {
        const rows = ((data ?? []) as unknown as (Suggestion & { workouts: { date: string } })[])
          .sort((a, b) => b.workouts.date.localeCompare(a.workouts.date))
        const seen = new Set<string>()
        // последнее назначение каждого упражнения
        setHistory(rows.filter((r) => !seen.has(norm(r.name)) && !!seen.add(norm(r.name))))
      })
    supabase.from('item_templates').select('*').order('name').then(({ data }) => setTemplates((data ?? []) as Template[]))
  }, [athleteId])

  const words = norm(q).split(/\s+/).filter(Boolean)
  const match = (name: string) => words.every((w) => norm(name).includes(w))
  const found = words.length ? {
    history: history.filter((h) => match(h.name)).slice(0, 5),
    templates: templates.filter((t) => match(t.name)).slice(0, 5),
    base: searchExercises([...added, ...exercises], q).slice(0, 8),
  } : null

  const pick = (s: Suggestion) => { onAdd(s); setQ('') }
  const addNew = async () => {
    const name = q.trim()
    const id = pending.current.get(name) ?? crypto.randomUUID()
    pending.current.set(name, id)
    setBusy(true)
    setError(false)
    try {
      const { error } = await supabase.from('exercises').upsert({ id, name, source: 'coach' }, { ignoreDuplicates: true })
      if (error) throw error
      pending.current.delete(name)
      setAdded((previous) => [...previous, { id, name, aliases: [], muscles: [], equipment: null, image_url: null, video_url: null, source: 'coach' }])
      pick({ name, exercise_id: id, plan_text: '', video_url: null, result_type: 'weight_reps', planned_sets: 3 })
    } catch (cause) {
      recordFailure('Редактор тренировки', 'Добавление упражнения', cause)
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="add-item">
      <label>Поиск по названию упражнения
        <input type="search" placeholder="Присед, жим…" value={q} disabled={busy} onChange={(e) => { setQ(e.target.value); setError(false) }} />
      </label>
      {found && (
        <fieldset disabled={busy} className="suggest workout-fields">
          {found.history.length > 0 && <small className="muted">История этого атлета</small>}
          {found.history.map((h, i) => (
            <button key={'h' + i} onClick={() => pick(h)}><b>{h.name}</b> <span className="muted">{h.plan_text.split('\n')[0]}</span></button>
          ))}
          {found.templates.length > 0 && <small className="muted">Мои шаблоны</small>}
          {found.templates.map((t) => <button key={t.id} onClick={() => pick(t)}><b>{t.name}</b> <span className="muted">{t.plan_text.split('\n')[0]}</span></button>)}
          {found.base.length > 0 && <small className="muted">База упражнений</small>}
          {found.base.map((e) => (
            <button key={e.id} onClick={() => pick({ name: e.name, exercise_id: e.id, plan_text: '', video_url: e.video_url, result_type: e.default_result_type ?? 'weight_reps', planned_sets: e.default_result_type === 'cardio' ? 1 : 3 })}>
              {e.name}
            </button>
          ))}
          <button onClick={addNew}>{busy ? 'Добавляю…' : '+ Новое упражнение «' + q.trim() + '»'}</button>
        </fieldset>
      )}
      {error && <><p className="error" role="alert">Не удалось добавить упражнение. Проверьте связь и повторите.</p><DiagnosticButton /></>}
    </div>
  )
}
