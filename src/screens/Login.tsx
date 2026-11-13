import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { Logo } from '../App'
import { InstallHint } from './InstallHint'

const TG_KEY = 'tgLoginCode'

/** Вход через бота: код → t.me/бот?start=код → «Войти» в Telegram → сервер отдаёт token_hash. */
function TelegramLogin() {
  const [code, setCode] = useState(() => localStorage.getItem(TG_KEY))
  const [link, setLink] = useState('')
  const [error, setError] = useState('')

  const reset = (message = '') => {
    localStorage.removeItem(TG_KEY)
    setCode(null)
    setLink('')
    setError(message)
  }

  const start = async () => {
    setError('')
    const { data, error } = await supabase.functions.invoke('telegram', { body: { action: 'start' } })
    if (error || !data?.code) return setError('Не получилось начать вход. Попробуйте ещё раз.')
    const url = `https://t.me/${data.bot}?start=${data.code}`
    localStorage.setItem(TG_KEY, data.code)  // приложение могло перезагрузиться, пока человек в Telegram
    setCode(data.code)
    setLink(url)
    window.open(url, '_blank')
  }

  useEffect(() => {
    if (!code) return
    let stopped = false
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      const { data } = await supabase.functions.invoke('telegram', { body: { action: 'check', code } })
      if (!stopped && data?.status === 'ok') {
        stopped = true
        localStorage.removeItem(TG_KEY)
        const { error } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' })
        if (error) reset('Не получилось войти: ' + error.message)
      } else if (!stopped && data?.status === 'expired') {
        stopped = true
        reset('Время на вход вышло. Нажмите кнопку ещё раз.')
      }
      busy = false
    }
    const onVisible = () => document.visibilityState === 'visible' && tick()
    const id = setInterval(tick, 2500)
    document.addEventListener('visibilitychange', onVisible)
    tick()
    return () => {
      stopped = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [code])

  if (!code) {
    return (
      <>
        <button className="btn" onClick={start}>Войти через Telegram</button>
        {error && <p className="error">{error}</p>}
      </>
    )
  }
  return (
    <div className="card">
      <p>В Telegram нажмите «Start», затем «Войти» и вернитесь сюда — вход произойдёт сам.</p>
      {link && <a className="btn" href={link} target="_blank" rel="noreferrer">Открыть Telegram</a>}
      <button className="btn secondary" onClick={() => reset()}>Отмена</button>
    </div>
  )
}

export function Login({ hasInvite }: { hasInvite: boolean }) {
  const [byEmail, setByEmail] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (e: FormEvent, action: () => Promise<{ error: Error | null }>, onOk?: () => void) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await action()
    setBusy(false)
    if (error) setError(error.message.includes('expired') || error.message.includes('invalid')
      ? 'Код неверный или устарел. Запросите новый.'
      : 'Не получилось: ' + error.message)
    else onOk?.()
  }

  return (
    <div className="page">
      <header className="top"><Logo /></header>
      <main className="narrow">
        <h2>Вход</h2>
        {hasInvite && <p className="note">Вас пригласил тренер. Войдите — и вы появитесь в его списке.</p>}
        <TelegramLogin />
        {!byEmail && <button className="back" onClick={() => setByEmail(true)}>Войти по email</button>}
        {byEmail && (!sent ? (
          <form onSubmit={(e) => run(e, () => supabase.auth.signInWithOtp({ email: email.trim() }), () => setSent(true))}>
            <label>Email
              <input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn" disabled={busy}>Получить код</button>
          </form>
        ) : (
          <form onSubmit={(e) => run(e, () => supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' }))}>
            <p className="muted">Код отправлен на {email}. Проверьте и папку «Спам».</p>
            <label>Код из письма
              <input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button className="btn" disabled={busy}>Войти</button>
            <button type="button" className="btn secondary" onClick={() => { setSent(false); setCode('') }}>Другой email</button>
          </form>
        ))}
        {error && <p className="error">{error}</p>}
        <InstallHint />
      </main>
    </div>
  )
}
