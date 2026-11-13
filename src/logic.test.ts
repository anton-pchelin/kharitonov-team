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

describe('конструктор тренировки', async () => {
  const { itemLabels } = await import('./lib/workout')
  const { embedUrl } = await import('./lib/video')
  const { addDays, mondayOf } = await import('./lib/dates')

  it('нумерует суперсет буквами: 1, 2А, 2Б, 3', () => {
    expect(itemLabels([{ superset: null }, { superset: 1 }, { superset: 1 }, { superset: null }])).toEqual(['1', '2А', '2Б', '3'])
    // одиночное задание с меткой суперсета — обычный номер
    expect(itemLabels([{ superset: 1 }, { superset: null }, { superset: 2 }, { superset: 2 }, { superset: 2 }])).toEqual(['1', '2', '3А', '3Б', '3В'])
  })
  it('узнаёт ссылки на видео для плеера', () => {
    expect(embedUrl('https://rutube.ru/video/abc123def/')).toBe('https://rutube.ru/play/embed/abc123def')
    expect(embedUrl('https://vk.com/video-12345_678')).toBe('https://vk.com/video_ext.php?oid=-12345&id=678')
    expect(embedUrl('https://vkvideo.ru/video-1_2')).toBe('https://vk.com/video_ext.php?oid=-1&id=2')
    expect(embedUrl('https://youtu.be/xyz')).toBe('https://www.youtube.com/embed/xyz')
    expect(embedUrl('https://www.youtube.com/watch?v=xyz&t=1')).toBe('https://www.youtube.com/embed/xyz')
    expect(embedUrl('https://example.com/video.mp4')).toBeNull()
  })
  it('считает недели с понедельника', () => {
    expect(mondayOf('2026-11-15')).toBe('2026-11-09')
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })
})
