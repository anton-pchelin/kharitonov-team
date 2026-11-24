// Длительность и сигналы считаются от времени старта, а не тиками.
export type TimerCfg = {
  kind: 'amrap' | 'emom' | 'fortime' | 'tabata' | 'intervals'
  minutes?: number // прежний формат
  work?: number; rest?: number; rounds?: number
  intervalSec?: number; durationSec?: number; capSec?: number; prepSec?: number
  blocks?: number; breakSec?: number
  phases?: { phase: 'work' | 'rest'; seconds: number }[]
}

export const TIMER_KINDS: [TimerCfg['kind'], string][] = [
  ['amrap', 'АМРАП'], ['emom', 'EMOM'], ['fortime', 'На время'], ['tabata', 'Табата'], ['intervals', 'Свои интервалы'],
]

const whole = (value: number | undefined, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

export const prepSeconds = (c: TimerCfg) => whole(c.prepSec, 3, 0, 60)
export const emomSeconds = (c: TimerCfg) => whole(c.intervalSec, 60, 1, 3600)
export const roundCount = (c: TimerCfg) =>
  whole(c.rounds, c.kind === 'emom' ? whole(c.minutes, 10, 1, 100) : c.kind === 'tabata' ? 8 : 1, 1, 100)
export const blockCount = (c: TimerCfg) => whole(c.blocks, 1, 1, 20)
export const blockRest = (c: TimerCfg) => whole(c.breakSec, 60, 0, 3600)
export const timeLimit = (c: TimerCfg) =>
  whole(c.kind === 'fortime' ? c.capSec : c.durationSec, whole(c.minutes, 10, 1, 180) * 60, c.kind === 'fortime' ? 0 : 1, 10800)
export const workSeconds = (c: TimerCfg) => whole(c.work, 20, 1, 3600)
export const restSeconds = (c: TimerCfg) => whole(c.rest, 10, 0, 3600)
export const customPhases = (c: TimerCfg): NonNullable<TimerCfg['phases']> => c.phases?.length
  ? c.phases.slice(0, 20).map((p) => ({ phase: p.phase === 'rest' ? 'rest' : 'work', seconds: whole(p.seconds, 30, 1, 3600) }))
  : [{ phase: 'work', seconds: 30 }, { phase: 'rest', seconds: 15 }]

export const defaultTimer = (kind: TimerCfg['kind']): TimerCfg => kind === 'fortime' ? { kind, capSec: 0 } : { kind }

export type TimerState = {
  phase: 'countdown' | 'work' | 'rest' | 'done'
  round: number
  rounds: number
  block?: number
  blocks?: number
  left: number
  elapsed: number
}

type Phase = { phase: 'work' | 'rest'; from: number; seconds: number; round: number; block: number }

/** Расписание общее для экрана и звуковых сигналов. */
export function createTimer(cfg: TimerCfg) {
  const rounds = cfg.kind === 'amrap' || cfg.kind === 'fortime' ? 0 : roundCount(cfg)
  const blocks = cfg.kind === 'fortime' || cfg.kind === 'intervals' ? 1 : blockCount(cfg)
  const prep = prepSeconds(cfg)
  let end = 0
  const phases: Phase[] = []
  const push = (phase: Phase['phase'], seconds: number, block: number, round: number) => {
    if (!seconds) return
    phases.push({ phase, from: end, seconds, round, block })
    end += seconds
  }
  const custom = cfg.kind === 'intervals' ? customPhases(cfg) : []
  for (let block = 1; block <= blocks; block++) {
    if (!rounds) push('work', timeLimit(cfg), block, 0)
    for (let round = 1; round <= rounds; round++) {
      if (cfg.kind === 'emom') push('work', emomSeconds(cfg), block, round)
      if (cfg.kind === 'tabata') {
        push('work', workSeconds(cfg), block, round)
        push('rest', restSeconds(cfg), block, round)
      }
      for (const p of custom) push(p.phase, p.seconds, block, round)
    }
    if (block < blocks) push('rest', blockRest(cfg), block, 0)
  }
  const state = (elapsedMs: number): TimerState => {
    const t = Math.max(0, elapsedMs) / 1000 - prep
    if (t < 0) return { phase: 'countdown', round: 0, rounds: 0, left: Math.ceil(-t), elapsed: 0 }
    if (!end) return { phase: 'work', round: 0, rounds: 0, left: Math.floor(t), elapsed: t }
    if (t >= end) return { phase: 'done', round: rounds, rounds, block: blocks, blocks, left: cfg.kind === 'fortime' ? end : 0, elapsed: end }
    const p = phases.find((p) => t < p.from + p.seconds)!
    const left = cfg.kind === 'fortime' ? Math.floor(t) : Math.ceil(p.from + p.seconds - t)
    return { phase: p.phase, round: p.round, rounds, block: p.block, blocks, left, elapsed: t }
  }
  const cues = (s: Pick<TimerSettings, 'half' | 'ten' | 'count'> = TIMER_DEFAULTS): [number, Cue][] => {
    const out: [number, Cue][] = [[0, 'start']]
    for (const { from, seconds } of phases) {
      const to = from + seconds
      if (seconds >= 30 && s.half) out.push([from + seconds / 2, 'half'])
      if (seconds >= 30 && s.ten) out.push([to - 10, 'ten'])
      if (s.count) for (let k = Math.min(5, seconds - 1); k >= 1; k--) out.push([to - k, String(k) as Cue])
      out.push([to, to === end ? 'finish' : 'next'])
    }
    return out
  }
  return { state, cues }
}

export const timerState = (cfg: TimerCfg, ms: number) => createTimer(cfg).state(ms)
export const timerCues = (cfg: TimerCfg, settings?: Pick<TimerSettings, 'half' | 'ten' | 'count'>) => createTimer(cfg).cues(settings)

export function timerLabel(c: TimerCfg) {
  const time = (secs: number) => Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0')
  const blocks = c.kind !== 'fortime' && c.kind !== 'intervals' && blockCount(c) > 1 ? ' · блоков ' + blockCount(c) : ''
  switch (c.kind) {
    case 'emom': return 'EMOM ' + time(emomSeconds(c)) + ' × ' + roundCount(c) + blocks
    case 'tabata': return 'Табата ' + workSeconds(c) + '/' + restSeconds(c) + ' × ' + roundCount(c) + blocks
    case 'amrap': return 'АМРАП ' + time(timeLimit(c)) + blocks
    case 'fortime': return 'На время' + (timeLimit(c) ? ' · лимит ' + time(timeLimit(c)) : ' · без лимита')
    case 'intervals': return 'Свои интервалы · ' + customPhases(c).length + ' отрезков × ' + roundCount(c)
  }
}

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
