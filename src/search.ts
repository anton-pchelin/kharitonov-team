import type { ResultType } from './lib/workout'

export type Exercise = {
  id: string
  name: string
  aliases: string[]
  muscles: string[]
  equipment: string | null
  image_url: string | null
  video_url: string | null
  source: 'base' | 'coach' | 'athlete'
  lower_is_better?: boolean
  default_result_type?: ResultType | null  // кардио-тренажёры — 'cardio'
}

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е').trim().replace(/\s+/g, ' ')

export const exactExercise = (list: Exercise[], name: string) => list.find((e) => norm(e.name) === norm(name))

/** Каждое слово запроса должно встретиться в названии или в других названиях: «жим лёжа» → «Жим штанги лёжа». */
export function searchExercises(list: Exercise[], query: string, muscle = '', equipment = ''): Exercise[] {
  const normalized = norm(query)
  const words = normalized.split(' ').filter(Boolean)
  return list.filter((e) => {
    if (muscle && !e.muscles.includes(muscle)) return false
    if (equipment && e.equipment !== equipment) return false
    const hay = norm([e.name, ...e.aliases].join(' '))
    return words.every((w) => hay.includes(w))
  }).sort((a, b) => Number(norm(b.name) === normalized) - Number(norm(a.name) === normalized))
}

/** Ссылка на видео — только http(s), чтобы в href не попал javascript: и прочее. */
export function isVideoUrl(s: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol)
  } catch {
    return false
  }
}
