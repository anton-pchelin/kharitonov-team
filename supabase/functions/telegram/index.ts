// Вход через Telegram и бот Kharitonov team.
// Приложение: {action:'start'} → код и имя бота; человек жмёт «Войти» в боте;
// {action:'check', code} → token_hash, по нему клиент получает сессию (auth.verifyOtp).
// Telegram шлёт сюда обновления (webhook) с секретным заголовком — так проверяем, что это он.
// Секреты: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET. Выкладка: --no-verify-jwt (зовут без входа).
import { createClient } from 'npm:@supabase/supabase-js@2'

const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const SITE = 'https://anton-pchelin.github.io/kharitonov-team/'
const CODE_TTL_MIN = 10
const REUSE_MIN = 2  // после подтверждения код ещё 2 минуты отдаёт вход: ответ мог не дойти, пока человек был в Telegram
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'content-type': 'application/json' } })

async function tg(method: string, body: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

let botUsername = ''
const freshSince = () => new Date(Date.now() - CODE_TTL_MIN * 60_000).toISOString()

type From = { id: number; first_name?: string; last_name?: string; username?: string }

async function onUpdate(u: {
  message?: { chat: { id: number }; text?: string }
  callback_query?: { id: string; from: From; data?: string; message?: { chat: { id: number }; message_id: number } }
}) {
  const text = u.message?.text ?? ''
  if (u.message && text.startsWith('/start')) {
    const code = text.split(' ')[1] ?? ''
    const { data } = code
      ? await db.from('telegram_logins').select('code').eq('code', code).is('confirmed_at', null).gt('created_at', freshSince()).maybeSingle()
      : { data: null }
    if (!data) {
      return tg('sendMessage', { chat_id: u.message.chat.id, text: `Это бот Kharitonov team. Приложение: ${SITE}` })
    }
    // Подтверждение кнопкой: если ссылку на вход подсунул кто-то другой, человек просто её не нажмёт.
    return tg('sendMessage', {
      chat_id: u.message.chat.id,
      text: 'Войти в приложение Kharitonov team? Если вы сейчас не входили сами — ничего не нажимайте.',
      reply_markup: { inline_keyboard: [[{ text: 'Войти', callback_data: `login:${code}` }]] },
    })
  }

  const cb = u.callback_query
  if (cb?.data?.startsWith('login:') && cb.message) {
    const { data } = await db.from('telegram_logins')
      .update({
        telegram_id: cb.from.id,
        telegram_username: cb.from.username ?? null,
        name: [cb.from.first_name, cb.from.last_name].filter(Boolean).join(' '),
        confirmed_at: new Date().toISOString(),
      })
      .eq('code', cb.data.slice('login:'.length)).is('confirmed_at', null).gt('created_at', freshSince())
      .select('code')
    const ok = !!data?.length
    await tg('answerCallbackQuery', { callback_query_id: cb.id })
    return tg('editMessageText', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: ok ? 'Готово! Вернитесь в приложение.' : 'Ссылка устарела. Нажмите «Войти через Telegram» в приложении ещё раз.',
    })
  }
}

async function check(code: string) {
  const { data: row } = await db.from('telegram_logins').select('*').eq('code', code).maybeSingle()
  const reuseSince = new Date(Date.now() - REUSE_MIN * 60_000).getTime()
  if (!row || new Date(row.created_at).getTime() < Date.now() - CODE_TTL_MIN * 60_000) return json({ status: 'expired' })
  if (row.used_at && new Date(row.used_at).getTime() < reuseSince) return json({ status: 'expired' })
  if (!row.confirmed_at) return json({ status: 'pending' })
  if (!row.used_at) await db.from('telegram_logins').update({ used_at: new Date().toISOString() }).eq('code', code)

  // Служебный адрес: писем на него не шлём, нужен только потому, что учётке Supabase нужен email.
  const email = `tg${row.telegram_id}@telegram.invalid`
  const created = await db.auth.admin.createUser({ email, email_confirm: true })
  if (created.error && created.error.code !== 'email_exists') throw created.error

  const link = await db.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error

  // Профиль создаёт триггер; Telegram-данные и роль тренера дописываем здесь, при каждом входе:
  // ник, добавленный в coach_telegram_usernames позже, сделает человека тренером со следующего входа.
  const userId = link.data.user.id
  const username = row.telegram_username?.toLowerCase()
  const [{ data: coach }, { data: profile }] = await Promise.all([
    username
      ? db.from('coach_telegram_usernames').select('username').eq('username', username).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('profiles').select('name').eq('id', userId).single(),
  ])
  const { error } = await db.from('profiles').update({
    telegram_id: row.telegram_id,
    ...(profile?.name ? {} : { name: row.name ?? '' }),
    ...(coach ? { role: 'coach' } : {}),
  }).eq('id', userId)
  if (error) throw error
  return json({ status: 'ok', token_hash: link.data.properties.hashed_token })
}

/** Отправить очередь уведомлений (её наполняют триггеры базы). Ошибку Telegram записываем, не повторяем. */
async function flush(): Promise<number> {
  const { data: todo } = await db.from('notifications').select('id').is('sent_at', null).order('id').limit(50)
  if (!todo?.length) return 0
  // «забираем» строки отметкой sent_at — параллельный вызов (cron + кнопка тренера) их уже не возьмёт
  const { data } = await db.from('notifications').update({ sent_at: new Date().toISOString() })
    .in('id', todo.map((t) => t.id)).is('sent_at', null).select('id, text, link, profiles!inner(telegram_id)')
  let sent = 0
  for (const n of (data ?? []) as unknown as { id: number; text: string; link: string | null; profiles: { telegram_id: number } }[]) {
    const r = await tg('sendMessage', {
      chat_id: n.profiles.telegram_id,
      text: n.text,
      ...(n.link ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть', url: SITE + n.link }]] } } : {}),
    })
    // 403 — человек остановил бота; приложение подскажет «откройте бота и нажмите Start»
    if (r.ok) sent++
    else await db.from('notifications').update({ error: r.description ?? 'ошибка' }).eq('id', n.id)
  }
  return sent
}

/** Видео атлетов храним 30 дней: файл удаляем, в комментарии остаётся «видео удалено». */
async function cleanupVideos(): Promise<number> {
  const { data } = await db.rpc('expired_videos')
  const rows = (data ?? []) as { id: string; video_path: string }[]
  if (!rows.length) return 0
  const { error } = await db.storage.from('videos').remove(rows.map((r) => r.video_path))
  if (error) throw error
  await db.from('comments').update({ video_path: null, video_deleted: true }).in('id', rows.map((r) => r.id))
  return rows.length
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  try {
    const secretHeader = req.headers.get('x-telegram-bot-api-secret-token')
    if (secretHeader !== null) {
      if (!SECRET || secretHeader !== SECRET) return new Response('forbidden', { status: 403 })
      await onUpdate(await req.json())
      return new Response('ok')
    }

    const body = await req.json().catch(() => ({}))
    if (body.action === 'start') {
      if (!TOKEN) return json({ error: 'Бот ещё не подключён' }, 503)
      await db.from('telegram_logins').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString())
      if (!botUsername) botUsername = (await tg('getMe', {})).result?.username ?? ''
      const code = crypto.randomUUID().replaceAll('-', '')
      const { error } = await db.from('telegram_logins').insert({ code })
      if (error) throw error
      return json({ code, bot: botUsername })
    }
    if (body.action === 'check' && typeof body.code === 'string') return await check(body.code)
    // pg_cron раз в минуту: напоминания на завтра (в 20:00 у атлета), отправка очереди, раз в час — чистка старых видео
    if (body.action === 'cron' && SECRET && body.secret === SECRET) {
      await db.rpc('enqueue_reminders')
      const sent = await flush()
      return json({ sent, ...(new Date().getUTCMinutes() === 0 ? { removed: await cleanupVideos() } : {}) })
    }
    if (body.action === 'cleanup' && SECRET && body.secret === SECRET) return json({ removed: await cleanupVideos() })
    // Кнопка тренера «Отправить напоминания сейчас» — только его атлетам, без учёта часа
    if (body.action === 'remind_now') {
      const { data: auth } = await db.auth.getUser(req.headers.get('authorization')?.replace('Bearer ', '') ?? '')
      const { data: me } = auth.user ? await db.from('profiles').select('role').eq('id', auth.user.id).single() : { data: null }
      if (me?.role !== 'coach') return json({ error: 'только для тренера' }, 403)
      const { data: queued } = await db.rpc('enqueue_reminders', { p_coach: auth.user!.id })
      return json({ queued, sent: await flush() })
    }
    if (body.action === 'setup' && SECRET && body.secret === SECRET) {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram`
      return json(await tg('setWebhook', { url, secret_token: SECRET, allowed_updates: ['message', 'callback_query'] }))
    }
    return json({ error: 'bad request' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'server error' }, 500)
  }
})
