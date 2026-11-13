// Данные атлета без интернета: тренировки ±2 недели, результаты и история лежат в телефоне (localStorage),
// всё введённое сразу пишется туда и встаёт в очередь отправки. Очередь уходит, как только есть сеть.
import { supabase } from '../supabase'
import { addDays, today } from './dates'
import type { Workout, WorkoutItem } from './workout'
import type { MaxRecord } from './progress'

export type SetResult = {
  item_id: string
  set_no: number
  weight?: number | null
  reps?: number | null
  time_sec?: number | null
  meters?: number | null
  calories?: number | null
  rounds?: number | null
  done: boolean
}
export type Comment = { id: string; workout_id: string; item_id: string | null; author_id: string; text: string; created_at: string }
/** Подход из прошлых тренировок — для подсказки «прошлый раз» и графиков. */
export type PastSet = SetResult & { date: string; name: string; exercise_id: string | null }

export type Cache = { workouts: Workout[]; results: SetResult[]; comments: Comment[]; history: PastSet[]; records: MaxRecord[]; syncedAt: string | null }
export type Op =
  | { t: 'set'; row: SetResult }
  | { t: 'unset'; item_id: string; set_no: number }
  | { t: 'comment'; row: Comment }
  | { t: 'workout'; row: Workout }
  | { t: 'item'; row: WorkoutItem & { workout_id: string } }
  | { t: 'complete'; id: string; at: string }
  | { t: 'record'; row: MaxRecord & { id: string; athlete_id: string } }

const empty = (): Cache => ({ workouts: [], results: [], comments: [], history: [], records: [], syncedAt: null })
const sameSet = (a: { item_id: string; set_no: number }, b: { item_id: string; set_no: number }) =>
  a.item_id === b.item_id && a.set_no === b.set_no

/** Применить действие к данным в телефоне (и при вводе, и поверх свежих данных с сервера). */
export function applyLocal(c: Cache, op: Op): Cache {
  switch (op.t) {
    case 'set': return { ...c, results: [...c.results.filter((r) => !sameSet(r, op.row)), op.row] }
    case 'unset': return { ...c, results: c.results.filter((r) => !sameSet(r, op)) }
    case 'comment': return c.comments.some((x) => x.id === op.row.id) ? c : { ...c, comments: [...c.comments, op.row] }
    case 'workout': return c.workouts.some((w) => w.id === op.row.id) ? c : { ...c, workouts: [...c.workouts, op.row] }
    case 'item': return {
      ...c,
      workouts: c.workouts.map((w) => w.id !== op.row.workout_id || w.workout_items?.some((i) => i.id === op.row.id) ? w
        : { ...w, workout_items: [...(w.workout_items ?? []), op.row] }),
    }
    case 'complete': return { ...c, workouts: c.workouts.map((w) => (w.id === op.id ? { ...w, completed_at: w.completed_at ?? op.at } : w)) }
    case 'record': return { ...c, records: [...(c.records ?? []), op.row] }
  }
}

const isNetworkError = (e: { code?: string; message?: string }) => !navigator.onLine || !e.code

async function send(op: Op) {
  switch (op.t) {
    case 'set': return supabase.from('set_results').upsert({ ...op.row, updated_at: new Date().toISOString() }, { onConflict: 'item_id,set_no' })
    case 'unset': return supabase.from('set_results').delete().eq('item_id', op.item_id).eq('set_no', op.set_no)
    case 'comment': return supabase.from('comments').upsert(op.row, { onConflict: 'id', ignoreDuplicates: true })
    case 'workout': {
      const { workout_items: _, ...row } = op.row
      return supabase.from('workouts').upsert({ ...row, self: true, published: true }, { onConflict: 'id', ignoreDuplicates: true })
    }
    case 'item': return supabase.from('workout_items').upsert({ ...op.row, self: true }, { onConflict: 'id', ignoreDuplicates: true })
    case 'complete': return supabase.rpc('complete_workout', { p_id: op.id, p_at: op.at })
    case 'record': return supabase.from('records').upsert(op.row, { onConflict: 'id', ignoreDuplicates: true })
  }
}

export type Status = 'synced' | 'pending' | 'offline'

/** Хранилище одного атлета. Экран подписывается через useSyncExternalStore. */
export class OfflineStore {
  private cache: Cache
  private queue: Op[]
  private listeners = new Set<() => void>()
  private flushing = false
  status: Status = 'pending'
  lastError = ''

  constructor(private userId: string) {
    this.cache = this.read('cache', empty())
    this.queue = this.read('queue', [])
    addEventListener('online', () => this.flush())
    addEventListener('offline', () => this.emit())
    this.emit()
  }

  private key = (k: string) => `${k}:v1:${this.userId}`
  private read<T>(k: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(this.key(k)) ?? '') as T } catch { return fallback }
  }
  private save() {
    localStorage.setItem(this.key('cache'), JSON.stringify(this.cache))
    localStorage.setItem(this.key('queue'), JSON.stringify(this.queue))
  }
  private emit() {
    this.status = !navigator.onLine ? 'offline' : this.queue.length ? 'pending' : 'synced'
    this.snapshot = { ...this.cache }
    this.listeners.forEach((f) => f())
  }

  snapshot: Cache = empty()
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f) } }
  getSnapshot = () => this.snapshot

  /** Ввод атлета: сразу в телефон, потом — на сервер. */
  do(op: Op) {
    this.cache = applyLocal(this.cache, op)
    this.queue.push(op)
    this.save()
    this.emit()
    this.flush()
  }

  async flush() {
    if (this.flushing) return
    this.flushing = true
    try {
      while (this.queue.length && navigator.onLine) {
        const { error } = await send(this.queue[0])
        if (error && isNetworkError(error)) break
        // ошибка самой базы (нет прав, неверные данные) повторами не лечится — снимаем, чтобы не держать очередь
        if (error) this.lastError = error.message
        this.queue.shift()
        this.save()
      }
      if (!this.queue.length && navigator.onLine) await this.refresh()
    } finally {
      this.flushing = false
      this.emit()
    }
  }

  /** Свежие данные с сервера + поверх них ещё не отправленное. */
  private async refresh() {
    const from = addDays(today(), -7)
    const to = addDays(today(), 14)
    const [w, r, rec] = await Promise.all([
      supabase.from('workouts').select('*, workout_items(*)').eq('athlete_id', this.userId).gte('date', from).lte('date', to),
      supabase.from('set_results')
        .select('item_id, set_no, weight, reps, time_sec, meters, calories, rounds, done, workout_items!inner(name, exercise_id, workouts!inner(date))')
        .eq('athlete_id', this.userId).gte('workout_items.workouts.date', addDays(today(), -365)),
      supabase.from('records').select('exercise_id, name, weight, reps').eq('athlete_id', this.userId),
    ])
    if (w.error || r.error || rec.error) return
    const workouts = w.data as Workout[]
    const ids = workouts.map((x) => x.id)
    const c = ids.length ? await supabase.from('comments').select('*').in('workout_id', ids).order('created_at') : { data: [], error: null }
    if (c.error) return
    type Row = SetResult & { workout_items: { name: string; exercise_id: string | null; workouts: { date: string } } }
    const rows = r.data as unknown as Row[]
    const itemIds = new Set(workouts.flatMap((x) => (x.workout_items ?? []).map((i) => i.id)))
    let cache: Cache = {
      workouts,
      results: rows.filter((x) => itemIds.has(x.item_id)).map(({ workout_items: _, ...s }) => s),
      comments: c.data as Comment[],
      history: rows.map(({ workout_items: i, ...s }) => ({ ...s, name: i.name, exercise_id: i.exercise_id, date: i.workouts.date })),
      records: rec.data as MaxRecord[],
      syncedAt: new Date().toISOString(),
    }
    for (const op of this.queue) cache = applyLocal(cache, op)
    this.cache = cache
    this.save()
  }
}

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е').trim()

/** Подходы этого упражнения с прошлой тренировки (раньше даты date). */
export function previousSets(history: PastSet[], item: Pick<WorkoutItem, 'name' | 'exercise_id'>, date: string): PastSet[] {
  const same = history.filter((h) => h.date < date &&
    (item.exercise_id && h.exercise_id ? h.exercise_id === item.exercise_id : norm(h.name) === norm(item.name)))
  const last = same.reduce((d, h) => (h.date > d ? h.date : d), '')
  return same.filter((h) => h.date === last).sort((a, b) => a.set_no - b.set_no)
}
