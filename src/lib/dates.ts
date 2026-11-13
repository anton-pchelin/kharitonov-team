// Даты тренировок — строки 'ГГГГ-ММ-ДД' в местном времени (без часовых сдвигов UTC).

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseIso = (s: string) => new Date(s + 'T00:00:00')
export const today = () => iso(new Date())

export function addDays(s: string, n: number): string {
  const d = parseIso(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}

export const mondayOf = (s: string) => addDays(s, -((parseIso(s).getDay() + 6) % 7))
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i))

export const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const dayShort = (s: string) => DAY_SHORT[(parseIso(s).getDay() + 6) % 7]
export const fmtDay = (s: string) =>
  new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }).format(parseIso(s))
export const fmtShort = (s: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(parseIso(s))
