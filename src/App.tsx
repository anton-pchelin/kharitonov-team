import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from './supabase'
import { applyTheme, watchSystemTheme } from './theme'
import { Login } from './screens/Login'
import { Athletes } from './screens/Athletes'
import { AthleteCard } from './screens/AthleteCard'
import { Exercises } from './screens/Exercises'
import { MyProfile } from './screens/MyProfile'
import { Settings, saveLocalTheme } from './screens/Settings'

const INVITE_KEY = 'inviteToken'

const INVITE_ERRORS: Record<string, string> = {
  invalid: 'Ссылка-приглашение не найдена. Попросите тренера новую ссылку.',
  used: 'Эта ссылка уже использована. Попросите тренера новую ссылку.',
  expired: 'Срок ссылки истёк. Попросите тренера новую ссылку.',
  has_other_coach: 'Вы уже занимаетесь у другого тренера.',
  is_coach: 'Вы вошли как тренер — приглашение нужно открыть атлету.',
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
  const [hasCoach, setHasCoach] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [invite, setInvite] = useState(() => localStorage.getItem(INVITE_KEY))

  // Ссылка-приглашение: запоминаем и принимаем после входа (или сразу, если уже вошли).
  if (route[0] === 'invite' && route[1]) {
    localStorage.setItem(INVITE_KEY, route[1])
    if (invite !== route[1]) setInvite(route[1])
    location.hash = '#/'
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return setProfile(null)
    ;(async () => {
      if (invite) {
        const { data, error } = await supabase.rpc('accept_invite', { p_token: invite })
        // неверный формат токена — та же «ссылка не найдена»
        const code = error ? 'invalid' : (data as string)
        setInviteError(INVITE_ERRORS[code] ?? '')
        localStorage.removeItem(INVITE_KEY)
        setInvite(null)
      }
      const [{ data: p }, { data: coachId }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.rpc('my_coach_id'),
      ])
      setProfile(p)
      setHasCoach(!!coachId)
      if (p) saveLocalTheme(p.palette, p.theme)
    })()
  }, [userId, invite])

  useEffect(() => {
    if (!profile) return
    applyTheme(profile.palette, profile.theme)
    if (profile.theme === 'system') return watchSystemTheme(() => applyTheme(profile.palette, 'system'))
  }, [profile?.palette, profile?.theme])

  if (session === undefined || (session && !profile)) return <div className="center muted">Загрузка…</div>
  if (!session || !profile) return <Login hasInvite={!!invite} />

  const update = async (patch: Partial<Profile>) => {
    setProfile({ ...profile, ...patch })
    const { error } = await supabase.from('profiles').update(patch).eq('id', profile.id)
    if (error) alert('Не сохранилось: ' + error.message)
  }

  if (!profile.name) return <MyProfile profile={profile} onSave={update} first />

  const isCoach = profile.role === 'coach'
  if (!isCoach && !hasCoach) {
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

  const tabs = isCoach
    ? [['athletes', 'Атлеты'], ['exercises', 'Упражнения'], ['settings', 'Настройки']]
    : [['profile', 'Профиль'], ['exercises', 'Упражнения'], ['settings', 'Настройки']]
  const tab = tabs.some(([k]) => k === route[0]) || route[0] === 'athlete' ? route[0] : tabs[0][0]

  return (
    <div className="page">
      <header className="top"><Logo /></header>
      <main>
        {inviteError && <p className="error">{inviteError}</p>}
        {tab === 'athletes' && <Athletes />}
        {tab === 'athlete' && isCoach && <AthleteCard id={route[1]} />}
        {tab === 'profile' && <MyProfile profile={profile} onSave={update} />}
        {tab === 'exercises' && <Exercises canEdit={isCoach} />}
        {tab === 'settings' && <Settings profile={profile} onChange={update} />}
      </main>
      <nav className="tabs">
        {tabs.map(([k, label]) => (
          <a key={k} href={`#/${k}`} className={tab === k || (tab === 'athlete' && k === 'athletes') ? 'active' : ''}>{label}</a>
        ))}
      </nav>
    </div>
  )
}
