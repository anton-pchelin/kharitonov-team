import { supabase, type Profile } from '../supabase'
import { PALETTES, saveLocalTheme, type ThemeMode } from '../theme'
import { InstallHint } from './InstallHint'

type NotifyKey = 'notify_tomorrow' | 'notify_changed' | 'notify_replies' | 'notify_completed' | 'notify_comments'
const ATHLETE_NOTIFY: [NotifyKey, string][] = [
  ['notify_tomorrow', 'Напоминание о завтрашней тренировке (в 20:00)'],
  ['notify_changed', 'Тренер изменил тренировку на сегодня'],
  ['notify_replies', 'Ответы тренера в комментариях'],
]
const COACH_NOTIFY: [NotifyKey, string][] = [
  ['notify_completed', 'Атлет выполнил тренировку'],
  ['notify_comments', 'Комментарии атлетов после тренировки'],
]

const MODES: [ThemeMode, string][] = [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Как в телефоне']]

export function Settings({ profile, onChange }: { profile: Profile; onChange: (p: Partial<Profile>) => Promise<void> }) {
  const set = (patch: { palette?: string; theme?: ThemeMode }) => {
    saveLocalTheme(patch.palette ?? profile.palette, patch.theme ?? profile.theme)
    onChange(patch)  // в профиль — чтобы на другом устройстве было так же
  }

  return (
    <>
      <h2>Настройки</h2>
      {profile.role === 'athlete' && <a className="btn secondary" href="#/profile">Моя анкета: цели, оборудование, здоровье</a>}
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
      <h3>Уведомления в Telegram</h3>
      {(profile.role === 'coach' ? COACH_NOTIFY : ATHLETE_NOTIFY).map(([k, label]) => (
        <label key={k} className="switch">
          <input type="checkbox" checked={profile[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
          <span>{label}</span>
        </label>
      ))}
      <p className="muted">Сообщения не приходят? Откройте бота <a href="https://t.me/kharitonov_team_bot" target="_blank" rel="noreferrer">@kharitonov_team_bot</a> и нажмите «Start».</p>
      <InstallHint />
      <p className="muted">{profile.name} · {profile.email} · {profile.role === 'coach' ? 'тренер' : 'атлет'}</p>
      <button className="btn secondary" onClick={() => supabase.auth.signOut()}>Выйти</button>
    </>
  )
}
