import { useState } from 'react'
import { fmtShort } from './dates'
import type { Point } from './progress'

type Series = { label: string; points: Point[]; muted?: boolean }

const W = 360
const H = 200
const PAD = { l: 40, r: 12, t: 12, b: 24 }

/** Линейный график по датам: одна ось, тонкие линии, подсказка при наведении/касании. Цвета — из темы. */
export function LineChart({ series, unit, format = (v) => String(v) }: { series: Series[]; unit: string; format?: (v: number) => string }) {
  const [hover, setHover] = useState<string | null>(null)
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort()
  const ys = series.flatMap((s) => s.points.map((p) => p.y))
  if (!dates.length) return <p className="muted">Пока нет данных.</p>
  let lo = Math.min(...ys)
  let hi = Math.max(...ys)
  if (lo === hi) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.1
  lo = Math.max(0, lo - pad)
  hi += pad
  const x = (d: string) => PAD.l + (dates.length === 1 ? (W - PAD.l - PAD.r) / 2 : (dates.indexOf(d) / (dates.length - 1)) * (W - PAD.l - PAD.r))
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
  const ticks = [lo, (lo + hi) / 2, hi]
  const hx = hover ? x(hover) : 0

  return (
    <figure className="chart">
      {series.length > 1 && (
        <figcaption className="legend">
          {series.map((s) => <span key={s.label}><i className={'swatch-line' + (s.muted ? ' muted-line' : '')} />{s.label}</span>)}
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`График: ${series.map((s) => s.label).join(', ')}`}
        onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{format(Math.round(t * 10) / 10)}</text>
          </g>
        ))}
        <text x={PAD.l} y={H - 8} className="tick">{fmtShort(dates[0])}</text>
        {dates.length > 1 && <text x={W - PAD.r} y={H - 8} textAnchor="end" className="tick">{fmtShort(dates[dates.length - 1])}</text>}
        {hover && <line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} className="crosshair" />}
        {series.map((s) => (
          <g key={s.label} className={s.muted ? 'series muted-line' : 'series'}>
            <polyline points={s.points.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')} />
            {s.points.map((p) => <circle key={p.x} cx={x(p.x)} cy={y(p.y)} r={hover === p.x ? 6 : 4} />)}
          </g>
        ))}
        {dates.map((d) => (
          // широкие невидимые полосы — попадать пальцем легче, чем в точку
          <rect key={d} x={x(d) - 20} y={0} width={40} height={H} fill="transparent" onPointerEnter={() => setHover(d)} onClick={() => setHover(d)} />
        ))}
      </svg>
      {hover && (
        <div className="chart-tip">
          <b>{fmtShort(hover)}</b>
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hover)
            return p && <span key={s.label}>{s.label}: {format(p.y)} {unit}</span>
          })}
        </div>
      )}
    </figure>
  )
}
