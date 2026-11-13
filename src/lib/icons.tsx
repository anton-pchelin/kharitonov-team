// Линейные иконки 24×24 для бокового меню и вкладок (в духе SF Symbols), цвет — currentColor.
const PATHS = {
  feed: 'M4 6h16M4 12h16M4 18h10',
  athletes: 'M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.9M15 4.1a3 3 0 0 1 0 5.8',
  plan: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4',
  exercises: 'M6.5 8v8M3.5 10v4M17.5 8v8M20.5 10v4M6.5 12h11',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  today: 'M8.5 12.5l2.5 2.5 4.5-5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',
  progress: 'M4 20h16M5 16l4-4.5 3.5 3L19 7',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 20a8 8 0 0 1 16 0',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.5 3.3c.4.5.5 1 .5 1.4 0 .7-1 1.3-3 1.3M7.5 11.5h0M10 7.5h0M14.5 7.5h0',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  dumbbell: 'M6.5 8v8M3.5 10v4M17.5 8v8M20.5 10v4M6.5 12h11',
  disk: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  app: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  )
}
