import type { TimerCfg } from './timer'

export type ResultType = 'weight_reps' | 'reps' | 'weight' | 'time' | 'meters' | 'calories' | 'rounds' | 'check' | 'cardio'

export const RESULT_TYPES: [ResultType, string][] = [
  ['weight_reps', 'кг + повторения'],
  ['reps', 'повторения'],
  ['weight', 'кг'],
  ['time', 'время'],
  ['meters', 'метры'],
  ['calories', 'калории'],
  ['rounds', 'круги'],
  ['check', 'галочка'],
  ['cardio', 'кардио (время, метры, пульс)'],
]
export const resultLabel = (t: ResultType) => RESULT_TYPES.find(([k]) => k === t)?.[1] ?? t

export type WorkoutItem = {
  id: string
  workout_id?: string
  position: number
  exercise_id: string | null
  name: string
  plan_text: string
  video_url: string | null
  result_type: ResultType
  planned_sets: number
  superset: number | null
  block_note: string
  self?: boolean
  pct?: number | null  // % от 1ПМ этого упражнения
  timer?: TimerCfg | null  // таймер комплекса (АМРАП, EMOM, на время, табата)
}

export type Workout = {
  id: string
  athlete_id: string
  date: string
  title: string
  prescription: string
  published: boolean
  self: boolean
  completed_at: string | null
  workout_items?: WorkoutItem[]
}

/** Результат комплекса: на время, АМРАП (круги) или галочка. */
export const COMPLEX_RESULTS: [ResultType, string][] = [['time', 'На время'], ['rounds', 'АМРАП'], ['check', 'Галочка']]

// shortcut: комплекс — задание с названием «Комплекс · N раундов» без упражнения, отдельного столбца в базе нет;
// если понадобится больше свойств комплекса — завести столбец миграцией
export const isComplex = (i: { name: string; exercise_id: string | null }) => !i.exercise_id && /^Комплекс( ·|$)/.test(i.name)
export const complexRounds = (name: string) => Number(name.match(/· (\d+)/)?.[1]) || null
export function complexName(rounds: number | null) {
  if (!rounds) return 'Комплекс'
  const n10 = rounds % 10, n100 = rounds % 100
  const word = n10 === 1 && n100 !== 11 ? 'раунд' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'раунда' : 'раундов'
  return `Комплекс · ${rounds} ${word}`
}

const LETTERS = 'АБВГДЕЖЗИК'

/** Номера заданий: соседние с одинаковым superset — один номер с буквами (3А, 3Б). */
export function itemLabels(items: Pick<WorkoutItem, 'superset'>[]): string[] {
  const out: string[] = []
  let n = 0
  let letter = 0
  items.forEach((it, i) => {
    const prev = items[i - 1]
    const next = items[i + 1]
    const inGroup = it.superset != null && (prev?.superset === it.superset || next?.superset === it.superset)
    if (inGroup && prev?.superset === it.superset) letter++
    else { n++; letter = 0 }
    out.push(inGroup ? `${n}${LETTERS[letter] ?? letter + 1}` : String(n))
  })
  return out
}

/** Первое задание суперсета — на нём хранится подпись блока. */
export const isGroupStart = (items: Pick<WorkoutItem, 'superset'>[], i: number) =>
  items[i].superset != null && items[i - 1]?.superset !== items[i].superset && items[i + 1]?.superset === items[i].superset

/** Задания другой тренировки — в конец: новые id, номера суперсетов после уже занятых, чтобы 3А/3Б не слились. */
export function appendItems(items: WorkoutItem[], added: WorkoutItem[]): WorkoutItem[] {
  const shift = Math.max(0, ...items.map((i) => i.superset ?? 0))
  const extra = added.filter((i) => !i.self).sort((a, b) => a.position - b.position)
    .map(({ workout_id: _w, self: _s, ...i }, k) => ({
      ...i, id: crypto.randomUUID(), position: items.length + k, superset: i.superset == null ? null : i.superset + shift,
    }))
  return [...items, ...extra]
}
