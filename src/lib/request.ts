export class RequestTimeout extends Error {
  readonly code = 'TIMEOUT'
}

export async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms = 20_000): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new RequestTimeout('Сервер не ответил вовремя'))
          controller.abort()
        }, ms)
      }),
      run(controller.signal),
    ])
  } finally {
    clearTimeout(timer)
  }
}
