export type Exercise = {
  id: string
  name: string
  aliases: string[]
  muscles: string[]
  equipment: string | null
  image_url: string | null
  video_url: string | null
  source: 'base' | 'coach' | 'athlete'
}

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е')

/** Каждое слово запроса должно встретиться в названии или в других названиях: «жим лёжа» → «Жим штанги лёжа». */
export function searchExercises(list: Exercise[], query: string, muscle = '', equipment = ''): Exercise[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  return list.filter((e) => {
    if (muscle && !e.muscles.includes(muscle)) return false
    if (equipment && e.equipment !== equipment) return false
    const hay = norm([e.name, ...e.aliases].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

/** Ссылка на видео — только http(s), чтобы в href не попал javascript: и прочее. */
export function isVideoUrl(s: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol)
  } catch {
    return false
  }
}
