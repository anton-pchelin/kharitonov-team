import { createClient } from '@supabase/supabase-js'
import type { ThemeMode } from './theme'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — см. .env.example')

export const supabase = createClient(url, key)

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
}
