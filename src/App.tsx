import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from './supabase'
import { applyTheme, saveLocalTheme, watchSystemTheme } from './theme'
import { Login } from './screens/Login'
import { Athletes } from './screens/Athletes'
import { AthleteCard } from './screens/AthleteCard'
import { Exercises } from './screens/Exercises'
import { MyProfile } from './screens/MyProfile'
import { Settings } from './screens/Settings'
import { Plan } from './screens/Plan'
import { Today } from './screens/Today'
import { Progress } from './screens/Progress'
import { Programs } from './screens/Programs'
import { Feed } from './screens/Feed'
import { Icon, type IconName } from './lib/icons'
import { daysBetween, fmtDM, today } from './lib/dates'
import { withDeadline } from './lib/request'
import { LoadError } from './lib/diagnostics'

const INVITE_KEY = 'inviteToken'
const ACCESS_KEY = 'access'  // последний известный срок доступа — для работы без сети
const VIEW_KEY = 'viewAs'  // тренер, у которого есть свой тренер, открывает приложение как атлет

type Access = { coach_id: string; until: string | null; coach_username: string | null; coach_telegram_id?: number | null } | null

const INVITE_ERRORS: Record<string, string> = {
  invalid: 'Ссылка-приглашение не найдена. Попросите тренера новую ссылку.',
  used: 'Эта ссылка уже использована. Попросите тренера новую ссылку.',
  expired: 'Срок ссылки истёк. Попросите тренера новую ссылку.',
  has_other_coach: 'Вы уже занимаетесь у другого тренера.',
  own_invite: 'Это ваше приглашение — отправьте его атлету.',
}

function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const f = () => setHash(location.hash)
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return hash.replace(/^#\/?/, '').split('/')
}

export function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark">KT</span>
      <span className="logo-text"><b>KHARITONOV</b><small>team</small></span>
    </div>
  )
}

export function App() {
  const route = useRoute()
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [authUser, setAuthUser] = useState<string | null | undefined>(undefined)
  const consumedInvite = useRef<string | null>(null)
  const [access, setAccess] = useState<Access>(null)
  const [inviteError, setInviteError] = useState('')
  const [invite, setInvite] = useState(() => localStorage.getItem(INVITE_KEY))
  const [asAthlete, setAsAthlete] = useState(() => localStorage.getItem(VIEW_KEY) === 'athlete')

  // Ссылка-приглашение: запоминаем и принимаем после входа (или сразу, если уже вошли).
  if (route[0] === 'invite' && route[1]) {
    localStorage.setItem(INVITE_KEY, route[1])
    if (invite !== route[1]) setInvite(route[1])
    location.hash = '#/'
  }

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') {
        setSession(null)
        setProfile(null)
        setFailure(null)
        setInvite(localStorage.getItem(INVITE_KEY))
        setAuthUser(null)
      }
      if (event === 'SIGNED_IN') setAuthUser(s?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let current = true
    setFailure(null)
    setProfile(null)
    withDeadline(async (signal) => {
      const result = await supabase.auth.getSession()
      if (result.error) throw result.error
      const nextSession = result.data.session
      if (!nextSession || signal.aborted || !current) return { session: nextSession, profile: null, access: null }
      const id = nextSession.user.id
      if (invite && invite !== consumedInvite.current) {
        const { data, error } = await supabase.rpc('accept_invite', { p_token: invite }).abortSignal(signal)
        if (error && !error.code) throw error
        if (current && !signal.aborted) {
          setInviteError(INVITE_ERRORS[error ? 'invalid' : String(data)] ?? '')
          localStorage.removeItem(INVITE_KEY)
          consumedInvite.current = invite
        }
      }
      if (signal.aborted || !current) return { session: nextSession, profile: null, access: null }
      const [p, acc] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).abortSignal(signal).single(),
        supabase.rpc('my_access').abortSignal(signal),
      ])
      if (p.error || !p.data) throw p.error ?? new Error('Профиль отсутствует')
      const accessKey = ACCESS_KEY + ':' + id
      let savedAccess: Access = null
      try {
        if (acc.error) savedAccess = JSON.parse(localStorage.getItem(accessKey) ?? 'null') as Access
        else {
          savedAccess = acc.data as Access
          localStorage.setItem(accessKey, JSON.stringify(savedAccess))
        }
      } catch { /* Хранилище браузера недоступно. */ }
      return { session: nextSession, profile: p.data as Profile, access: savedAccess }
    }).then((data) => {
      if (!current) return
      setSession(data.session)
      setProfile(data.profile)
      setAccess(data.access)
      if (data.profile) saveLocalTheme(data.profile.palette, data.profile.theme)
    }, (cause) => { if (current) setFailure({ cause }) })
    return () => { current = false }
  }, [authUser, invite, attempt])


  useEffect(() => {
    if (!profile) return
    applyTheme(profile.palette, profile.theme)
    if (profile.theme === 'system') return watchSystemTheme(() => applyTheme(profile.palette, 'system'))
  }, [profile?.palette, profile?.theme])

  if (failure) return <div className="center"><LoadError screen="Вход" cause={failure.cause}
    message="Не удалось загрузить профиль" onRetry={() => setAttempt((n) => n + 1)} /></div>
  if (session === undefined || (session && profile?.id !== session.user.id) || (authUser && session?.user.id !== authUser)) {
    return <div className="center muted">Загрузка…</div>
  }
  if (!session || !profile) return <Login hasInvite={!!invite} />

  const update = async (patch: Partial<Profile>) => {
    setProfile({ ...profile, ...patch })
    const { error } = await supabase.from('profiles').update(patch).eq('id', profile.id)
    if (error) alert('Не сохранилось: ' + error.message)
  }

  if (!profile.name) return <MyProfile profile={profile} onSave={update} first />

  const hasCoach = !!access
  const realCoach = profile.role === 'coach'
  const isCoach = realCoach && !asAthlete
  // экраны видят роль, в которой тренер сейчас смотрит приложение
  const shown: Profile = { ...profile, role: isCoach ? 'coach' : 'athlete' }
  const switchView = (athlete: boolean) => {
    localStorage.setItem(VIEW_KEY, athlete ? 'athlete' : 'coach')
    setAsAthlete(athlete)
  }
  // переключатель — тренеру, который сам занимается у другого тренера (и чтобы выйти из режима атлета)
  const canSwitch = realCoach && (hasCoach || asAthlete)
  if (!realCoach && !hasCoach) {
    return (
      <div className="page">
        <header className="top"><Logo /></header>
        <main className="center">
          <h2>Вас пока не пригласил тренер</h2>
          {inviteError && <p className="error">{inviteError}</p>}
          <p className="muted">Попросите у тренера ссылку-приглашение и откройте её на этом телефоне.</p>
          <button className="btn secondary" onClick={() => supabase.auth.signOut()}>Выйти</button>
        </main>
      </div>
    )
  }

  // срок доступа — только для режима атлета; «до 20.12» значит, что 20.12 ещё можно
  const daysLeft = !isCoach && access?.until ? daysBetween(today(), access.until) : null
  if (daysLeft !== null && daysLeft < 0) {
    const queued = (() => { try { return JSON.parse(localStorage.getItem(`queue:v1:${profile.id}`) ?? '[]').length as number } catch { return 0 } })()
    return (
      <div className="page">
        <header className="top"><Logo /></header>
        <main className="center">
          <h2>Доступ закончился {fmtDM(access!.until!)}</h2>
          <p className="muted">Чтобы продолжить, оплатите занятия у тренера</p>
          {queued > 0 && <p className="error">Не отправлено: доступ закончился ({queued}). Отправится после продления.</p>}
          {(access!.coach_username || access!.coach_telegram_id) && <a className="btn" target="_blank" rel="noreferrer"
            href={access!.coach_username ? `https://t.me/${access!.coach_username}` : `tg://user?id=${access!.coach_telegram_id}`}>Написать тренеру</a>}
          {realCoach && <button className="btn secondary" onClick={() => switchView(false)}>Перейти в режим тренера</button>}
          <button className="btn secondary" onClick={() => supabase.auth.signOut()}>Выйти</button>
        </main>
      </div>
    )
  }

  const tabs: [IconName, string][] = isCoach
    ? [['feed', 'Лента'], ['athletes', 'Атлеты'], ['plan', 'План'], ['exercises', 'Упражнения'], ['settings', 'Настройки']]
    : [['today', 'Тренировки'], ['progress', 'Прогресс'], ['exercises', 'Упражнения'], ['settings', 'Настройки']]
  const tab = tabs.some(([k]) => k === route[0]) || ['athlete', 'progress', 'profile', 'programs'].includes(route[0]) ? route[0] : tabs[0][0]

  const isActive = (k: string) => tab === k || (['athlete', 'progress'].includes(tab) && k === 'athletes' && isCoach)
    || (tab === 'programs' && k === 'plan') || (tab === 'profile' && k === 'settings')
  const links = tabs.map(([k, label]) => (
    <a key={k} href={`#/${k}`} className={isActive(k) ? 'active' : ''} aria-current={isActive(k) ? 'page' : undefined}>
      <Icon name={k} /><span>{label}</span>
    </a>
  ))

  return (
    <div className="page app">
      <header className="top"><Logo /></header>
      {/* на ПК — боковое меню, на телефоне — вкладки внизу */}
      <aside className="side">
        <Logo />
        <nav aria-label="Разделы">{links}</nav>
        <div className="side-foot">
          <span className="avatar small">{(profile.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
          <span>{profile.name}<small className="muted">{isCoach ? 'тренер' : 'атлет'}</small></span>
        </div>
      </aside>
      <main>
        {inviteError && <p className="error">{inviteError}</p>}
        {tab === 'today' && daysLeft !== null && daysLeft <= 7 && (
          <p className="card">Доступ до {fmtDM(access!.until!)} — {daysLeft === 0 ? 'сегодня последний день' : `осталось ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}`}. Не забудьте оплатить</p>
        )}
        {tab === 'feed' && isCoach && <Feed me={shown} />}
        {tab === 'athletes' && <Athletes />}
        {tab === 'athlete' && isCoach && <AthleteCard id={route[1]} />}
        {tab === 'plan' && isCoach && <Plan athleteId={route[1]} week={route[2]} open={route[3]} me={shown} />}
        {tab === 'today' && !isCoach && (hasCoach ? <Today profile={profile} date={route[1]} />
          : <p className="center muted">У вас пока нет тренера</p>)}
        {tab === 'progress' && (isCoach ? route[1] && <Progress athleteId={route[1]} title="Прогресс атлета" /> : <Progress athleteId={profile.id} />)}
        {tab === 'programs' && isCoach && <Programs id={route[1]} coachId={profile.id} />}
        {tab === 'profile' && <MyProfile profile={shown} onSave={update} />}
        {tab === 'exercises' && <Exercises canEdit={isCoach} />}
        {tab === 'settings' && <Settings profile={shown} onChange={update} onSwitchView={canSwitch ? switchView : undefined} />}
      </main>
      <nav className="tabs" aria-label="Разделы">{links}</nav>
    </div>
  )
}
