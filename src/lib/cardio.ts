// Кардио-тренажёры (Concept2 и аналоги): время + метры + средний пульс → темп и «метры на удар сердца».
import { fmtNum, fmtTime } from './format'

export type Cardio = { time_sec?: number | null; meters?: number | null; hr?: number | null }

/** Время и метры похожи на правду (не ноль). */
export const cardioOk = (s: Cardio) => (s.time_sec ?? 0) > 0 && Number(s.meters ?? 0) > 0
/** Пульс вписан и правдоподобен. */
export const hrOk = (hr: number | null | undefined) => hr != null && hr >= 40 && hr <= 230

/** Метры ÷ (пульс × минуты); минуты с секундами. Нет пульса или ерунда в числах — null. */
export const efficiency = (s: Cardio): number | null =>
  cardioOk(s) && hrOk(s.hr) ? Number(s.meters) / (s.hr! * (s.time_sec! / 60)) : null

/** Темп на 500 м: «2:09/500», секунды до целых. */
export const pace500 = (s: Cardio): string | null =>
  cardioOk(s) ? fmtTime(Math.round(s.time_sec! / (Number(s.meters) / 500))) + '/500' : null

/** «1,67» — два знака, запятая. */
export const fmtEff = (e: number) => e.toFixed(2).replace('.', ',')

type Past = Cardio & { date: string; set_no?: number }
const speed = (s: Cardio) => Number(s.meters) / s.time_sec!  // м/с
const minutes = (s: Cardio) => s.time_sec! / 60
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const newestFirst = (a: Past, b: Past) => b.date.localeCompare(a.date) || (b.set_no ?? 0) - (a.set_no ?? 0)

/** Метод наименьших квадратов: y ≈ X·k. Решаем нормальные уравнения Гауссом; вырожденная система — null. */
export function lsq(X: number[][], y: number[]): number[] | null {
  const m = X[0].length
  const A = Array.from({ length: m }, (_, i) => [
    ...Array.from({ length: m }, (_, j) => X.reduce((sum, r) => sum + r[i] * r[j], 0)),
    X.reduce((sum, r, k) => sum + r[i] * y[k], 0),
  ])
  for (let c = 0; c < m; c++) {
    const p = A.slice(c).reduce((best, r, k) => (Math.abs(r[c]) > Math.abs(A[best][c]) ? c + k : best), c)
    if (Math.abs(A[p][c]) < 1e-9) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < m; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let j = c; j <= m; j++) A[r][j] -= f * A[c][j]
    }
  }
  return A.map((r, i) => r[m] / r[i])
}

/**
 * Личная норма атлета: скорость ≈ a + b·пульс (ступень 2, от 6 тренировок с разбросом пульса ≥ 10)
 * или a + b·пульс + c·минуты (ступень 3, от 12 тренировок, длительности различаются в 1,5 раза) — учитывает,
 * что на длинной тренировке пульс сам ползёт вверх. Берём 30 последних: норма идёт за формой.
 */
export type Norm = { level: 2 | 3; a: number; b: number; c: number; n: number; hr: [number, number]; min: [number, number] }
export function personalNorm(past: Past[]): Norm | null {
  const pts = past.filter((s) => efficiency(s) != null).sort(newestFirst).slice(0, 30)
  if (pts.length < 6) return null
  const hrs = pts.map((s) => s.hr!)
  const mins = pts.map(minutes)
  const hr: [number, number] = [Math.min(...hrs), Math.max(...hrs)]
  const min: [number, number] = [Math.min(...mins), Math.max(...mins)]
  if (hr[1] - hr[0] < 10) return null
  const v = pts.map(speed)
  // быстрее на большем пульсе (b > 0) и не быстрее на длинной (c ≤ 0) — иначе данные противоречат сами себе
  if (pts.length >= 12 && min[1] / min[0] >= 1.5) {
    const k = lsq(pts.map((s) => [1, s.hr!, minutes(s)]), v)
    if (k && k[1] > 0 && k[2] <= 0) return { level: 3, a: k[0], b: k[1], c: k[2], n: pts.length, hr, min }
  }
  const k = lsq(pts.map((s) => [1, s.hr!]), v)
  return k && k[1] > 0 ? { level: 2, a: k[0], b: k[1], c: 0, n: pts.length, hr, min } : null
}
/** Ожидаемая скорость по норме; минуты — в пределах уже виденных, чтобы не гадать за краем. */
const predict = (k: Norm, hr: number, min: number) => k.a + k.b * hr + k.c * Math.min(k.min[1], Math.max(k.min[0], min))

export type Comparison = { pct: number; n: number; level: 1 | 2 | 3; usual?: number }

/**
 * Сравнение тем точнее, чем больше тренировок:
 * 1 — среднее «м/удар» 4 последних похожих (пульс ±10, длительность ±30%);
 * 2–3 — скорость против личной нормы на этом пульсе (и этой длительности). Пульс за краем нормы — ступень 1.
 */
export function compare(cur: Cardio, past: Past[]): Comparison | null {
  const e = efficiency(cur)
  if (e == null) return null
  const norm = personalNorm(past)
  if (norm && cur.hr! >= norm.hr[0] - 5 && cur.hr! <= norm.hr[1] + 5) {
    const v = predict(norm, cur.hr!, minutes(cur))
    if (v > 0) return { pct: (speed(cur) / v - 1) * 100, n: norm.n, level: norm.level, usual: 500 / v }
  }
  const near = past
    .filter((s) => efficiency(s) != null && Math.abs(s.hr! - cur.hr!) <= 10 && s.time_sec! / cur.time_sec! >= 1 / 1.3 && s.time_sec! / cur.time_sec! <= 1.3)
    .sort(newestFirst)
    .slice(0, 4)
  if (!near.length) return null
  const avg = near.reduce((sum, s) => sum + efficiency(s)!, 0) / near.length
  return { pct: ((e - avg) / avg) * 100, n: near.length, level: 1 }
}

/** «▲ 4% к среднему», «▼ 4%», меньше 1% — «≈ как обычно». */
export const fmtCompare = (c: { pct: number }, short = false) =>
  Math.abs(c.pct) < 1 ? '≈ как обычно' : `${c.pct > 0 ? '▲' : '▼'} ${Math.abs(Math.round(c.pct))}%${short ? '' : ' к среднему'}`

/** Строка сравнения под подходом. */
function compareLine(cur: Cardio, c: Comparison) {
  if (c.level === 1) return `${fmtCompare(c)} (${c.n} трен.)`
  const at = `на пульсе ${cur.hr}${c.level === 3 ? ` за ${Math.round(minutes(cur))} мин` : ''}`
  const head = Math.abs(c.pct) < 1 ? '≈ как обычно' : `${fmtCompare(c, true)} к норме`
  return `${head} ${at}: обычно ${fmtTime(Math.round(c.usual!))}/500 (${c.n} трен.)`
}

/**
 * График «Темп на пульсе X»: каждый подход приведён по личной норме к одному пульсу (и одной длительности),
 * поэтому тренировки на разном пульсе ложатся на одну линию. Нормы ещё нет — просто темп.
 */
export function paceSeries(sets: Past[]): { label: string; points: { x: string; y: number }[] } {
  const ok = sets.filter((s) => cardioOk(s))
  const norm = personalNorm(ok)
  const hr0 = norm ? Math.round(median(ok.filter((s) => efficiency(s) != null).map((s) => s.hr!)) / 5) * 5 : 0
  const min0 = norm ? Math.round(median(ok.filter((s) => efficiency(s) != null).map(minutes)) / 5) * 5 : 0
  const byDate = new Map<string, number>()
  for (const s of norm ? ok.filter((x) => efficiency(x) != null) : ok) {
    const v = norm ? speed(s) + norm.b * (hr0 - s.hr!) + norm.c * (min0 - minutes(s)) : speed(s)
    if (v <= 0) continue
    const pace = 500 / v
    byDate.set(s.date, Math.min(byDate.get(s.date) ?? Infinity, pace))
  }
  const label = !norm ? 'Темп на 500 м (меньше — лучше)'
    : `Темп на пульсе ${hr0}${norm.level === 3 ? `, за ${min0} мин` : ''} (меньше — лучше)`
  return { label, points: [...byDate.keys()].sort().map((x) => ({ x, y: Math.round(byDate.get(x)!) })) }
}

/** Строки под подходом: «темп 2:09/500 · 1,67 м/удар» и сравнение. Пусто — подход ещё не вписан. */
export function cardioLines(cur: Cardio, past: (Cardio & { date: string; set_no?: number })[]): string[] {
  const pace = pace500(cur)
  if (!pace) return []
  if (cur.hr == null) return [`темп ${pace} · без пульса — эффективность не считаем`]
  const e = efficiency(cur)
  if (e == null) return [`темп ${pace} · пульс вне 40–230 — эффективность не считаем`]
  const c = compare(cur, past)
  return [`темп ${pace} · ${fmtEff(e)} м/удар`, c ? compareLine(cur, c) : 'не с чем сравнить']
}

/** Строка в ленте тренера: «Гребля 30:00 · 7000 м · пульс 140 · 1,67 м/уд ▲ 4%». */
export function cardioSummary(name: string, s: Cardio, past: (Cardio & { date: string; set_no?: number })[]): string | null {
  if (!cardioOk(s)) return null
  const e = efficiency(s)
  const c = compare(s, past)
  return [name, fmtTime(s.time_sec!), `${fmtNum(Number(s.meters))} м`, s.hr != null && `пульс ${s.hr}`,
    e != null && `${fmtEff(e)} м/уд${c ? ' ' + fmtCompare(c, true) : ''}`].filter(Boolean).join(' · ').replace(' · ', ' ')
}
