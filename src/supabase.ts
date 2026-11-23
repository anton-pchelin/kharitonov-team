import { createClient } from '@supabase/supabase-js'
import type { ThemeMode } from './theme'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — см. .env.example')

// Мобильный интернет бывает теряет ответ сервера, и запрос висел вечно: «Сохранить» навсегда оставалось «Сохраняю…».
// Через 20 с — понятная ошибка, кнопка снова жмётся, введённое не пропадает. Видео (storage) грузится дольше — без срока.
const TIMEOUT_S = 20
const fetchWithTimeout: typeof fetch = (input, init) => {
  const href = input instanceof Request ? input.url : String(input)
  if (init?.signal || href.includes('/storage/v1/')) return fetch(input, init)
  return fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_S * 1000) }).catch((e: Error) => {
    if (e?.name !== 'TimeoutError') throw e
    // без code — очередь атлета (offline.ts) считает это обрывом сети и повторит позже
    throw Object.assign(new Error(`сервер не ответил за ${TIMEOUT_S} секунд — проверьте интернет и нажмите ещё раз`), { name: 'Нет связи' })
  })
}

export const supabase = createClient(url, key, { global: { fetch: fetchWithTimeout } })

/** id вошедшего (из сохранённой сессии, без запроса к серверу). */
export const myId = async () => (await supabase.auth.getSession()).data.session?.user.id ?? ''

export type Profile = {
  id: string
  role: 'coach' | 'athlete'
  name: string
  email: string | null
  city: string
  timezone: string
  goals: string
  equipment: string
  health_limits: string
  theme: ThemeMode
  palette: string
  notify_tomorrow: boolean
  notify_changed: boolean
  notify_replies: boolean
  notify_completed: boolean
  notify_comments: boolean
  bar: number
  plates: number[]
}
