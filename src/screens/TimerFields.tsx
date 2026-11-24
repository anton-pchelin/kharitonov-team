import { blockCount, blockRest, customPhases, defaultTimer, emomSeconds, prepSeconds, restSeconds, roundCount, TIMER_KINDS, timeLimit, workSeconds, type TimerCfg } from '../lib/timer'

function TimerNumber({ label, value, min = 0, max, onChange }: {
  label: string; value: number; min?: number; max: number; onChange: (value: number) => void
}) {
  return <label>{label}
    <input type="number" inputMode="numeric" min={min} max={max} value={value}
      onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value)) || 0)))} />
  </label>
}

function Duration({ label, value, max, onChange }: {
  label: string; value: number; max: number; onChange: (value: number) => void
}) {
  const minutes = Math.floor(value / 60)
  const seconds = value % 60
  return <div className="row">
    <TimerNumber label={label + ' · минуты'} value={minutes} max={max} onChange={(m) => onChange(m * 60 + seconds)} />
    <TimerNumber label={label + ' · секунды'} value={seconds} max={59} onChange={(s) => onChange(minutes * 60 + s)} />
  </div>
}

export function TimerFields({ cfg, onChange }: { cfg?: TimerCfg | null; onChange: (cfg: TimerCfg | null) => void }) {
  const patch = (value: Partial<TimerCfg>) => { if (cfg) onChange({ ...cfg, ...value }) }
  const phases = cfg?.kind === 'intervals' ? customPhases(cfg) : []
  return <div className="timer-fields">
    <label>Таймер
      <select aria-label="Таймер" value={cfg?.kind ?? ''} onChange={(e) => onChange(e.target.value ? defaultTimer(e.target.value as TimerCfg['kind']) : null)}>
        <option value="">Без таймера</option>
        {TIMER_KINDS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select>
    </label>
    {cfg && <div className="timer-options">
      {cfg.kind === 'emom' && <Duration label="Интервал" value={emomSeconds(cfg)} max={60} onChange={(intervalSec) => patch({ intervalSec })} />}
      {cfg.kind === 'amrap' && <Duration label="Длительность" value={timeLimit(cfg)} max={180} onChange={(durationSec) => patch({ durationSec })} />}
      {cfg.kind === 'fortime' && <>
        <label className="switch"><input type="checkbox" checked={timeLimit(cfg) > 0} onChange={(e) => patch({ capSec: e.target.checked ? 600 : 0 })} /> Лимит времени</label>
        {timeLimit(cfg) > 0 && <Duration label="Лимит" value={timeLimit(cfg)} max={180} onChange={(capSec) => patch({ capSec: Math.max(1, capSec) })} />}
      </>}
      {cfg.kind === 'tabata' && <div className="row">
        <TimerNumber label="Работа · секунды" value={workSeconds(cfg)} min={1} max={3600} onChange={(work) => patch({ work })} />
        <TimerNumber label="Отдых · секунды" value={restSeconds(cfg)} max={3600} onChange={(rest) => patch({ rest })} />
      </div>}
      {cfg.kind === 'intervals' && <>
        {phases.map((p, i) => <div className="row" key={i}>
          <label>Отрезок {i + 1}
            <select value={p.phase} onChange={(e) => patch({ phases: phases.map((p, n) => n === i ? { ...p, phase: e.target.value as 'work' | 'rest' } : p) })}>
              <option value="work">Работа</option><option value="rest">Отдых</option>
            </select>
          </label>
          <TimerNumber label={'Секунды · отрезок ' + (i + 1)} value={p.seconds} min={1} max={3600}
            onChange={(seconds) => patch({ phases: phases.map((p, n) => n === i ? { ...p, seconds } : p) })} />
          <button type="button" className="link-btn" aria-label={'Удалить отрезок ' + (i + 1)} disabled={phases.length < 2}
            onClick={() => patch({ phases: phases.filter((_, n) => n !== i) })}>Удалить</button>
        </div>)}
        <button type="button" className="btn small secondary" disabled={phases.length >= 20}
          onClick={() => patch({ phases: [...phases, { phase: 'work', seconds: 30 }] })}>+ отрезок</button>
      </>}
      <div className="row">
        {cfg.kind !== 'amrap' && cfg.kind !== 'fortime' && <TimerNumber label="Раундов" value={roundCount(cfg)} min={1} max={100} onChange={(rounds) => patch({ rounds })} />}
        {cfg.kind !== 'fortime' && cfg.kind !== 'intervals' && <TimerNumber label="Блоков" value={blockCount(cfg)} min={1} max={20} onChange={(blocks) => patch({ blocks })} />}
        <TimerNumber label="Подготовка · секунды" value={prepSeconds(cfg)} max={60} onChange={(prepSec) => patch({ prepSec })} />
      </div>
      {cfg.kind !== 'fortime' && cfg.kind !== 'intervals' && blockCount(cfg) > 1 &&
        <Duration label="Отдых между блоками" value={blockRest(cfg)} max={60} onChange={(breakSec) => patch({ breakSec })} />}
    </div>}
  </div>
}
