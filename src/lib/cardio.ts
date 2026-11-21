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

/**
 * Сравнение со средним «м/удар» 4 последних прошлых подходов на пульсе ±10 от сегодняшнего.
 * past — подходы этого упражнения раньше сегодняшнего (с датой). Нечего сравнивать — null.
 */
export function compare(cur: Cardio, past: (Cardio & { date: string; set_no?: number })[]): { pct: number; n: number } | null {
  const e = efficiency(cur)
  if (e == null) return null
  const near = past
    .filter((s) => efficiency(s) != null && Math.abs(s.hr! - cur.hr!) <= 10)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.set_no ?? 0) - (a.set_no ?? 0))
    .slice(0, 4)
  if (!near.length) return null
  const avg = near.reduce((sum, s) => sum + efficiency(s)!, 0) / near.length
  return { pct: ((e - avg) / avg) * 100, n: near.length }
}

/** «▲ 4% к среднему», «▼ 4%», меньше 1% — «≈ как обычно». */
export const fmtCompare = (c: { pct: number }, short = false) =>
  Math.abs(c.pct) < 1 ? '≈ как обычно' : `${c.pct > 0 ? '▲' : '▼'} ${Math.abs(Math.round(c.pct))}%${short ? '' : ' к среднему'}`

/** Строки под подходом: «темп 2:09/500 · 1,67 м/удар» и сравнение. Пусто — подход ещё не вписан. */
export function cardioLines(cur: Cardio, past: (Cardio & { date: string; set_no?: number })[]): string[] {
  const pace = pace500(cur)
  if (!pace) return []
  if (cur.hr == null) return [`темп ${pace} · без пульса — эффективность не считаем`]
  const e = efficiency(cur)
  if (e == null) return [`темп ${pace} · пульс вне 40–230 — эффективность не считаем`]
  const c = compare(cur, past)
  return [`темп ${pace} · ${fmtEff(e)} м/удар`, c ? `${fmtCompare(c)} (${c.n} трен.)` : 'не с чем сравнить']
}

/** Строка в ленте тренера: «Гребля 30:00 · 7000 м · пульс 140 · 1,67 м/уд ▲ 4%». */
export function cardioSummary(name: string, s: Cardio, past: (Cardio & { date: string; set_no?: number })[]): string | null {
  if (!cardioOk(s)) return null
  const e = efficiency(s)
  const c = compare(s, past)
  return [name, fmtTime(s.time_sec!), `${fmtNum(Number(s.meters))} м`, s.hr != null && `пульс ${s.hr}`,
    e != null && `${fmtEff(e)} м/уд${c ? ' ' + fmtCompare(c, true) : ''}`].filter(Boolean).join(' · ').replace(' · ', ' ')
}
