import { useEffect, useState, type ReactNode } from 'react'
import { supabase, type Profile } from '../supabase'
import { PALETTES, saveLocalTheme, type ThemeMode } from '../theme'
import { InstallHint } from './InstallHint'
import { Icon, type IconName } from '../lib/icons'
import { readTimerSettings, saveTimerSettings, type TimerSettings } from '../lib/timer'

type Section = [key: string, title: string, icon: IconName, body: ReactNode]

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

const MODES: [ThemeMode, string][] = [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Как в системе']]

/** Строка настройки в стиле macOS: подпись слева, управление справа. */
function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-line">
      <div className="set-label">{label}{hint && <small className="muted">{hint}</small>}</div>
      {children && <div className="set-control">{children}</div>}
    </div>
  )
}

/**
 * Настройки: на ПК — список разделов слева и выбранный раздел справа (как «Системные настройки» macOS),
 * на телефоне — все разделы друг под другом.
 */
export function Settings({ profile, onChange, onSwitchView }: {
  profile: Profile; onChange: (p: Partial<Profile>) => Promise<void>
  /** есть только у тренера, который сам занимается у другого тренера: режим «Атлет» */
  onSwitchView?: (athlete: boolean) => void
}) {
  const isCoach = profile.role === 'coach'
  const set = (patch: { palette?: string; theme?: ThemeMode }) => {
    saveLocalTheme(patch.palette ?? profile.palette, patch.theme ?? profile.theme)
    onChange(patch)  // в профиль — чтобы на другом устройстве было так же
  }

  const sections: Section[] = [
    ['account', 'Учётная запись', 'user', (
      <div className="group">
        <Row label={profile.name || 'Без имени'} hint={isCoach ? 'тренер' : 'атлет'} />
        {onSwitchView && (
          <Row label="Режим" hint="как атлет вы видите тренировки от своего тренера">
            <div className="segmented">
              <button className={isCoach ? 'active' : ''} onClick={() => onSwitchView(false)}>Тренер</button>
              <button className={isCoach ? '' : 'active'} onClick={() => onSwitchView(true)}>Атлет</button>
            </div>
          </Row>
        )}
        {!isCoach && <Row label="Анкета" hint="цели, оборудование, здоровье"><a className="btn small secondary" href="#/profile">Открыть</a></Row>}
        <Row label="Выйти из приложения"><button className="btn small secondary" onClick={() => supabase.auth.signOut()}>Выйти</button></Row>
      </div>
    )],
    ['look', 'Оформление', 'palette', (
      <>
        <div className="group">
          <Row label="Тема">
            <div className="segmented">
              {MODES.map(([m, label]) => <button key={m} className={profile.theme === m ? 'active' : ''} onClick={() => set({ theme: m })}>{label}</button>)}
            </div>
          </Row>
        </div>
        <p className="group-title">Оттенки</p>
        <div className="palettes">
          {Object.entries(PALETTES).map(([name, [primary, , secondary, , bg]]) => (
            <button key={name} className={'palette' + (profile.palette === name ? ' active' : '')} onClick={() => set({ palette: name })}>
              <span className="swatch" style={{ background: `linear-gradient(135deg, ${primary} 50%, ${secondary} 50%)`, borderColor: bg }} />
              {name}
            </button>
          ))}
        </div>
      </>
    )],
    ['notify', 'Уведомления', 'bell', (
      <>
        <div className="group">
          {(isCoach ? COACH_NOTIFY : ATHLETE_NOTIFY).map(([k, label]) => (
            <label key={k} className="set-line switch-line">
              <span className="set-label">{label}</span>
              <input type="checkbox" className="toggle" checked={profile[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
            </label>
          ))}
        </div>
        <p className="muted group-note">Сообщения приходят в Telegram. Не приходят — откройте бота <a href="https://t.me/kharitonov_team_bot" target="_blank" rel="noreferrer">@kharitonov_team_bot</a> и нажмите «Start».</p>
      </>
    )],
    ...(!isCoach ? [['gym', 'Гриф и блины', 'dumbbell', <GymSettings key="gym" profile={profile} onChange={onChange} />] as Section] : []),
    ...(!isCoach ? [['timer', 'Таймер', 'timer', <TimerSection key="timer" />] as Section] : []),
    ...(isCoach ? [['storage', 'Хранилище', 'disk', <StorageUsage key="storage" />] as Section] : []),
    ['app', 'Приложение', 'app', <div className="group" key="app"><div className="set-line"><InstallHint /></div></div>],
  ]
  const [active, setActive] = useState(sections[0][0])

  return (
    <div className="settings">
      <h2 className="page-title">Настройки</h2>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Разделы настроек">
          {sections.map(([k, title, icon]) => (
            <button key={k} className={active === k ? 'active' : ''} onClick={() => setActive(k)}>
              <Icon name={icon} />{title}
            </button>
          ))}
        </nav>
        <div className="settings-pane">
          {sections.map(([k, title, , body]) => (
            <section key={k} className={active === k ? 'active' : ''}>
              <h3 className="group-title">{title}</h3>
              {body}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

const LIMIT = 1024 ** 3  // бесплатное хранилище Supabase — 1 ГБ

function StorageUsage() {
  const [used, setUsed] = useState<number | null>(null)
  useEffect(() => { supabase.rpc('storage_usage').then(({ data }) => setUsed(Number(data ?? 0))) }, [])
  if (used == null) return <p className="muted">Загрузка…</p>
  const mb = (n: number) => (n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0).replace('.', ',')
  return (
    <div className="group">
      <Row label="Фото и видео атлетов" hint={used > LIMIT * 0.9 ? 'Место почти закончилось. Видео старше 30 дней удаляются сами.' : 'Видео старше 30 дней удаляются сами'}>
        <b className={used > LIMIT * 0.9 ? 'storage-warn' : ''}>{mb(used)} МБ из {mb(LIMIT)} МБ</b>
      </Row>
      <div className="meter"><span style={{ width: `${Math.min(100, (used / LIMIT) * 100)}%` }} /></div>
    </div>
  )
}

/** Гриф и набор блинов — для калькулятора 🏋 в поле веса. */
function GymSettings({ profile, onChange }: { profile: Profile; onChange: (p: Partial<Profile>) => Promise<void> }) {
  const [text, setText] = useState((profile.plates ?? []).join('; ').replaceAll('.', ','))
  return (
    <div className="group">
      <Row label="Гриф">
        <div className="segmented">
          {[20, 15, 10].map((b) => <button key={b} className={profile.bar === b ? 'active' : ''} onClick={() => onChange({ bar: b })}>{b} кг</button>)}
        </div>
      </Row>
      <Row label="Блины в зале" hint="через «;», например 25; 20; 10; 5; 2,5">
        <input value={text} aria-label="Блины в зале" onChange={(e) => setText(e.target.value)} onBlur={() => {
          const plates = text.split(';').map((s) => Number(s.trim().replace(',', '.'))).filter((n) => n > 0 && n <= 50)
          if (plates.length) onChange({ plates })
        }} />
      </Row>
    </div>
  )
}

const SIGNALS: ['half' | 'ten' | 'count', string][] = [['half', 'Половина времени'], ['ten', 'За 10 секунд'], ['count', 'Обратный отсчёт 5…1']]
const SOUNDS: [TimerSettings['sound'], string][] = [['voice', 'Голос'], ['beep', 'Сигналы'], ['off', 'Без звука']]

/** Таймер комплекса: какие сигналы, звук, громкость, вибрация, вид задания. Хранится в телефоне. */
function TimerSection() {
  const [s, setS] = useState(readTimerSettings)
  const set = (patch: Partial<TimerSettings>) => { const next = { ...s, ...patch }; setS(next); saveTimerSettings(next) }
  const canVibrate = 'vibrate' in navigator
  return (
    <>
      <div className="group">
        {SIGNALS.map(([k, label]) => (
          <label key={k} className="set-line switch-line">
            <span className="set-label">{label}</span>
            <input type="checkbox" className="toggle" checked={s[k]} onChange={(e) => set({ [k]: e.target.checked })} />
          </label>
        ))}
        <Row label="Звук">
          <div className="segmented">
            {SOUNDS.map(([k, label]) => <button key={k} className={s.sound === k ? 'active' : ''} onClick={() => set({ sound: k })}>{label}</button>)}
          </div>
        </Row>
        <Row label="Громкость" hint="Не громче звука телефона">
          <input type="range" min={0} max={1} step={0.1} value={s.volume} aria-label="Громкость"
            onChange={(e) => set({ volume: Number(e.target.value) })} />
        </Row>
        <label className="set-line switch-line">
          <span className="set-label">Вибрация{!canVibrate && <small className="muted">не работает на этом телефоне (iPhone)</small>}</span>
          <input type="checkbox" className="toggle" checked={s.vibrate && canVibrate} disabled={!canVibrate} onChange={(e) => set({ vibrate: e.target.checked })} />
        </label>
        <Row label="Задание на экране таймера">
          <div className="segmented">
            <button className={s.view === 'under' ? 'active' : ''} onClick={() => set({ view: 'under' })}>Под цифрами</button>
            <button className={s.view === 'sheet' ? 'active' : ''} onClick={() => set({ view: 'sheet' })}>По кнопке</button>
          </div>
        </Row>
      </div>
      <p className="muted group-note">Работает без интернета. На iPhone в беззвучном режиме звук сайта может не играть — включите звонок.
        Нет русского голоса в телефоне — вместо слов будут сигналы.</p>
    </>
  )
}
