import { useEffect, useRef, useState } from 'react'
import { timerLabel, timerState, type TimerCfg, type TimerState } from '../lib/timer'
import { fmtTime } from '../lib/format'

type Saved = { start: number; rounds: number; finish?: number }

function beep(ctx: AudioContext | null, long = false) {
  if (!ctx) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.frequency.value = long ? 660 : 880
  g.gain.value = 0.2
  o.connect(g).connect(ctx.destination)
  o.start()
  o.stop(ctx.currentTime + (long ? 0.6 : 0.15))
}

/** Большой экран таймера. Старт хранится в телефоне — после блокировки или перезапуска время верное. */
export function Timer({ id, cfg, title, onClose, onResult }: {
  id: string; cfg: TimerCfg; title: string; onClose: () => void
  onResult: (r: { rounds?: number; time_sec?: number; done: boolean }) => void
}) {
  const key = `timer:${id}`
  const read = (): Saved | null => { try { return JSON.parse(localStorage.getItem(key) ?? '') } catch { return null } }
  const [saved, setSaved] = useState<Saved | null>(read)
  const [now, setNow] = useState(Date.now())
  const audio = useRef<AudioContext | null>(null)
  const last = useRef<string>('')

  const save = (s: Saved | null) => {
    setSaved(s)
    if (s) localStorage.setItem(key, JSON.stringify(s))
    else localStorage.removeItem(key)
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200)
    let lock: { release: () => Promise<void> } | null = null
    // экран не гаснет, пока открыт таймер
    ;(navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<typeof lock> } }).wakeLock?.request('screen')
      .then((l) => { lock = l }).catch(() => {})
    return () => { clearInterval(t); lock?.release().catch(() => {}) }
  }, [])

  const st: TimerState | null = saved ? timerState(cfg, (saved.finish ?? now) - saved.start) : null
  const done = !!saved?.finish || st?.phase === 'done'

  // звук и вибрация на смене фаз и на «3-2-1»
  useEffect(() => {
    if (!st) return
    const mark = `${st.phase}-${st.round}-${st.phase === 'countdown' ? st.left : ''}`
    if (mark === last.current) return
    const first = !last.current
    last.current = mark
    if (first) return
    beep(audio.current, st.phase !== 'countdown')
    navigator.vibrate?.(st.phase === 'countdown' ? 80 : st.phase === 'done' ? [300, 100, 300] : 250)
  })

  const start = () => {
    audio.current ??= new AudioContext()  // звук разрешён только после нажатия
    save({ start: Date.now(), rounds: 0 })
  }
  const result = () => {
    if (!saved || !st) return
    onResult(cfg.kind === 'amrap' ? { rounds: saved.rounds, done: true }
      : cfg.kind === 'fortime' ? { time_sec: Math.round(st.elapsed), done: true }
        : { done: true })
    save(null)
    onClose()
  }

  return (
    <div className="timer" role="dialog" aria-label={`Таймер: ${title}`}>
      <div className="row-between">
        <b>{title} · {timerLabel(cfg)}</b>
        <button className="back" onClick={onClose} aria-label="Закрыть таймер">✕</button>
      </div>
      <div className={'timer-face ' + (st?.phase ?? '')}>
        {!st && <span className="timer-big">{cfg.kind === 'tabata' ? `${cfg.work ?? 20}/${cfg.rest ?? 10}` : `${cfg.minutes ?? 10}:00`}</span>}
        {st?.phase === 'countdown' && <span className="timer-big">{st.left}</span>}
        {st && st.phase !== 'countdown' && (
          <>
            <span className="timer-phase">{done ? 'Готово' : st.phase === 'rest' ? 'Отдых' : 'Работа'}</span>
            <span className="timer-big">{fmtTime(Math.max(0, Math.round(cfg.kind === 'fortime' ? st.elapsed : st.left)))}</span>
            {st.rounds > 0 && <span className="timer-phase">Раунд {Math.min(st.round, st.rounds)} из {st.rounds}</span>}
          </>
        )}
      </div>
      {cfg.kind === 'amrap' && saved && <p className="timer-rounds">Кругов: <b>{saved.rounds}</b></p>}
      {!saved && <button className="btn timer-btn" onClick={start}>▶ Старт</button>}
      {saved && !done && cfg.kind === 'amrap' && st?.phase === 'work' && (
        <button className="btn timer-btn" onClick={() => save({ ...saved, rounds: saved.rounds + 1 })}>+ круг</button>
      )}
      {saved && !done && cfg.kind === 'fortime' && st?.phase === 'work' && (
        <button className="btn timer-btn" onClick={() => save({ ...saved, finish: Date.now() })}>Финиш</button>
      )}
      {done && <button className="btn timer-btn" onClick={result}>Записать в задание</button>}
      {saved && <button className="btn secondary" onClick={() => { if (confirm('Сбросить таймер?')) save(null) }}>Сбросить</button>}
    </div>
  )
}
