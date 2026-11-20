// Таймер комплекса. Всё считается от времени старта, а не тиками: заблокированный телефон время не сбивает.

export type TimerCfg = { kind: 'amrap' | 'emom' | 'fortime' | 'tabata'; minutes?: number; work?: number; rest?: number; rounds?: number }

export const TIMER_KINDS: [TimerCfg['kind'], string][] = [
  ['amrap', 'АМРАП'], ['emom', 'EMOM'], ['fortime', 'На время'], ['tabata', 'Табата'],
]

export const COUNTDOWN = 3  // «3-2-1» перед стартом

export type TimerState = {
  phase: 'countdown' | 'work' | 'rest' | 'done'
  round: number          // текущий раунд (EMOM — минута, табата — раунд)
  rounds: number         // всего раундов (0 — без раундов: АМРАП, на время)
  left: number           // секунд до конца фазы (на время — сколько прошло)
  elapsed: number        // секунд с начала работы
}

/** Состояние таймера через elapsedMs после нажатия «Старт» (включая отсчёт 3-2-1). */
export function timerState(cfg: TimerCfg, elapsedMs: number): TimerState {
  const t = elapsedMs / 1000 - COUNTDOWN
  if (t < 0) return { phase: 'countdown', round: 0, rounds: 0, left: Math.ceil(-t), elapsed: 0 }
  const minutes = cfg.minutes ?? 10
  if (cfg.kind === 'tabata') {
    const work = cfg.work ?? 20
    const rest = cfg.rest ?? 10
    const rounds = cfg.rounds ?? 8
    const cycle = work + rest
    if (t >= cycle * rounds) return { phase: 'done', round: rounds, rounds, left: 0, elapsed: cycle * rounds }
    const round = Math.floor(t / cycle) + 1
    const inCycle = t - (round - 1) * cycle
    return inCycle < work
      ? { phase: 'work', round, rounds, left: Math.ceil(work - inCycle), elapsed: t }
      : { phase: 'rest', round, rounds, left: Math.ceil(cycle - inCycle), elapsed: t }
  }
  const total = minutes * 60
  if (cfg.kind === 'fortime') {
    // на время: секундомер до лимита
    return t >= total ? { phase: 'done', round: 0, rounds: 0, left: total, elapsed: total } : { phase: 'work', round: 0, rounds: 0, left: Math.floor(t), elapsed: t }
  }
  if (t >= total) return { phase: 'done', round: minutes, rounds: cfg.kind === 'emom' ? minutes : 0, left: 0, elapsed: total }
  if (cfg.kind === 'emom') {
    const round = Math.floor(t / 60) + 1
    return { phase: 'work', round, rounds: minutes, left: Math.ceil(round * 60 - t), elapsed: t }
  }
  return { phase: 'work', round: 0, rounds: 0, left: Math.ceil(total - t), elapsed: t }
}

export const timerLabel = (c: TimerCfg) =>
  c.kind === 'tabata' ? `Табата ${c.work ?? 20}/${c.rest ?? 10} × ${c.rounds ?? 8}`
    : `${TIMER_KINDS.find(([k]) => k === c.kind)?.[1]} ${c.minutes ?? 10} мин`

/** Что звучит: старт и финиш — длинный сигнал, next — короткий на смене отрезка, остальное — голосом. */
export type Cue = 'start' | 'finish' | 'next' | 'half' | 'ten' | '5' | '4' | '3' | '2' | '1'

export type TimerSettings = {
  half: boolean; ten: boolean; count: boolean
  sound: 'voice' | 'beep' | 'off'
  volume: number  // 0..1
  vibrate: boolean
  view: 'under' | 'sheet'  // задание под цифрами / по кнопке
}
export const TIMER_DEFAULTS: TimerSettings = { half: true, ten: true, count: true, sound: 'voice', volume: 1, vibrate: true, view: 'under' }
const SETTINGS_KEY = 'timerSettings'
export function readTimerSettings(): TimerSettings {
  try { return { ...TIMER_DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } } catch { return TIMER_DEFAULTS }
}
export const saveTimerSettings = (s: TimerSettings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))

/** Отрезки работы: [начало, длина] в секундах от старта. АМРАП и «на время» — один отрезок на весь таймер. */
function segments(cfg: TimerCfg): [number, number][] {
  if (cfg.kind === 'tabata') {
    const work = cfg.work ?? 20
    const rest = cfg.rest ?? 10
    return Array.from({ length: cfg.rounds ?? 8 }, (_, i): [number, number][] => [[i * (work + rest), work], [i * (work + rest) + work, rest]]).flat()
      .filter(([, len]) => len > 0)
  }
  const total = (cfg.minutes ?? 10) * 60
  if (cfg.kind === 'emom') return Array.from({ length: total / 60 }, (_, i): [number, number] => [i * 60, 60])
  return [[0, total]]
}

/**
 * Сигналы таймера по секундам от старта (после «3-2-1»), по порядку.
 * Отрезок короче 30 с — только «5…1» перед сменой; 30 с и длиннее — «Половина», «10 секунд», «5…1» в каждом отрезке.
 */
export function timerCues(cfg: TimerCfg, s: Pick<TimerSettings, 'half' | 'ten' | 'count'> = TIMER_DEFAULTS): [number, Cue][] {
  const segs = segments(cfg)
  const end = segs.length ? segs[segs.length - 1][0] + segs[segs.length - 1][1] : 0
  const out: [number, Cue][] = [[0, 'start']]
  for (const [from, len] of segs) {
    const to = from + len
    if (len >= 30 && s.half) out.push([from + len / 2, 'half'])
    if (len >= 30 && s.ten) out.push([to - 10, 'ten'])
    if (s.count) for (let k = Math.min(5, len - 1); k >= 1; k--) out.push([to - k, String(k) as Cue])
    out.push([to, to === end ? 'finish' : 'next'])
  }
  return out.sort((a, b) => a[0] - b[0])
}
