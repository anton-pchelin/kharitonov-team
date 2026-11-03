import { useEffect, useState } from 'react'

type InstallEvent = Event & { prompt: () => Promise<void> }

// Событие приходит один раз и рано — ловим его до отрисовки экранов.
let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as InstallEvent
  listeners.forEach((f) => f())
})

const standalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** «Добавить на экран Домой»: кнопка на Android, подсказка на iPhone. */
export function InstallHint() {
  const [, rerender] = useState(0)
  useEffect(() => {
    const f = () => rerender((n) => n + 1)
    listeners.add(f)
    return () => { listeners.delete(f) }
  }, [])

  if (standalone()) return null
  if (deferred) {
    return (
      <button className="btn secondary" onClick={() => { deferred?.prompt(); deferred = null; rerender((n) => n + 1) }}>
        Добавить на экран Домой
      </button>
    )
  }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  return (
    <p className="note">
      {ios
        ? 'Чтобы открывать как приложение: в Safari нажмите «Поделиться» → «На экран „Домой“».'
        : 'Чтобы открывать как приложение: меню браузера → «Добавить на главный экран».'}
    </p>
  )
}
