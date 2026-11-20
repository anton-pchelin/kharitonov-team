import { useEffect, useMemo, useRef, useState } from 'react'
import { readTimerSettings, timerCues, timerLabel, timerState, type Cue, type TimerCfg, type TimerSettings, type TimerState } from '../lib/timer'
import { fmtTime } from '../lib/format'
import { Markup } from '../lib/markup'

type Saved = { start: number; rounds: number; finish?: number }

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
export function Timer({ id, cfg, title, task = '', onClose, onResult }: {
  id: string; cfg: TimerCfg; title: string; task?: string; onClose: () => void
  onResult: (r: { rounds?: number; time_sec?: number; done: boolean }) => void
}) {
  const key = `timer:${id}`
  const read = (): Saved | null => { try { return JSON.parse(localStorage.getItem(key) ?? '') } catch { return null } }
  const [saved, setSaved] = useState<Saved | null>(read)
  const [now, setNow] = useState(Date.now())
  const audio = useRef<AudioContext | null>(null)
  const last = useRef<string>('')
  const heard = useRef(-1)  // секунда последнего прозвучавшего сигнала
  const settings = useMemo(readTimerSettings, [])
  const cues = useMemo(() => timerCues(cfg, settings), [cfg, settings])
  const [sheet, setSheet] = useState(false)

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

  // «3-2-1» перед стартом — короткие писки
  useEffect(() => {
    if (st?.phase !== 'countdown') return
    const mark = String(st.left)
    if (mark === last.current) return
    last.current = mark
    if (settings.sound !== 'off') tone(audio.current, settings.volume, 880, 0.12)
    if (settings.vibrate) navigator.vibrate?.(60)
  })
  // сигналы по расписанию; отставшие больше чем на 2 с (экран был заблокирован, перезапуск) не догоняем
  useEffect(() => {
    if (!st || st.phase === 'countdown' || saved?.finish) return
    const t = st.elapsed
    const due = cues.filter(([at]) => at > heard.current && at <= t)
    if (!due.length) return
    const [at, cue] = due[due.length - 1]
    heard.current = at
    if (t - at < 2) playCue(cue, settings, audio.current)
  })

  const start = () => {
    audio.current ??= new AudioContext()  // звук разрешён только после нажатия
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.speak(new SpeechSynthesisUtterance(''))  // iPhone: голос тоже только после нажатия
    heard.current = -1
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
      <div className={'timer-face ' + (st?.phase ?? '') + (task && settings.view === 'sheet' ? ' large' : '')}>
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
      {task && settings.view === 'under' && <div className="card timer-task"><b>Задание</b><Markup text={task} /></div>}
      {cfg.kind === 'amrap' && saved && <p className="timer-rounds">Кругов: <b>{saved.rounds}</b></p>}
      {!saved && <button className="btn timer-btn" onClick={start}>▶ Старт</button>}
      {saved && !done && cfg.kind === 'amrap' && st?.phase === 'work' && (
        <button className="btn timer-btn" onClick={() => save({ ...saved, rounds: saved.rounds + 1 })}>+ круг</button>
      )}
      {saved && !done && cfg.kind === 'fortime' && st?.phase === 'work' && (
        <button className="btn timer-btn" onClick={() => { playCue('finish', settings, audio.current); save({ ...saved, finish: Date.now() }) }}>Финиш</button>
      )}
      {done && <button className="btn timer-btn" onClick={result}>Записать в задание</button>}
      {saved && <button className="btn secondary" onClick={() => { if (confirm('Сбросить таймер?')) save(null) }}>Сбросить</button>}
      {task && settings.view === 'sheet' && (sheet
        ? <div className="timer-sheet card"><button className="btn secondary" onClick={() => setSheet(false)}>▼ Скрыть</button><b>Задание</b><Markup text={task} /></div>
        : <button className="btn secondary" onClick={() => setSheet(true)}>▲ Задание</button>)}
    </div>
  )
}
