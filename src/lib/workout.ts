export type ResultType = 'weight_reps' | 'reps' | 'weight' | 'time' | 'meters' | 'calories' | 'rounds' | 'check'

export const RESULT_TYPES: [ResultType, string][] = [
  ['weight_reps', 'кг + повторения'],
  ['reps', 'повторения'],
  ['weight', 'кг'],
  ['time', 'время'],
  ['meters', 'метры'],
  ['calories', 'калории'],
  ['rounds', 'круги'],
  ['check', 'галочка'],
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
