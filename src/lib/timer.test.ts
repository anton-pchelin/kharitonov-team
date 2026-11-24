import { expect, it } from 'vitest'
import { createTimer, timerLabel } from './timer'

it.each([[360, 5], [180, 3]])('EMOM %i секунд × %i раундов', (intervalSec, rounds) => {
  const timer = createTimer({ kind: 'emom', intervalSec, rounds, prepSec: 0 })
  expect(timer.state(0)).toMatchObject({ phase: 'work', round: 1, left: intervalSec })
  expect(timer.state(intervalSec * 1000)).toMatchObject({ round: 2, left: intervalSec })
  expect(timer.state(intervalSec * rounds * 1000)).toMatchObject({ phase: 'done', elapsed: intervalSec * rounds })
  expect(timer.cues().at(-1)).toEqual([intervalSec * rounds, 'finish'])
})

it('свои интервалы повторяют неодинаковые отрезки с подготовкой', () => {
  const cfg = { kind: 'intervals', phases: [{ phase: 'work', seconds: 15 }, { phase: 'rest', seconds: 5 }, { phase: 'work', seconds: 30 }],
    rounds: 2, prepSec: 5 } as const
  const timer = createTimer({ ...cfg, phases: [...cfg.phases] })
  expect(timer.state(4000)).toMatchObject({ phase: 'countdown', left: 1 })
  expect(timer.state(20_000)).toMatchObject({ phase: 'rest', round: 1, left: 5 })
  expect(timer.state(55_000)).toMatchObject({ phase: 'work', round: 2, left: 15 })
  expect(timer.cues().at(-1)).toEqual([100, 'finish'])
})

it('табатой без отдыха можно связать блоки отдельной паузой', () => {
  const timer = createTimer({ kind: 'tabata', work: 20, rest: 0, rounds: 2, blocks: 2, breakSec: 27, prepSec: 0 })
  expect(timer.state(20_000)).toMatchObject({ phase: 'work', round: 2, block: 1 })
  expect(timer.state(40_000)).toMatchObject({ phase: 'rest', block: 1, left: 27 })
  expect(timer.state(67_000)).toMatchObject({ phase: 'work', round: 1, block: 2 })
  expect(timer.cues().at(-1)).toEqual([107, 'finish'])
})

it('АМРАП отсчитывает секунды каждого блока, секундомер с лимитом завершает отсчёт', () => {
  const amrap = createTimer({ kind: 'amrap', durationSec: 95, blocks: 2, breakSec: 20, prepSec: 0 })
  expect(amrap.state(95_000)).toMatchObject({ phase: 'rest', left: 20 })
  expect(amrap.state(115_000)).toMatchObject({ phase: 'work', block: 2, left: 95 })
  expect(amrap.state(210_000)).toMatchObject({ phase: 'done' })
  const capped = createTimer({ kind: 'fortime', capSec: 90, prepSec: 0 })
  expect(capped.state(90_100)).toMatchObject({ phase: 'done', elapsed: 90 })
})

it('секундомер без лимита продолжает считать, старые настройки сохраняют лимит', () => {
  const cfg = { kind: 'fortime', capSec: 0, prepSec: 0 } as const
  const free = createTimer(cfg)
  expect(free.state(900_000)).toMatchObject({ phase: 'work', elapsed: 900 })
  expect(free.cues()).toEqual([[0, 'start']])
  expect(timerLabel(cfg)).toContain('без лимита')
  expect(createTimer({ kind: 'fortime', minutes: 3 }).state(183_000)).toMatchObject({ phase: 'done', elapsed: 180 })
})
