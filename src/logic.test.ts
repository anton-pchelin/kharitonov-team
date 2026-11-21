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
  it('вставка из другой тренировки продолжает номера, суперсеты не сливаются', async () => {
    const { appendItems } = await import('./lib/workout')
    const mk = (id: string, superset: number | null, self = false) => ({ id, position: 0, exercise_id: null, name: id, plan_text: '', video_url: null, result_type: 'reps' as const, planned_sets: 1, superset, block_note: '', self })
    const mine = [mk('a', null), mk('b', 1), mk('c', 1)]
    const other = [mk('d', 1), mk('e', 1), mk('f', null), mk('сам', null, true)]
    const all = appendItems(mine, other)
    expect(itemLabels(all)).toEqual(['1', '2А', '2Б', '3А', '3Б', '4'])
    expect(all.map((i) => i.position)).toEqual([0, 0, 0, 3, 4, 5])
    expect(all.slice(3).every((i) => !['d', 'e', 'f'].includes(i.id))).toBe(true)  // новые id
  })
  it('считает недели с понедельника', () => {
    expect(mondayOf('2026-11-15')).toBe('2026-11-09')
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })
})

describe('без интернета', async () => {
  const { applyLocal, previousSets } = await import('./lib/offline')
  const { parseNum, parseTime, fmtTime } = await import('./lib/format')
  const base = { workouts: [{ id: 'w', athlete_id: 'a', date: '2026-11-09', title: '', prescription: '', published: true, self: false, completed_at: null, workout_items: [] }], results: [], comments: [], history: [], syncedAt: null }

  it('повторный ввод подхода заменяет, а не дублирует', () => {
    let c = applyLocal(base, { t: 'set', row: { item_id: 'i', set_no: 1, weight: 40, done: false } })
    c = applyLocal(c, { t: 'set', row: { item_id: 'i', set_no: 1, weight: 45, done: true } })
    expect(c.results).toEqual([{ item_id: 'i', set_no: 1, weight: 45, done: true }])
    expect(applyLocal(c, { t: 'unset', item_id: 'i', set_no: 1 }).results).toEqual([])
  })
  it('своё упражнение и завершение видны сразу', () => {
    const item = { id: 'x', workout_id: 'w', position: 1000, exercise_id: null, name: 'Бицепс', plan_text: '', video_url: null, result_type: 'weight_reps' as const, planned_sets: 3, superset: null, block_note: '', self: true }
    let c = applyLocal(base, { t: 'item', row: item })
    c = applyLocal(c, { t: 'item', row: item })  // повтор из очереди не дублирует
    c = applyLocal(c, { t: 'complete', id: 'w', at: '2026-11-09T10:00:00Z' })
    expect(c.workouts[0].workout_items).toHaveLength(1)
    expect(c.workouts[0].completed_at).toBe('2026-11-09T10:00:00Z')
  })
  it('удаление своей тренировки и своего задания убирает и подходы', () => {
    const item = { id: 'x', workout_id: 'w', position: 1000, exercise_id: null, name: 'Бицепс', plan_text: '', video_url: null, result_type: 'weight_reps' as const, planned_sets: 3, superset: null, block_note: '', self: true }
    let c = applyLocal(base, { t: 'item', row: item })
    c = applyLocal(c, { t: 'set', row: { item_id: 'x', set_no: 1, weight: 10, done: true } })
    const noItem = applyLocal(c, { t: 'delete_item', id: 'x', workout_id: 'w' })
    expect(noItem.workouts[0].workout_items).toEqual([])
    expect(noItem.results).toEqual([])
    const noWorkout = applyLocal(c, { t: 'delete_workout', id: 'w' })
    expect(noWorkout.workouts).toEqual([])
    expect(noWorkout.results).toEqual([])
  })
  it('«прошлый раз» — последняя более ранняя тренировка с тем же упражнением', () => {
    const h = (date: string, set_no: number, weight: number) => ({ item_id: date, set_no, weight, reps: 10, done: true, date, name: 'Присед', exercise_id: 'sq' })
    const hist = [h('2026-11-02', 1, 35), h('2026-11-09', 1, 40), h('2026-11-09', 2, 45), h('2026-11-16', 1, 50)]
    expect(previousSets(hist, { name: 'Присед', exercise_id: 'sq' }, '2026-11-16').map((s) => s.weight)).toEqual([40, 45])
    expect(previousSets(hist, { name: 'присед', exercise_id: null }, '2026-11-03').map((s) => s.weight)).toEqual([35])
  })
  it('понимает запятую и время', () => {
    expect(parseNum('72,5')).toBe(72.5)
    expect(parseNum('abc')).toBeNull()
    expect(parseTime('28:30')).toBe(1710)
    expect(fmtTime(1710)).toBe('28:30')
    expect(fmtTime(3723)).toBe('1:02:03')
  })
})

describe('прогресс', async () => {
  const { epley, records, weightSeries, isRecordSet, weeklyStats } = await import('./lib/progress')
  const s = (date: string, weight: number, reps: number) => ({ item_id: date, set_no: 1, weight, reps, done: true, date, name: 'Присед', exercise_id: 'sq' })
  const squats = [s('2026-11-02', 40, 10), s('2026-11-09', 45, 10), s('2026-11-16', 50, 10)]

  it('три приседа 40/45/50 × 10: рост, рекорд 50×10, 1ПМ ≈ 66,7', () => {
    expect(weightSeries(squats).best.map((p) => p.y)).toEqual([40, 45, 50])
    const r = records(squats)
    expect(r.byReps.find((b) => b.reps === 10)?.weight).toBe(50)
    expect(r.e1rm).toBe(66.7)
    expect(epley(50, 1)).toBe(50)
  })
  it('🏆 — только если 1ПМ выше всех прошлых', () => {
    expect(isRecordSet(50, 10, squats.slice(0, 2))).toBe(true)
    expect(isRecordSet(40, 10, squats.slice(0, 2))).toBe(false)
    expect(isRecordSet(40, 10, [])).toBe(false)
  })
  it('тоннаж по неделям', () => {
    expect(weeklyStats(squats).map((w) => w.tonnage)).toEqual([400, 450, 500])
  })
})

describe('% от максимума', async () => {
  const { maxFor, pctWeight } = await import('./lib/progress')
  it('70% от 1ПМ 100 кг — 70 кг; от 80 — 56; округление до 2,5', () => {
    expect(pctWeight(70, 100)).toBe(70)
    expect(pctWeight(70, 80)).toBe(55)  // 56 → ближайшее кратное 2,5
    expect(pctWeight(65, 100)).toBe(65)
  })
  it('максимум берётся из рекорда вручную и из истории', () => {
    const item = { exercise_id: 'dl', name: 'Становая' }
    expect(maxFor(item, [], [{ exercise_id: 'dl', name: 'Становая', weight: 100, reps: 1 }])).toBe(100)
    expect(maxFor(item, [], [])).toBeNull()
  })
})

describe('в зале', async () => {
  const { platesFor } = await import('./lib/plates')
  const { timerState } = await import('./lib/timer')
  const set = [25, 20, 15, 10, 5, 2.5, 1.25]

  it('72,5 кг на гриф 20 — «25 + 1,25» на сторону', () => {
    expect(platesFor(72.5, 20, set)).toEqual({ perSide: [25, 1.25], got: 72.5, diff: 0 })
    expect(platesFor(100, 20, set).perSide).toEqual([25, 15])
  })
  it('не собирается точно — ближайший меньший и разница', () => {
    expect(platesFor(73, 20, set)).toEqual({ perSide: [25, 1.25], got: 72.5, diff: 0.5 })
    expect(platesFor(15, 20, set)).toEqual({ perSide: [], got: 20, diff: -5 })
  })
  it('табата: 8 раундов 20/10, время от старта, а не тиками', () => {
    const tab = { kind: 'tabata' as const }
    expect(timerState(tab, 1000).phase).toBe('countdown')
    expect(timerState(tab, 3000 + 5000)).toMatchObject({ phase: 'work', round: 1, left: 15 })
    expect(timerState(tab, 3000 + 25000)).toMatchObject({ phase: 'rest', round: 1, left: 5 })
    // «заблокировали» на 30 с посреди 3-го раунда — состояние то же, что и без блокировки
    expect(timerState(tab, 3000 + 65000)).toMatchObject({ phase: 'work', round: 3, left: 15 })
    expect(timerState(tab, 3000 + 240000).phase).toBe('done')
  })
  it('АМРАП 12 и EMOM 10', () => {
    expect(timerState({ kind: 'amrap', minutes: 12 }, 3000 + 60000)).toMatchObject({ phase: 'work', left: 660 })
    expect(timerState({ kind: 'amrap', minutes: 12 }, 3000 + 720000).phase).toBe('done')
    expect(timerState({ kind: 'emom', minutes: 10 }, 3000 + 125000)).toMatchObject({ round: 3, left: 55 })
  })
})

it('подбор веса и повторов под прошлый подход', async () => {
  const { matchSet } = await import('./lib/progress')
  const prev = { weight: 100, reps: 5 }  // 1ПМ ≈ 116,7
  expect(matchSet(prev, { reps: 5 })).toEqual({ weight: 100 })
  expect(matchSet(prev, { reps: 8 })).toEqual({ weight: 92.5 })
  expect(matchSet(prev, { reps: 1 })).toEqual({ weight: 117.5 })
  expect(matchSet(prev, { weight: 90 })).toEqual({ reps: 9 })
  expect(matchSet(prev, { weight: 90, reps: 3 })).toEqual({})
  expect(matchSet({ weight: null, reps: 10 }, { reps: 5 })).toEqual({})
})

describe('доступ по оплате', async () => {
  const { extendAccess, addMonth } = await import('./lib/dates')
  it('+1 мес от даты окончания, а прошедший или пустой срок — от сегодня', () => {
    expect(extendAccess('2026-12-20', '2026-12-15')).toBe('2027-01-20')
    expect(extendAccess('2026-12-20', '2026-12-20')).toBe('2027-01-20')
    expect(extendAccess('2026-12-20', '2026-12-25')).toBe('2027-01-25')
    expect(extendAccess(null, '2026-11-20')).toBe('2026-12-20')
    expect(addMonth('2027-01-31')).toBe('2027-02-28')
  })
})

describe('сигналы таймера', async () => {
  const { timerCues } = await import('./lib/timer')
  const at = (cues: [number, string][], from: number, to: number) => cues.filter(([t]) => t >= from && t < to)

  it('табата 20/10 × 8: только 5…1 в каждом отрезке, старт и финиш', () => {
    const c = timerCues({ kind: 'tabata', work: 20, rest: 10, rounds: 8 })
    expect(c[0]).toEqual([0, 'start'])
    expect(c[c.length - 1]).toEqual([240, 'finish'])
    expect(c.some(([, q]) => q === 'half' || q === 'ten')).toBe(false)
    expect(at(c, 1, 30)).toEqual([[15, '5'], [16, '4'], [17, '3'], [18, '2'], [19, '1'], [20, 'next'], [25, '5'], [26, '4'], [27, '3'], [28, '2'], [29, '1']])
    expect(c.filter(([, q]) => q === '1')).toHaveLength(16)
  })
  it('EMOM 12 мин: в каждой минуте «Половина» на 30-й, «10 секунд», 5…1', () => {
    const c = timerCues({ kind: 'emom', minutes: 12 })
    expect(at(c, 1, 60)).toEqual([[30, 'half'], [50, 'ten'], [55, '5'], [56, '4'], [57, '3'], [58, '2'], [59, '1']])
    expect(c.filter(([, q]) => q === 'half').map(([t]) => t)).toEqual(Array.from({ length: 12 }, (_, i) => i * 60 + 30))
    expect(c[c.length - 1]).toEqual([720, 'finish'])
  })
  it('АМРАП 12 мин: «Половина» на 6:00, «10 секунд» и 5…1 перед концом', () => {
    expect(timerCues({ kind: 'amrap', minutes: 12 })).toEqual([[0, 'start'], [360, 'half'], [710, 'ten'],
      [715, '5'], [716, '4'], [717, '3'], [718, '2'], [719, '1'], [720, 'finish']])
  })
  it('«на время» с лимитом 10 мин — от лимита; выключенные сигналы не звучат', () => {
    expect(timerCues({ kind: 'fortime', minutes: 10 }).filter(([, q]) => q === 'half')).toEqual([[300, 'half']])
    expect(timerCues({ kind: 'amrap', minutes: 12 }, { half: false, ten: true, count: false })).toEqual([[0, 'start'], [710, 'ten'], [720, 'finish']])
  })
})

describe('кардио', async () => {
  const { cardioLines, cardioSummary, compare, efficiency, lsq, pace500, paceSeries, personalNorm } = await import('./lib/cardio')
  const row = (date: string, time_sec: number, meters: number, hr: number | null) => ({ date, time_sec, meters, hr })
  const d1 = row('2026-11-14', 1800, 7000, 140)
  const d2 = row('2026-11-21', 3600, 13500, 140)

  it('пример из задания: 30:00 · 7000 м · 140 и 60:00 · 13 500 м · 140', () => {
    expect(cardioLines(d1, [])).toEqual(['темп 2:09/500 · 1,67 м/удар', 'не с чем сравнить'])
    // 30 и 60 минут не сравниваем: на длинной пульс сам ползёт вверх
    expect(cardioLines(d2, [d1])).toEqual(['темп 2:13/500 · 1,61 м/удар', 'не с чем сравнить'])
    expect(cardioLines(row('2026-11-21', 1800, 6720, 140), [d1])).toEqual(['темп 2:14/500 · 1,60 м/удар', '▼ 4% к среднему (1 трен.)'])
  })
  it('настоящие тренировки: гребля 30:05 · 6643 · 145, байк 30:08 · 10 710 · 143', () => {
    expect(cardioLines(row('2026-11-19', 1805, 6643, 145), [])).toEqual(['темп 2:16/500 · 1,52 м/удар', 'не с чем сравнить'])
    expect(cardioLines(row('2026-11-20', 1808, 10710, 143), [])).toEqual(['темп 1:24/500 · 2,49 м/удар', 'не с чем сравнить'])
  })
  it('без пульса — темп есть, эффективности нет, в среднее не попадает', () => {
    const noHr = row('2026-11-20', 1800, 9000, null)
    expect(cardioLines(noHr, [])).toEqual(['темп 1:40/500 · без пульса — эффективность не считаем'])
    expect(compare(row('2026-11-21', 1800, 7100, 140), [noHr, d1])?.n).toBe(1)
  })
  it('ступень 1: в среднее — только пульс ±10 и длительность ±30%, не больше 4 последних', () => {
    const cur = row('2026-11-21', 1800, 7000, 140)
    expect(compare(cur, [row('2026-11-15', 1800, 9000, 160)])).toBeNull()
    expect(compare(cur, [row('2026-11-15', 2100, 9000, 150), d1])?.n).toBe(2)
    expect(compare(cur, [row('2026-11-15', 2400, 9000, 140)])).toBeNull()  // 40 мин к 30 — уже не похоже
    const many = ['01', '02', '03', '04', '05'].map((d) => row('2026-11-' + d, 1800, 7000, 140))
    expect(compare(cur, many)).toMatchObject({ n: 4, level: 1 })
  })
  // модель «как у живого человека»: на пульс +10 — на 0,2 м/с быстрее, каждые 10 минут — на 0,05 м/с медленнее
  const model = (hr: number, min: number) => 3 + 0.02 * (hr - 120) - 0.005 * (min - 30)
  const day = (k: number) => '2026-10-' + String(k + 1).padStart(2, '0')
  const on = (k: number, hr: number, min: number, factor = 1) => row(day(k), min * 60, Math.round(model(hr, min) * min * 60 * factor), hr)
  it('метод наименьших квадратов', () => {
    expect(lsq([[1, 1], [1, 2], [1, 3]], [3, 5, 7])!.map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 2])
    expect(lsq([[1, 1], [1, 1]], [1, 2])).toBeNull()
  })
  it('ступень 2: от 6 тренировок на разном пульсе — сравнение с личной нормой на этом пульсе', () => {
    const past = [125, 130, 135, 140, 150, 160].map((hr, k) => on(k, hr, 30))
    expect(personalNorm(past.slice(0, 5))).toBeNull()  // 5 — мало, работает ступень 1
    expect(personalNorm(past)?.level).toBe(2)
    const c = compare(on(20, 155, 30, 1.05), past)!
    expect(c.level).toBe(2)
    expect(Math.round(c.pct)).toBe(5)
    expect(cardioLines(on(20, 155, 30, 1.05), past)[1]).toBe('▲ 5% к норме на пульсе 155: обычно 2:15/500 (6 трен.)')
    // пульс далеко за краем нормы — назад к ступени 1
    expect(compare(on(20, 175, 30), past)?.level ?? 1).toBe(1)
    // все на одном пульсе — норму не построить
    expect(personalNorm([0, 1, 2, 3, 4, 5].map((k) => on(k, 140, 30)))).toBeNull()
  })
  it('ступень 3: от 12 тренировок разной длительности — учитывается и длительность', () => {
    const past = Array.from({ length: 12 }, (_, k) => on(k, 125 + (k % 4) * 10, [20, 30, 45, 60][(k * 3) % 4]))
    expect(personalNorm(past)?.level).toBe(3)
    const c = compare(on(20, 140, 60), past)!
    expect(c.level).toBe(3)
    expect(Math.abs(c.pct)).toBeLessThan(0.5)  // ровно по норме — «как обычно», хоть и 60 минут
    expect(cardioLines(on(20, 140, 60), past)[1]).toMatch(/^≈ как обычно на пульсе 140 за 60 мин: обычно/)
  })
  it('график «Темп на пульсе»: тренировки на разном пульсе по норме ложатся в одну линию', () => {
    const past = [125, 130, 135, 140, 150, 160].map((hr, k) => on(k, hr, 30))
    const s = paceSeries(past)
    expect(s.label).toBe('Темп на пульсе 140 (меньше — лучше)')
    expect(new Set(s.points.map((p) => p.y)).size).toBe(1)
    expect(paceSeries(past.slice(0, 2)).label).toBe('Темп на 500 м (меньше — лучше)')
  })
  it('разница меньше 1% — «≈ как обычно»', () => {
    expect(cardioLines(row('2026-11-21', 1800, 7030, 140), [d1])[1]).toBe('≈ как обычно (1 трен.)')
  })
  it('строка в ленте тренера', () => {
    expect(cardioSummary('Гребля', d1, [])).toBe('Гребля 30:00 · 7000 м · пульс 140 · 1,67 м/уд')
    expect(cardioSummary('Гребля', row('2026-11-21', 1800, 6720, 140), [d1])).toBe('Гребля 30:00 · 6720 м · пульс 140 · 1,60 м/уд ▼ 4%')
    expect(cardioSummary('Гребля', row('2026-11-21', 1800, 7000, null), [])).toBe('Гребля 30:00 · 7000 м')
  })
  it('ерунда в числах — эффективность не считаем', () => {
    expect(efficiency(row('2026-11-21', 1800, 7000, 30))).toBeNull()
    expect(efficiency(row('2026-11-21', 0, 7000, 140))).toBeNull()
    expect(pace500(row('2026-11-21', 1800, 0, 140))).toBeNull()
  })
})

describe('комплекс', () => {
  it('название из числа раундов и обратно', async () => {
    const { complexName, complexRounds, isComplex } = await import('./lib/workout')
    expect([1, 2, 5, 11, 21, 22, 112].map(complexName)).toEqual(['Комплекс · 1 раунд', 'Комплекс · 2 раунда', 'Комплекс · 5 раундов',
      'Комплекс · 11 раундов', 'Комплекс · 21 раунд', 'Комплекс · 22 раунда', 'Комплекс · 112 раундов'])
    expect(complexName(null)).toBe('Комплекс')
    expect(complexRounds('Комплекс · 7 раундов')).toBe(7)
    expect(complexRounds('Комплекс')).toBeNull()
    expect(isComplex({ name: 'Комплекс · 3 раунда', exercise_id: null })).toBe(true)
    expect(isComplex({ name: 'Комплексная разминка', exercise_id: null })).toBe(false)
    expect(isComplex({ name: 'Комплекс', exercise_id: 'x' })).toBe(false)
  })
  it('у комплекса нет подсказки «прошлый раз»', async () => {
    const { previousSets } = await import('./lib/offline')
    const past = [{ item_id: 'a', set_no: 1, done: true, time_sec: 600, name: 'Комплекс · 5 раундов', exercise_id: null, date: '2026-11-01' }]
    expect(previousSets(past, { name: 'Комплекс · 5 раундов', exercise_id: null }, '2026-11-10')).toEqual([])
  })
})
