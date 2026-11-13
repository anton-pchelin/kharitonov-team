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
  if (!row || row.used_at || row.created_at < freshSince()) return json({ status: 'expired' })
  if (!row.confirmed_at) return json({ status: 'pending' })

  // Код одноразовый: помечаем «использован» условием, чтобы два параллельных запроса не получили сессию оба.
  const { data: used } = await db.from('telegram_logins')
    .update({ used_at: new Date().toISOString() }).eq('code', code).is('used_at', null).select('code')
  if (!used?.length) return json({ status: 'expired' })

  // Служебный адрес: писем на него не шлём, нужен только потому, что учётке Supabase нужен email.
  const email = `tg${row.telegram_id}@telegram.invalid`
  const created = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { telegram_id: row.telegram_id, telegram_username: row.telegram_username, name: row.name },
  })
  if (created.error && created.error.code !== 'email_exists') throw created.error

  const link = await db.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  return json({ status: 'ok', token_hash: link.data.properties.hashed_token })
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
