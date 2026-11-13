/**
 * Какие блины повесить на каждую сторону, чтобы на грифе был нужный вес.
 * Не собирается точно — ближайший меньший вес и разница. Блинов каждого вида сколько угодно (парами).
 */
export function platesFor(total: number, bar: number, plates: number[]): { perSide: number[]; got: number; diff: number } {
  const unit = 0.05  // считаем в «копейках» по 50 г — так 1,25 и 2,5 без ошибок округления
  const target = Math.max(0, Math.floor(((total - bar) / 2) / unit + 1e-9))
  const sizes = [...new Set(plates.filter((p) => p > 0))].sort((a, b) => b - a).map((p) => Math.round(p / unit))
  // best[s] — наименьшее число блинов, чтобы набрать ровно s; from[s] — последний блин
  const best = new Array<number>(target + 1).fill(Infinity)
  const from = new Array<number>(target + 1).fill(0)
  best[0] = 0
  for (let s = 1; s <= target; s++) {
    for (const p of sizes) {
      if (p <= s && best[s - p] + 1 < best[s]) { best[s] = best[s - p] + 1; from[s] = p }
    }
  }
  let s = target
  while (s > 0 && best[s] === Infinity) s--
  const perSide: number[] = []
  for (let k = s; k > 0; k -= from[k]) perSide.push(Math.round(from[k] * unit * 100) / 100)
  perSide.sort((a, b) => b - a)
  const got = Math.round((bar + 2 * s * unit) * 100) / 100
  return { perSide, got, diff: Math.round((total - got) * 100) / 100 }
}
