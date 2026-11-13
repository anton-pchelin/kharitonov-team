// Расчёты прогресса: расчётный максимум, рекорды, недельная регулярность.
import type { PastSet } from './offline'
import { mondayOf } from './dates'

/** Расчётный 1ПМ по формуле Эпли: вес × (1 + повторы/30); на 1 повтор — сам вес. */
export const epley = (weight: number, reps: number) => (reps > 1 ? weight * (1 + reps / 30) : weight)

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е').trim()
/** Одно упражнение в истории: по id из базы, иначе по названию. */
export const exerciseKey = (s: { exercise_id: string | null; name: string }) => s.exercise_id ?? 'name:' + norm(s.name)

export type Point = { x: string; y: number }

/** По датам: лучший вес и лучший расчётный 1ПМ (для упражнений с весом). */
export function weightSeries(sets: PastSet[]): { best: Point[]; e1rm: Point[] } {
  const byDate = new Map<string, { best: number; e1rm: number }>()
  for (const s of sets) {
    const w = Number(s.weight ?? 0)
    if (!(w > 0)) continue
    const cur = byDate.get(s.date) ?? { best: 0, e1rm: 0 }
    byDate.set(s.date, { best: Math.max(cur.best, w), e1rm: Math.max(cur.e1rm, epley(w, s.reps ?? 1)) })
  }
  const dates = [...byDate.keys()].sort()
  return {
    best: dates.map((x) => ({ x, y: byDate.get(x)!.best })),
    e1rm: dates.map((x) => ({ x, y: Math.round(byDate.get(x)!.e1rm * 10) / 10 })),
  }
}

/** По датам: лучшее значение поля (повторы, время, метры). Для времени «лучше» задаёт lowerIsBetter. */
export function fieldSeries(sets: PastSet[], field: 'reps' | 'time_sec' | 'meters' | 'rounds' | 'calories', lowerIsBetter = false): Point[] {
  const byDate = new Map<string, number>()
  for (const s of sets) {
    const v = s[field]
    if (v == null) continue
    const n = Number(v)
    const cur = byDate.get(s.date)
    byDate.set(s.date, cur == null ? n : lowerIsBetter ? Math.min(cur, n) : Math.max(cur, n))
  }
  return [...byDate.keys()].sort().map((x) => ({ x, y: byDate.get(x)! }))
}

export type Records = { e1rm?: number; byReps: { reps: number; weight: number }[]; maxReps?: number; bestTime?: number; bestMeters?: number }

/** Рекорды из всех подходов: лучший вес на 1/3/5/10 повторений, 1ПМ, максимум повторов, лучшее время и дистанция. */
export function records(sets: PastSet[], lowerIsBetter = false): Records {
  const r: Records = { byReps: [] }
  for (const n of [1, 3, 5, 10]) {
    const w = Math.max(0, ...sets.filter((s) => (s.reps ?? 0) >= n && s.weight != null).map((s) => Number(s.weight)))
    if (w > 0) r.byReps.push({ reps: n, weight: w })
  }
  const e = Math.max(0, ...sets.filter((s) => s.weight != null && (s.reps ?? 0) > 0).map((s) => epley(Number(s.weight), s.reps!)))
  if (e > 0) r.e1rm = Math.round(e * 10) / 10
  const reps = sets.map((s) => s.reps).filter((v): v is number => v != null)
  if (reps.length) r.maxReps = Math.max(...reps)
  const times = sets.map((s) => s.time_sec).filter((v): v is number => v != null)
  if (times.length) r.bestTime = lowerIsBetter ? Math.min(...times) : Math.max(...times)
  const m = sets.map((s) => s.meters).filter((v): v is number => v != null).map(Number)
  if (m.length) r.bestMeters = Math.max(...m)
  return r
}

/** Подход — новый рекорд, если его 1ПМ выше всех прошлых подходов этого упражнения. */
export function isRecordSet(weight: number | null | undefined, reps: number | null | undefined, earlier: PastSet[]): boolean {
  if (!weight || !reps) return false
  const best = Math.max(0, ...earlier.filter((s) => s.weight && s.reps).map((s) => epley(Number(s.weight), s.reps!)))
  return best > 0 && epley(Number(weight), reps) > best
}

export type Week = { monday: string; workouts: number; tonnage: number }

/** Регулярность и объём по неделям: сколько тренировок с результатами и сколько поднято. */
export function weeklyStats(sets: (PastSet & { workout_id?: string })[]): Week[] {
  const map = new Map<string, { workouts: Set<string>; tonnage: number }>()
  for (const s of sets) {
    const m = mondayOf(s.date)
    const cur = map.get(m) ?? { workouts: new Set(), tonnage: 0 }
    cur.workouts.add(s.workout_id ?? s.date)
    cur.tonnage += Number(s.weight ?? 0) * (s.reps ?? 0)
    map.set(m, cur)
  }
  return [...map.keys()].sort().map((monday) => ({ monday, workouts: map.get(monday)!.workouts.size, tonnage: Math.round(map.get(monday)!.tonnage) }))
}

export type MaxRecord = { exercise_id: string | null; name: string; weight: number | null; reps: number | null }

/** Максимум атлета в упражнении: лучший расчётный 1ПМ из истории и рекордов вручную. */
export function maxFor(item: { exercise_id: string | null; name: string }, history: PastSet[], manual: MaxRecord[]): number | null {
  const key = exerciseKey(item)
  const vals = [
    ...history.filter((h) => exerciseKey(h) === key && h.weight && h.reps).map((h) => epley(Number(h.weight), h.reps!)),
    ...manual.filter((r) => exerciseKey(r) === key && r.weight).map((r) => epley(Number(r.weight), r.reps ?? 1)),
  ]
  return vals.length ? Math.max(...vals) : null
}

/** Вес от % максимума, округление до 2,5 кг. */
export const pctWeight = (pct: number, max: number) => Math.round((max * pct) / 100 / 2.5) * 2.5
