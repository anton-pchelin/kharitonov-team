import { useEffect, useState } from 'react'

export function useAppUpdate() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    const workers = navigator.serviceWorker
    let controller = workers.controller
    const onController = () => {
      if (controller && workers.controller && controller !== workers.controller) setAvailable(true)
      controller = workers.controller
    }
    let registration: ServiceWorkerRegistration | undefined
    let checking = false
    const check = async () => {
      if (checking || !navigator.onLine || document.visibilityState !== 'visible') return
      checking = true
      try {
        registration ??= await workers.register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' })
        await registration.update()
      } catch {
        // Проверим снова при возвращении в приложение или при восстановлении сети.
      } finally {
        checking = false
      }
    }

    workers.addEventListener('controllerchange', onController)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    void check()
    return () => {
      workers.removeEventListener('controllerchange', onController)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
    }
  }, [])

  return available
}
