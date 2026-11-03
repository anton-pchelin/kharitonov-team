// Палитры и тема (ПЛАН.md п. 9). Палитра — 6 цветов, остальное вычисляется смешиванием.
// Экраны берут цвета только из CSS-переменных: --primary, --on-primary, --secondary, --on-secondary,
// --bg, --text, --card, --done-bg, --muted, --line.

export type ThemeMode = 'light' | 'dark' | 'system'
// [основной, текст на основном, второй, текст на втором, фон, текст]
type Palette = [string, string, string, string, string, string]

export const PALETTES: Record<string, Palette> = {
  'TRNR': ['#FFD43B', '#1A1A1A', '#EDEDED', '#333333', '#FAFAFA', '#212121'],
  'TRNR мягкий': ['#FFE38A', '#4A3A00', '#E8E4DA', '#4A4334', '#FFFDF6', '#3A3526'],
  'Мята': ['#8FD3B6', '#1F4A3A', '#FFD9C2', '#6B3A1F', '#F6FBF8', '#2F4A3F'],
  'Лаванда': ['#BCAEF0', '#2E2560', '#F8CFE0', '#6A2343', '#F8F6FD', '#3A3358'],
  'Небо': ['#9CCAF0', '#163A5C', '#F9E9A6', '#5C4A0E', '#F4F8FD', '#23405C'],
  'Коралл': ['#F5B4A0', '#5A2414', '#CDE3D6', '#24493A', '#FFF8F4', '#5A3326'],
  'Шалфей': ['#B3CDA9', '#2A3D24', '#EEDDBE', '#5A431C', '#F7F8F3', '#34402F'],
  'Сирень': ['#D2B8EC', '#3D2463', '#BDE8D6', '#1E4A3A', '#FAF6FD', '#3F2F55'],
  'Голубика': ['#A9B8F2', '#1E2C66', '#F5E6C8', '#5C4520', '#F7F8FE', '#2C3560'],
  'Абрикос': ['#FFC79A', '#5E3110', '#C3E1F5', '#163F5C', '#FFF9F3', '#5A3A22'],
  'Зефир': ['#F7B9CF', '#5E1E37', '#D9CCF5', '#3A2C66', '#FFF7FA', '#5A2E40'],
  'Бирюза': ['#94DCD6', '#11433F', '#FFC2B3', '#6A2716', '#F4FBFA', '#1F4744'],
  'Волна': ['#9FD8E8', '#123F4D', '#D6F0C4', '#2C4A17', '#F3FAFC', '#1F4250'],
  'Мокко': ['#D9BFA6', '#4A2F17', '#C9D8C3', '#2D4228', '#FBF8F4', '#4A3828'],
  'Персик': ['#FFC4A8', '#5E2A12', '#D8CCF2', '#352866', '#FFF8F5', '#553326'],
  'Ваниль': ['#F3E3B5', '#4A3D12', '#D5D9E0', '#2E3440', '#FBFAF6', '#2E3440'],
}
export const DEFAULT_PALETTE = 'TRNR'

/** a·share + b·(1−share), цвета в виде #RRGGBB */
export function mix(a: string, share: number, b: string): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2]
    .map((i) => Math.round(ch(a, i) * share + ch(b, i) * (1 - share)).toString(16).padStart(2, '0'))
    .join('').toUpperCase()
}

export function themeVars(paletteName: string, dark: boolean): Record<string, string> {
  const [primary, onPrimary, secondary, onSecondary, bg, text] = PALETTES[paletteName] ?? PALETTES[DEFAULT_PALETTE]
  if (!dark) {
    return {
      '--primary': primary, '--on-primary': onPrimary,
      '--secondary': secondary, '--on-secondary': onSecondary,
      '--bg': bg, '--text': text, '--card': '#FFFFFF',
      '--done-bg': mix(primary, 0.28, '#FFFFFF'),
      '--muted': mix(text, 0.55, '#FFFFFF'),
      '--line': mix(text, 0.13, '#FFFFFF'),
    }
  }
  const darkBg = mix(text, 0.28, '#000000')
  return {
    '--primary': primary, '--on-primary': onPrimary,
    '--secondary': mix(secondary, 0.38, '#000000'), '--on-secondary': secondary,
    // текст в тёмной теме — светлый фон палитры
    '--bg': darkBg, '--text': bg, '--card': mix('#FFFFFF', 0.06, darkBg),
    '--done-bg': mix(primary, 0.22, darkBg),
    '--muted': mix(bg, 0.55, darkBg),
    '--line': mix(bg, 0.13, darkBg),
  }
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

export function applyTheme(paletteName: string, mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && darkQuery().matches)
  const root = document.documentElement
  for (const [k, v] of Object.entries(themeVars(paletteName, dark))) root.style.setProperty(k, v)
  root.style.colorScheme = dark ? 'dark' : 'light'
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? themeVars(paletteName, true)['--bg'] : '#FFFFFF')
}

/** Перекрашивать при смене темы телефона, пока выбрано «Как в телефоне». */
export function watchSystemTheme(onChange: () => void) {
  const q = darkQuery()
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}
