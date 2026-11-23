import { afterEach, expect, it, vi } from 'vitest'
import { RequestTimeout, withDeadline } from './request'

afterEach(() => vi.useRealTimers())

it('возвращает результат в пределах общего срока и снимает таймер', async () => {
  vi.useFakeTimers()
  await expect(withDeadline(async () => 'получено')).resolves.toBe('получено')
  expect(vi.getTimerCount()).toBe(0)
})

it('через 20 секунд отменяет общую попытку, если запрос ещё ждёт', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const attempt = withDeadline((s) => {
    signal = s
    return new Promise(() => {})
  })
  const result = expect(attempt).rejects.toBeInstanceOf(RequestTimeout)
  await vi.advanceTimersByTimeAsync(19_999)
  expect(signal?.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(signal?.aborted).toBe(true)
  await result
})
