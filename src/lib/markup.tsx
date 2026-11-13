import { Fragment, type ReactNode } from 'react'

// Простая разметка текста плана: **жирный**, *курсив*, строки «- » — список.
// Без innerHTML: текст пишет тренер, но показывается атлету.

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b>
      : part.startsWith('*') && part.endsWith('*') && part.length > 2 ? <i key={i}>{part.slice(1, -1)}</i>
        : <Fragment key={i}>{part}</Fragment>,
  )
}

export function Markup({ text }: { text: string }) {
  if (!text.trim()) return null
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
    list = []
  }
  for (const line of text.split('\n')) {
    if (/^\s*[-•]\s+/.test(line)) list.push(line.replace(/^\s*[-•]\s+/, ''))
    else {
      flush()
      if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>)
    }
  }
  flush()
  return <div className="markup">{blocks}</div>
}
