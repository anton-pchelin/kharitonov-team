/** «72,5» и «72.5» → 72.5; пусто или не число → null. */
export function parseNum(s: string): number | null {
  const v = s.trim().replace(',', '.')
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** «28:30» → 1710, «1:02:03» → 3723, «90» → 90 секунд. */
export function parseTime(s: string): number | null {
  const parts = s.trim().split(':')
  if (!s.trim() || parts.some((p) => !/^\d+$/.test(p)) || parts.length > 3) return null
  return parts.reduce((sum, p) => sum * 60 + Number(p), 0)
}

export function fmtTime(sec: number | null | undefined): string {
  if (sec == null) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = String(sec % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export const fmtNum = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
