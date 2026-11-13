import { useState } from 'react'
import { isVideoUrl } from '../search'

/** Адрес плеера для встраивания: YouTube, Rutube, VK Видео. Не узнали — null (покажем ссылкой). */
export function embedUrl(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.replace(/^www\.|^m\./, '')
  if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`
  if (host === 'youtube.com') {
    const id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1]
    return id ? `https://www.youtube.com/embed/${id}` : null
  }
  if (host === 'rutube.ru') {
    const id = u.pathname.match(/^\/(?:video|play\/embed|shorts)\/([\w]+)/)?.[1]
    return id ? `https://rutube.ru/play/embed/${id}` : null
  }
  if (host === 'vk.com' || host === 'vkvideo.ru' || host === 'vk.ru') {
    const m = (u.searchParams.get('z') ?? u.pathname).match(/video(-?\d+)_(\d+)/)
    return m ? `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}` : null
  }
  return null
}

/** Кнопка «▶ видео»: плеер открывается по нажатию, чтобы не грузить его зря. */
export function Video({ url }: { url: string | null }) {
  const [open, setOpen] = useState(false)
  if (!url || !isVideoUrl(url)) return null
  const embed = embedUrl(url)
  if (!embed) return <a className="video-link" href={url} target="_blank" rel="noreferrer">▶ видео</a>
  if (!navigator.onLine && !open) return <span className="muted">▶ видео — нужен интернет</span>
  return open
    ? <div className="video-frame"><iframe src={embed} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title="видео" /></div>
    : <button type="button" className="video-link" onClick={() => setOpen(true)}>▶ видео</button>
}
