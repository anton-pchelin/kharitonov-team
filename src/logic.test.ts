import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mix, PALETTES, themeVars } from './theme'
import { isVideoUrl, searchExercises, type Exercise } from './search'

describe('тема', () => {
  it('смешивает цвета по правилу из ПЛАН.md', () => {
    expect(mix('#FFD43B', 0.28, '#FFFFFF')).toBe('#FFF3C8')
    expect(mix('#000000', 0.5, '#FFFFFF')).toBe('#808080')
  })
  it('у всех 16 палитр есть светлая и тёмная тема', () => {
    expect(Object.keys(PALETTES)).toHaveLength(16)
    for (const name of Object.keys(PALETTES)) {
      for (const v of Object.values(themeVars(name, true))) expect(v).toMatch(/^#[0-9A-F]{6}$/)
    }
    expect(themeVars('Лаванда', true)['--bg']).toBe(mix('#3A3358', 0.28, '#000000'))
  })
})

describe('поиск упражнений', () => {
  // настоящие русские названия из data/exercises-ru.txt
  const list: Exercise[] = readFileSync('data/exercises-ru.txt', 'utf8').split('\n').filter(Boolean)
    .map((l, i) => {
      const [en, ru] = l.split(' | ')
      return { id: String(i), name: ru.trim(), aliases: [en], muscles: [], equipment: null, image_url: null, video_url: null, source: 'base' }
    })
  const names = (q: string) => searchExercises(list, q).map((e) => e.name)

  it('«присед» — не меньше 10 приседаний', () => {
    expect(names('присед').length).toBeGreaterThanOrEqual(10)
  })
  it('«жим лёжа» и «жим лежа» находят жим штанги лёжа', () => {
    expect(names('жим лёжа')).toContain('Жим штанги лёжа средним хватом')
    expect(names('жим лежа')).toContain('Жим штанги лёжа средним хватом')
  })
  it('ищет и по английскому названию', () => {
    expect(names('barbell full squat')).toEqual(['Глубокое приседание со штангой'])
  })
  it('пропускает только http(s)-ссылки на видео', () => {
    expect(isVideoUrl('https://rutube.ru/video/1/')).toBe(true)
    expect(isVideoUrl('javascript:alert(1)')).toBe(false)
    expect(isVideoUrl('просто текст')).toBe(false)
  })
})
