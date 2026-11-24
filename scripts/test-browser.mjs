import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { chromium, webkit } from 'playwright'
import { build, preview } from 'vite'

const base = 'http://127.0.0.1:4178'
const coach = '00000000-0000-4000-8000-000000000001'
const a = '00000000-0000-4000-8000-000000000002'
const b = '00000000-0000-4000-8000-000000000003'
const monday = '2026-11-23'
const plan = '#/plan/' + a + '/' + monday
const athleteRows = [{ athlete_id: a, profiles: { name: 'Первый атлет' } }, { athlete_id: b, profiles: { name: 'Второй атлет' } }]
const failure = { status: 403, json: { code: '42501', message: 'Тестовая ошибка. Секретный текст.' } }
const workout = (title, athlete = a) => ({
  id: 'w1', name: title, title, athlete_id: athlete, date: monday, completed_at: monday, published: true,
  self: false, prescription: '', workout_items: [], profiles: { name: 'Атлет' },
})
function hold() {
  let release
  const wait = new Promise((resolve) => { release = resolve })
  return { wait, release }
}
let dir, server
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'trainer-browser-'))
  process.env.VITE_SUPABASE_URL = base + '/mock'
  process.env.VITE_SUPABASE_ANON_KEY = 'test-key'
  process.env.VITE_BUILD_VERSION = 'browser-test'
  await build({ build: { outDir: dir }, logLevel: 'error' })
  server = await preview({ build: { outDir: dir }, preview: { host: '127.0.0.1', port: 4178, strictPort: true }, logLevel: 'error' })
})
after(async () => {
  if (server) await new Promise((resolve) => server.httpServer.close(resolve))
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function visit(browser, hash, respond = () => undefined, athleteView = false) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  page.setDefaultTimeout(5000)
  await page.addInitScript(({ coach, athleteView }) => {
    if (athleteView) localStorage.setItem('viewAs', 'athlete')
    const enc = (data) => btoa(JSON.stringify(data)).replace(/=+$/, '')
    const expires_at = Math.floor(Date.now() / 1000) + 7200
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: coach, exp: expires_at }) + '.c2ln',
      refresh_token: 'local-refresh', expires_at,
      user: { id: coach, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
    }))
  }, { coach, athleteView })
  await page.route('**/mock/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const endpoint = url.pathname.replace(/^\/mock\/(rest|auth)\/v1\//, '')
    const result = await respond(endpoint, url, req)
    if (result?.abort) return route.abort().catch(() => {})
    const json = result?.json ?? (
      endpoint === 'profiles' ? { id: coach, name: 'Тренер', role: 'coach', palette: 'Сталь', theme: 'light' }
        : endpoint === 'my_access' ? null : endpoint === 'coach_athletes' ? athleteRows : []
    )
    await route.fulfill({ status: result?.status ?? 200, json }).catch(() => {})
  })
  await page.goto(base + '/' + hash)
  return page
}

async function openEditor(page) {
  await page.getByRole('button', { name: /Добавить тренировку/ }).first().click()
  await page.getByRole('button', { name: 'Пустая тренировка' }).click()
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(name, { timeout: 80_000 }, async (suite) => {
    const browser = await engine.launch()
    try {
      await suite.test('ошибка профиля и повтор без входа', async () => {
        let profiles = 0
        const page = await visit(browser, '#/feed', (endpoint) => endpoint === 'profiles' && ++profiles === 1 ? failure : undefined)
        try {
          await page.getByText('Не удалось загрузить профиль', { exact: true }).waitFor()
          await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: { writeText: (text) => { window.copiedDiagnostic = text } },
          }))
          await page.getByRole('button', { name: 'Скопировать сведения о сбое' }).click()
          const report = await page.evaluate(() => window.copiedDiagnostic)
          assert.match(report, /browser-test/)
          assert.match(report, /42501/)
          assert.doesNotMatch(report, /Секретный текст/)
          await page.getByRole('button', { name: 'Повторить', exact: true }).click()
          await page.getByRole('button', { name: 'Все события' }).waitFor()
          assert.equal(profiles, 2)
        } finally { await page.context().close() }
      })

      await suite.test('программа после ошибки открывается повторной загрузкой', async () => {
        let loads = 0
        const page = await visit(browser, '#/programs/test-program', (endpoint) => {
          if (endpoint !== 'programs') return
          return ++loads === 1 ? failure : { json: { id: 'test-program', name: 'Тестовая программа', weeks: 1 } }
        })
        try {
          await page.getByText('Не удалось загрузить программу', { exact: true }).waitFor()
          await page.getByRole('button', { name: 'Повторить', exact: true }).click()
          await page.getByRole('heading', { name: 'Тестовая программа' }).waitFor()
          assert.equal(loads, 2)
        } finally { await page.context().close() }
      })

      await suite.test('поздние ответы недели не меняют карточки нового выбора', async () => {
        const requested = hold()
        const delayed = hold()
        const initialResponse = hold()
        const page = await visit(browser, plan, async (endpoint, url) => {
          if (endpoint !== 'workouts') return
          const athlete = url.searchParams.get('athlete_id')
          const date = url.searchParams.get('date')
          if (athlete === 'eq.' + a) {
            requested.release()
            await delayed.wait
            initialResponse.release()
            return { json: [workout('Прежний план')] }
          }
          const w = workout('План выбранной недели', b)
          w.date = date.slice(4)
          return { json: [w] }
        })
        try {
          await requested.wait
          await page.getByLabel('Атлет', { exact: true }).selectOption(b)
          await page.getByRole('button', { name: 'Следующая неделя' }).click()
          await page.getByText('План выбранной недели', { exact: true }).waitFor()
          delayed.release()
          await initialResponse.wait
          assert.equal(await page.getByLabel('Атлет', { exact: true }).inputValue(), b)
          assert.equal(await page.getByText('Прежний план').count(), 0)
        } finally { delayed.release(); await page.context().close() }
      })

      await suite.test('черновик восстанавливается, а повтор обновляет ту же тренировку', async () => {
        const saves = []
        const page = await visit(browser, plan, (endpoint, _, req) => {
          if (endpoint === 'rpc/save_workout') {
            saves.push(req.postDataJSON())
            return saves.length === 1 ? { abort: true } : { json: saves[0].w.id }
          }
        })
        try {
          await openEditor(page)
          await page.getByPlaceholder('Название тренировки').fill('Вернуть после перезапуска')
          await page.getByRole('button', { name: '+ Комплекс', exact: true }).click()
          await page.getByLabel('Описание задания').fill('Текст комплекса')
          await page.reload()
          await openEditor(page)
          await page.getByRole('button', { name: 'Восстановить', exact: true }).click()
          assert.equal(await page.getByLabel('Описание задания').inputValue(), 'Текст комплекса')
          await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
          await page.getByRole('alert').filter({ hasText: 'Не сохранилось' }).waitFor()
          await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
          await page.getByPlaceholder('Название тренировки').waitFor({ state: 'detached' })
          assert.equal(saves.length, 2)
          assert.ok(saves[0].w.id)
          assert.deepEqual(saves[0], saves[1])
          assert.equal(saves[1].w.title, 'Вернуть после перезапуска')
          await openEditor(page)
          assert.equal(await page.getByRole('button', { name: 'Восстановить', exact: true }).count(), 0)
        } finally { await page.context().close() }
      })

      await suite.test('новое упражнение защищено от двойного нажатия и потери ответа', async () => {
        const writes = []
        const arrived = hold()
        const release = hold()
        const page = await visit(browser, plan, async (endpoint, _, req) => {
          if (endpoint !== 'exercises' || req.method() !== 'POST') return
          writes.push(req.postDataJSON())
          if (writes.length === 1) {
            arrived.release()
            await release.wait
            return { abort: true }
          }
          return { status: 201, json: null }
        })
        try {
          await openEditor(page)
          await page.getByLabel('Поиск по названию упражнения').fill('Тестовый присед')
          await page.getByRole('button', { name: /Новое упражнение/ }).click()
          await arrived.wait
          assert.equal(await page.getByRole('button', { name: 'Добавляю…', exact: true }).isDisabled(), true)
          release.release()
          await page.getByText('Не удалось добавить упражнение.', { exact: false }).waitFor()
          await page.getByRole('button', { name: /Новое упражнение/ }).click()
          await page.getByLabel('Описание задания').waitFor()
          assert.equal(writes.length, 2)
          assert.deepEqual(writes[0], writes[1])
        } finally { release.release(); await page.context().close() }
      })

      await suite.test('из плана можно повторить отправку комментария без повторного ввода', async () => {
        const writes = []
        const page = await visit(browser, plan + '/w1', (endpoint, _, req) => {
          if (endpoint === 'workouts') return { json: [workout('Тренировка из плана')] }
          if (endpoint === 'comments' && req.method() === 'POST') {
            writes.push(req.postDataJSON())
            return writes.length === 1 ? failure : { status: 201, json: null }
          }
        })
        try {
          await page.getByRole('button', { name: /Комментарий к тренировке/ }).click()
          const field = page.getByPlaceholder('Например: резина синяя')
          await field.fill('Комментарий из плана')
          await page.getByRole('button', { name: 'Отправить', exact: true }).click()
          await page.getByText('Не удалось отправить комментарий.', { exact: true }).waitFor()
          assert.equal(await field.inputValue(), 'Комментарий из плана')
          await page.getByRole('button', { name: 'Повторить', exact: true }).click()
          await field.waitFor({ state: 'detached' })
          assert.equal(writes.length, 2)
          assert.deepEqual(writes[0], writes[1])
        } finally { await page.context().close() }
      })

      await suite.test('из своей тренировки можно пополнить базу, изменить и удалить задание', async () => {
        const currentDate = new Date().toLocaleDateString('sv-SE')
        const workouts = []
        const items = []
        const writes = []
        const page = await visit(browser, '#/today/' + currentDate, (endpoint, url, req) => {
          const id = url.searchParams.get('id')?.slice(3)
          const method = req.method()
          if (endpoint === 'rpc/my_access') return { json: { coach_id: b, until: null } }
          if (endpoint === 'exercises' && method === 'POST') {
            writes.push(req.postDataJSON())
            return { status: 201 }
          }
          if (endpoint === 'workouts') {
            if (method === 'POST') { workouts.push(req.postDataJSON()); return { status: 201 } }
            return { json: workouts.map((w) => ({ ...w, workout_items: items.filter((i) => i.workout_id === w.id) })) }
          }
          if (endpoint === 'workout_items') {
            if (method === 'POST') { items.push(req.postDataJSON()); return { status: 201 } }
            const i = items.findIndex((item) => item.id === id)
            if (method === 'PATCH') {
              items[i] = { ...items[i], ...req.postDataJSON() }
              return { json: [{ id }] }
            }
            if (method === 'DELETE') {
              assert.ok(i >= 0)
              items.splice(i, 1)
              return { json: [] }
            }
          }
        }, true)
        try {
          page.on('dialog', (dialog) => dialog.accept())
          await page.getByRole('button', { name: '+ своя тренировка' }).click()
          await page.getByPlaceholder('Например: Бег 5 км, 28:30').fill('Самостоятельная тренировка')
          await page.getByRole('button', { name: '+ моё упражнение' }).click()
          assert.equal(await page.getByRole('button', { name: 'Добавить тренировку' }).isDisabled(), true)
          await page.getByRole('searchbox', { name: 'Название упражнения' }).fill('Присед из тренировки')
          await page.getByRole('button', { name: 'В базу и в тренировку' }).click()
          await page.getByRole('button', { name: 'Редактировать', exact: true }).waitFor()
          assert.equal(writes.length, 1)
          assert.equal(writes[0].source, 'coach')
          const saved = page.waitForResponse((r) => r.url().includes('/workout_items') && r.request().method() === 'POST')
          await page.getByRole('button', { name: 'Добавить тренировку' }).click()
          await saved
          assert.equal(items[0].exercise_id, writes[0].id)
          const itemId = items[0].id
          await page.getByRole('button', { name: 'Редактировать «Присед из тренировки»' }).click()
          await page.getByLabel('Описание задания').fill('Изменённое описание')
          await page.getByLabel('Таймер', { exact: true }).selectOption('emom')
          await page.getByLabel('Интервал · минуты').fill('6')
          await page.getByLabel('Раундов').fill('5')
          const edited = page.waitForResponse((r) => r.url().includes('/workout_items') && r.request().method() === 'PATCH')
          await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
          await edited
          assert.equal(items[0].id, itemId)
          assert.deepEqual(items[0].timer, { kind: 'emom', intervalSec: 360, rounds: 5 })
          await page.getByText('Изменённое описание', { exact: true }).waitFor()
          const deleted = page.waitForResponse((r) => r.url().includes('/workout_items') && r.request().method() === 'DELETE')
          await page.getByRole('button', { name: 'Удалить «Присед из тренировки»' }).click()
          await deleted
          assert.equal(items.length, 0)
          await page.getByRole('heading', { name: /Самостоятельная тренировка/ }).waitFor()
        } finally { await page.context().close() }
      })

      await suite.test('свободный таймер переключается между паузой и работой', async () => {
        const currentDate = new Date().toLocaleDateString('sv-SE')
        const page = await visit(browser, '#/today/' + currentDate, (endpoint) =>
          endpoint === 'rpc/my_access' ? { json: { coach_id: b, until: null } } : undefined, true)
        try {
          await page.clock.install()
          await page.getByRole('button', { name: 'Свободный таймер', exact: true }).click()
          await page.getByLabel('Подготовка · секунды').fill('0')
          await page.getByRole('button', { name: 'Открыть таймер' }).click()
          const timer = page.getByRole('dialog')
          await timer.getByRole('button', { name: '▶ Старт' }).click()
          await page.clock.fastForward(2000)
          await timer.getByRole('button', { name: 'Пауза', exact: true }).click()
          const readout = timer.locator('.timer-big')
          const paused = await readout.textContent()
          await page.clock.fastForward(3000)
          assert.equal(await readout.textContent(), paused)
          await timer.getByRole('button', { name: 'Продолжить', exact: true }).click()
          await page.clock.fastForward(2000)
          await page.waitForFunction((previous) => document.querySelector('.timer-big')?.textContent !== previous, paused)
          await timer.getByRole('button', { name: 'Финиш', exact: true }).click()
          await timer.getByRole('button', { name: 'Готово', exact: true }).click()
          await timer.waitFor({ state: 'detached' })
        } finally { await page.context().close() }
      })

      await suite.test('лента доступна без проверки рекорда, комментарий повторяется с прежним ID', async () => {
        const records = hold()
        const requested = hold()
        const writes = []
        const page = await visit(browser, '#/feed', async (endpoint, _, req) => {
          if (endpoint === 'workouts') return req.method() === 'PATCH' ? { json: null } : { json: [workout('Карточка для комментария')] }
          if (endpoint === 'rpc/workout_records') { requested.release(); await records.wait; return { json: [] } }
          if (endpoint === 'comments' && req.method() === 'POST') {
            writes.push(req.postDataJSON())
            return writes.length === 1 ? { abort: true } : { status: 201, json: null }
          }
        })
        try {
          await requested.wait
          await page.getByRole('button', { name: /Карточка для комментария/ }).click()
          await page.getByRole('button', { name: /Комментарий к тренировке/ }).click()
          const field = page.getByPlaceholder('Например: резина синяя')
          await field.fill('Сохранить этот ответ')
          await page.getByRole('button', { name: 'Отправить', exact: true }).click()
          await page.getByText('Не удалось отправить комментарий.', { exact: true }).waitFor()
          assert.equal(await field.inputValue(), 'Сохранить этот ответ')
          await page.getByRole('button', { name: 'Повторить', exact: true }).click()
          await field.waitFor({ state: 'detached' })
          assert.equal(writes.length, 2)
          assert.deepEqual(writes[0], writes[1])
          records.release()
        } finally { records.release(); await page.context().close() }
      })
    } finally { await browser.close() }
  })
}
