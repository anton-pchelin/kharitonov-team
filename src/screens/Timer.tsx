import { useEffect, useMemo, useRef, useState } from 'react'
import { createTimer, prepSeconds, readTimerSettings, timerLabel, type Cue, type TimerCfg, type TimerSettings, type TimerState } from '../lib/timer'
import { fmtTime } from '../lib/format'
import { Markup } from '../lib/markup'

type Saved = { start: number; rounds: number; finish?: number; pausedAt?: number; config?: string }

/** Насыщенный (прямоугольный) тон: в браузере громче системной громкости не сделать, поэтому не тихий синус. */
function tone(ctx: AudioContext | null, volume: number, freq: number, dur: number, delay = 0) {
  if (!ctx || volume <= 0) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  const t = ctx.currentTime + delay
  o.type = 'square'
  o.frequency.value = freq
  g.gain.setValueAtTime(0.35 * volume, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + dur)
}

const SAY: Partial<Record<Cue, string>> = { half: 'Половина', ten: '10 секунд', 5: 'пять', 4: 'четыре', 3: 'три', 2: 'два', 1: 'один' }
const ruVoice = () => (typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('ru')))

/** Один сигнал: голосом, если есть русский голос, иначе писки разной высоты. */
export function playCue(cue: Cue, s: TimerSettings, ctx: AudioContext | null) {
  if (s.vibrate) navigator.vibrate?.(cue === 'start' || cue === 'finish' ? [400, 100, 400] : cue === 'next' ? 250 : cue === 'half' || cue === 'ten' ? 200 : 80)
  if (s.sound === 'off') return
  if (cue === 'start' || cue === 'finish') return tone(ctx, s.volume, 440, 1.2)
  if (cue === 'next') return tone(ctx, s.volume, 880, 0.35)
  const voice = s.sound === 'voice' ? ruVoice() : undefined
  if (voice) {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(SAY[cue])
    u.voice = voice
    u.lang = voice.lang
    u.volume = s.volume
    u.rate = 1.1
    return speechSynthesis.speak(u)
  }
  // без голоса: «Половина» — три средних, «10 секунд» — два, 5…1 — один высокий
  const n = cue === 'half' ? 3 : cue === 'ten' ? 2 : 1
  for (let i = 0; i < n; i++) tone(ctx, s.volume, cue === 'half' ? 520 : cue === 'ten' ? 660 : 1040, 0.15, i * 0.22)
}

/** Большой экран таймера. Старт хранится в телефоне — после блокировки или перезапуска время верное. */
export function Timer({ id, cfg, title, task = '', onClose, onResult, manualResult = false }: {
  id: string; cfg: TimerCfg; title: string; task?: string; onClose: () => void
  onResult?: (r: { rounds?: number; time_sec?: number; done: boolean }) => void
  manualResult?: boolean
}) {
  const key = `timer:${id}`
  const clock = useMemo(() => createTimer(cfg), [cfg])
  const config = clock.signature
  const read = (): Saved | null => {
    try {
      const state: Saved | null = JSON.parse(localStorage.getItem(key) ?? 'null')
      return state && (!state.config || state.config === config) ? state : null
    } catch { return null }
  }
  const [saved, setSaved] = useState<Saved | null>(() => onResult ? read() : null)
  const [now, setNow] = useState(Date.now())
  const audio = useRef<AudioContext | null>(null)
  const last = useRef<string>('')
  const heard = useRef(-1)  // секунда последнего прозвучавшего сигнала
  const settings = useMemo(readTimerSettings, [])
  const cues = useMemo(() => clock.cues(settings), [clock, settings])
  const [sheet, setSheet] = useState(false)
  const [screenMaySleep, setScreenMaySleep] = useState(false)

  const save = (s: Saved | null) => {
    setSaved(s)
    if (!onResult) return
    if (s) localStorage.setItem(key, JSON.stringify(s))
    else localStorage.removeItem(key)
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [])

  const st: TimerState | null = saved ? clock.state((saved.finish ?? saved.pausedAt ?? now) - saved.start) : null
  const done = !!saved?.finish || st?.phase === 'done'
  const running = !!saved && !saved.pausedAt && !done

  useEffect(() => {
    if (!running) return
    let active = true
    let pending = false
    let lock: WakeLockSentinel | undefined
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || pending || (lock && !lock.released)) return
      pending = true
      try {
        const next = await navigator.wakeLock?.request('screen')
        if (!active) {
          await next?.release()
          return
        }
        lock = next
        setScreenMaySleep(!lock || lock.released)
        lock?.addEventListener('release', () => {
          if (active && document.visibilityState === 'visible') setScreenMaySleep(true)
        }, { once: true })
      } catch {
        if (active) setScreenMaySleep(true)
      } finally { pending = false }
    }
    void acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release().catch(() => {})
    }
  }, [running])

  // «3-2-1» перед стартом — короткие писки
  useEffect(() => {
    if (st?.phase !== 'countdown' || saved?.pausedAt) return
    const mark = String(st.left)
    if (mark === last.current) return
    last.current = mark
    if (settings.sound !== 'off') tone(audio.current, settings.volume, 880, 0.12)
    if (settings.vibrate) navigator.vibrate?.(60)
  })
  // сигналы по расписанию; отставшие больше чем на 2 с (экран был заблокирован, перезапуск) не догоняем
  useEffect(() => {
    if (!st || st.phase === 'countdown' || saved?.finish || saved?.pausedAt) return
    const t = st.elapsed
    const due = cues.filter(([at]) => at > heard.current && at <= t)
    if (!due.length) return
    const [at, cue] = due[due.length - 1]
    heard.current = at
    if (t - at < 2) playCue(cue, settings, audio.current)
  })

  const enableAudio = () => {
    if (typeof AudioContext !== 'undefined') {
      audio.current ??= new AudioContext()
      void audio.current.resume().catch(() => {})
    }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.speak(new SpeechSynthesisUtterance(''))  // iPhone: голос разрешается после нажатия
  }
  const start = () => {
    enableAudio()
    heard.current = -1
    last.current = ''
    const start = Date.now()
    setNow(start)
    save({ start, rounds: 0, config })
  }
  const result = () => {
    if (!saved || !st) return
    if (!manualResult) onResult?.({
      ...(cfg.kind === 'amrap' ? { rounds: saved.rounds } : {}),
      time_sec: Math.round(st.elapsed), done: true,
    })
    save(null)
    onClose()
  }

  return (
    <div className="timer" role="dialog" aria-label={`Таймер: ${title}`}>
      <div className="row-between">
        <b>{title} · {timerLabel(cfg)}</b>
        <button className="back" onClick={onClose} aria-label="Закрыть таймер">✕</button>
      </div>
      {running && screenMaySleep && <small className="muted">Телефон может погасить экран во время таймера</small>}
      <div className={'timer-face ' + (st?.phase ?? '') + (task && settings.view === 'sheet' ? ' large' : '')}>
        {!st && <span className="timer-big">{fmtTime(cfg.kind === 'fortime' ? 0 : clock.state(1000 * prepSeconds(cfg)).left)}</span>}
        {st?.phase === 'countdown' && <span className="timer-big">{st.left}</span>}
        {st && st.phase !== 'countdown' && (
          <>
            <span className="timer-phase">{done ? 'Готово' : saved?.pausedAt ? 'Пауза' : st.phase === 'rest' ? 'Отдых' : 'Работа'}</span>
            <span className="timer-big">{fmtTime(Math.max(0, Math.round(cfg.kind === 'fortime' ? st.elapsed : st.left)))}</span>
            {!!st.blocks && st.blocks > 1 && <span className="timer-phase">Блок {st.block} из {st.blocks}</span>}
            {st.round > 0 && <span className="timer-phase">Раунд {st.round} из {st.rounds}</span>}
          </>
        )}
      </div>
      {task && settings.view === 'under' && <div className="card timer-task"><b>Задание</b><Markup text={task} /></div>}
      {cfg.kind === 'amrap' && saved && <p className="timer-rounds">Кругов: <b>{saved.rounds}</b></p>}
      {!saved && <button className="btn timer-btn" onClick={start}>▶ Старт</button>}
      {saved && !saved.pausedAt && !done && cfg.kind === 'amrap' && st?.phase === 'work' && (
        <button className="btn timer-btn" onClick={() => save({ ...saved, rounds: saved.rounds + 1 })}>+ круг</button>
      )}
      {saved && !done && cfg.kind === 'fortime' && st?.phase === 'work' && (
        <button className="btn timer-btn" onClick={() => { playCue('finish', settings, audio.current); save({ ...saved, finish: saved.pausedAt ?? Date.now() }) }}>Финиш</button>
      )}
      {saved && !done && <button className="btn secondary" onClick={() => {
        const at = Date.now()
        setNow(at)
        if (saved.pausedAt) {
          enableAudio()
          save({ ...saved, start: saved.start + at - saved.pausedAt, pausedAt: undefined })
        } else {
          if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
          save({ ...saved, pausedAt: at })
        }
      }}>{saved.pausedAt ? 'Продолжить' : 'Пауза'}</button>}
      {saved && !done && !audio.current && settings.sound !== 'off' && typeof AudioContext !== 'undefined' &&
        <button className="btn secondary" onClick={enableAudio}>Включить звук</button>}
      {done && <button className="btn timer-btn" onClick={result}>{manualResult ? 'К результатам' : onResult ? 'Записать в задание' : 'Готово'}</button>}
      {saved && <button className="btn secondary" onClick={() => { if (confirm('Сбросить таймер?')) save(null) }}>Сбросить</button>}
      {task && settings.view === 'sheet' && (sheet
        ? <div className="timer-sheet card"><button className="btn secondary" onClick={() => setSheet(false)}>▼ Скрыть</button><b>Задание</b><Markup text={task} /></div>
        : <button className="btn secondary" onClick={() => setSheet(true)}>▲ Задание</button>)}
    </div>
  )
}
