import { supabase, type Profile } from '../supabase'
import { DEFAULT_PALETTE, PALETTES, type ThemeMode } from '../theme'
import { InstallHint } from './InstallHint'

const KEY = 'theme'
const MODES: [ThemeMode, string][] = [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Как в телефоне']]

/** Копия выбора в телефоне — чтобы до входа и загрузки профиля не мигали чужие цвета. */
export function loadLocalTheme(): { palette: string; mode: ThemeMode } {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? '')
    if (t.palette in PALETTES && MODES.some(([m]) => m === t.mode)) return t
  } catch { /* нет сохранённой — по умолчанию */ }
  return { palette: DEFAULT_PALETTE, mode: 'light' }
}

export function saveLocalTheme(palette: string, mode: ThemeMode) {
  localStorage.setItem(KEY, JSON.stringify({ palette, mode }))
}

export function Settings({ profile, onChange }: { profile: Profile; onChange: (p: Partial<Profile>) => Promise<void> }) {
  const set = (patch: { palette?: string; theme?: ThemeMode }) => {
    saveLocalTheme(patch.palette ?? profile.palette, patch.theme ?? profile.theme)
    onChange(patch)  // в профиль — чтобы на другом устройстве было так же
  }

  return (
    <>
      <h2>Настройки</h2>
      <h3>Тема</h3>
      <div className="segmented">
        {MODES.map(([m, label]) => (
          <button key={m} className={profile.theme === m ? 'active' : ''} onClick={() => set({ theme: m })}>{label}</button>
        ))}
      </div>
      <h3>Оттенки</h3>
      <div className="palettes">
        {Object.entries(PALETTES).map(([name, [primary, , secondary, , bg]]) => (
          <button key={name} className={'palette' + (profile.palette === name ? ' active' : '')} onClick={() => set({ palette: name })}>
            <span className="swatch" style={{ background: `linear-gradient(135deg, ${primary} 50%, ${secondary} 50%)`, borderColor: bg }} />
            {name}
          </button>
        ))}
      </div>
      <InstallHint />
      <p className="muted">{profile.name} · {profile.email} · {profile.role === 'coach' ? 'тренер' : 'атлет'}</p>
      <button className="btn secondary" onClick={() => supabase.auth.signOut()}>Выйти</button>
    </>
  )
}
