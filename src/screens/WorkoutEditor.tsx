import { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../supabase'
import { searchExercises, type Exercise } from '../search'
import { fmtDay } from '../lib/dates'
import { RESULT_TYPES, isGroupStart, itemLabels, type ResultType, type Workout, type WorkoutItem } from '../lib/workout'

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
export type Draft = { title: string; prescription: string; published: boolean; items: WorkoutItem[] }

/** Снимок тренировки для шаблона или дня программы — без id, чтобы копии не путались с оригиналом. */
export const snapshot = (items: WorkoutItem[]) =>
  items.filter((i) => !i.self).sort((a, b) => a.position - b.position)
    .map(({ id: _id, workout_id: _w, self: _s, ...rest }, position) => ({ ...rest, position }))

export function WorkoutEditor({ athleteId, athleteName = '', date = '', workout, template, heading, save: saveOverride, exercises, onClose, onSaved }: {
  athleteId?: string
  athleteName?: string
  date?: string
  workout: Workout | null
  template?: { title: string; prescription: string; items: Partial<WorkoutItem>[] }  // «Из шаблона» / день программы
  heading?: string
  save?: (d: Draft) => Promise<string | null>  // своё сохранение (день программы); вернуть текст ошибки или null
  exercises: Exercise[]
  onClose: () => void
  onSaved: () => void
}) {
  const initial = useMemo(() => ({
    title: workout?.title ?? template?.title ?? '',
    prescription: workout?.prescription ?? template?.prescription ?? '',
    published: workout?.published ?? true,
    items: workout ? (workout.workout_items ?? []).filter((i) => !i.self).sort((a, b) => a.position - b.position)
      : (template?.items ?? []).map((i, position) => ({ ...blank({ name: '', ...i } as Suggestion, position), ...i, id: crypto.randomUUID() }) as WorkoutItem),
  }), [workout, template])
  const [title, setTitle] = useState(initial.title)
  const [prescription, setPrescription] = useState(initial.prescription)
  const [published, setPublished] = useState(initial.published)
  const [items, setItems] = useState<WorkoutItem[]>(initial.items)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLElement>(null)
  useEffect(() => { box.current?.scrollIntoView({ block: 'start' }) }, [])  // на телефоне редактор ниже всей недели
  const dirty = JSON.stringify({ title, prescription, published, items }) !== JSON.stringify(initial)

  useEffect(() => {
    if (!dirty) return
    const f = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', f)
    return () => removeEventListener('beforeunload', f)
  }, [dirty])

  const close = () => {
    if (!dirty || confirm('Выйти без сохранения?')) onClose()
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
    const err = saveOverride
      ? await saveOverride({ title: title.trim(), prescription, published, items: clean })
      : (await supabase.rpc('save_workout', {
        w: { id: workout?.id ?? null, athlete_id: athleteId, date: workout?.date ?? date, title: title.trim(), prescription, published },
        items: clean,
      })).error?.message ?? null
    setBusy(false)
    if (err) return setError('Не сохранилось: ' + err)
    onSaved()
  }

  return (
    <section ref={box} className="editor card">
      <div className="row-between">
        <b>{heading ?? `${fmtDay(workout?.date ?? date)} — ${athleteName}`}</b>
        <button className="back" onClick={close}>✕</button>
      </div>
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

      {error && <p className="error">{error}</p>}
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
        <input className="item-name" value={item.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Название" />
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
      <textarea ref={plan} rows={2} placeholder="Текст плана" value={item.plan_text} onChange={(e) => onChange({ plan_text: e.target.value })} />
      <input type="url" inputMode="url" placeholder="Видео: ссылка Rutube / VK / YouTube" value={item.video_url ?? ''}
        onChange={(e) => onChange({ video_url: e.target.value || null })} />
      <div className="row">
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
      </div>
    </div>
  )
}

/** «+ Задание»: поиск сразу в истории атлета, шаблонах тренера и базе упражнений. */
function AddItem({ athleteId, exercises, onAdd }: { athleteId?: string; exercises: Exercise[]; onAdd: (s: Suggestion) => void }) {
  const [q, setQ] = useState('')
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
    base: searchExercises(exercises, q).slice(0, 8),
  } : null

  const pick = (s: Suggestion) => { onAdd(s); setQ('') }
  const addNew = async () => {
    // новое упражнение сразу попадает в базу и дальше находится поиском
    const { data, error } = await supabase.from('exercises').insert({ name: q.trim(), source: 'coach' }).select('id').single()
    if (error) return alert('Не получилось добавить упражнение: ' + error.message)
    exercises.push({ id: data.id, name: q.trim(), aliases: [], muscles: [], equipment: null, image_url: null, video_url: null, source: 'coach' })
    pick({ name: q.trim(), exercise_id: data.id, plan_text: '', video_url: null, result_type: 'weight_reps', planned_sets: 3 })
  }

  return (
    <div className="add-item">
      <input type="search" placeholder="+ Задание: поиск — присед, жим…" value={q} onChange={(e) => setQ(e.target.value)} />
      {found && (
        <div className="suggest">
          {found.history.length > 0 && <small className="muted">История этого атлета</small>}
          {found.history.map((h, i) => (
            <button key={'h' + i} onClick={() => pick(h)}><b>{h.name}</b> <span className="muted">{h.plan_text.split('\n')[0]}</span></button>
          ))}
          {found.templates.length > 0 && <small className="muted">Мои шаблоны</small>}
          {found.templates.map((t) => <button key={t.id} onClick={() => pick(t)}><b>{t.name}</b> <span className="muted">{t.plan_text.split('\n')[0]}</span></button>)}
          {found.base.length > 0 && <small className="muted">База упражнений</small>}
          {found.base.map((e) => (
            <button key={e.id} onClick={() => pick({ name: e.name, exercise_id: e.id, plan_text: '', video_url: e.video_url, result_type: 'weight_reps', planned_sets: 3 })}>
              {e.name}
            </button>
          ))}
          <button onClick={addNew}>+ Новое упражнение «{q.trim()}»</button>
        </div>
      )}
    </div>
  )
}
