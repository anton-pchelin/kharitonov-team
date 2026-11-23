import { useEffect, useState } from 'react'

type Screen = 'Вход' | 'Программа' | 'План' | 'Лента' | 'Редактор тренировки' | 'Настройки' | 'Тренировки'
type Operation = 'Загрузка профиля' | 'Загрузка' | 'Сохранение' | 'Добавление упражнения' | 'Отправка комментария' | 'Открытие'
type Diagnostic = { screen: Screen; operation: Operation; code: string; time: string; online: boolean }

export const buildVersion = import.meta.env.VITE_BUILD_VERSION || 'локальная'
let latest: Diagnostic | undefined

export function recordFailure(screen: Screen, operation: Operation, cause: unknown) {
  const code = (cause as { code?: unknown } | null)?.code
  latest = {
    screen, operation,
    code: typeof code === 'string' && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3}|TIMEOUT)$/.test(code) ? code : 'REQUEST_FAILED',
    time: new Date().toISOString(), online: navigator.onLine,
  }
}

export function DiagnosticButton() {
  const [message, setMessage] = useState('')
  const [fallback, setFallback] = useState('')
  const copy = async () => {
    const d = latest ?? {
      screen: 'Настройки', operation: 'Открытие', code: 'NO_ERROR',
      time: new Date().toISOString(), online: navigator.onLine,
    }
    const report = [
      'Харитонов тим', 'Версия ' + buildVersion, 'Время ' + new Date(d.time).toLocaleString('ru-RU'),
      'Экран «' + d.screen + '»', 'Операция «' + d.operation + '»',
      'Сеть ' + (d.online ? 'подключена' : 'недоступна'), 'Код ' + d.code,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(report)
      setMessage('Скопировано')
      setFallback('')
    } catch {
      setFallback(report)
      setMessage('Выделите и скопируйте текст')
    }
  }
  return <div>
    <button type="button" className="btn small secondary" onClick={copy}>Скопировать сведения о сбое</button>
    {message && <small className="muted" role="status"> {message}</small>}
    {fallback && <textarea aria-label="Сведения о сбое" readOnly value={fallback} onFocus={(e) => e.currentTarget.select()} />}
  </div>
}

export function LoadError({ screen, cause, message, onRetry }: {
  screen: Screen; cause: unknown; message: string; onRetry: () => void
}) {
  useEffect(() => { recordFailure(screen, screen === 'Вход' ? 'Загрузка профиля' : 'Загрузка', cause) }, [screen, cause])
  return <div className="card">
    <p className="error" role="alert">{message}</p>
    <div className="row">
      <button className="btn" onClick={onRetry}>Повторить</button>
      <DiagnosticButton />
    </div>
  </div>
}
