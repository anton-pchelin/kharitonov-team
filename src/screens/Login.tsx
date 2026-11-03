import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { Logo } from '../App'
import { InstallHint } from './InstallHint'

export function Login({ hasInvite }: { hasInvite: boolean }) {
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
        {!sent ? (
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
        )}
        {error && <p className="error">{error}</p>}
        <InstallHint />
      </main>
    </div>
  )
}
