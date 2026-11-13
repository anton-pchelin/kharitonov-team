// Видео подхода от атлета: до 60 с, больше 15 МБ — пережимаем в телефоне (480p, ~1,5 Мбит/с).
// Пока нет сети, файл ждёт в IndexedDB (в localStorage видео не помещается).

const MAX_SEC = 60
const MAX_BYTES = 15_000_000

export async function prepareVideo(file: File, onProgress?: (msg: string) => void): Promise<Blob> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.src = url
  v.muted = true
  v.playsInline = true
  try {
    await new Promise((ok, fail) => { v.onloadedmetadata = ok; v.onerror = () => fail(new Error('Не получилось открыть видео')) })
    if (!Number.isFinite(v.duration)) {
      // у записанного в браузере webm длительности в заголовке нет — перематываем в конец, браузер её досчитает
      v.currentTime = 1e9
      await new Promise((ok) => { v.ondurationchange = () => Number.isFinite(v.duration) && ok(null); setTimeout(ok, 3000) })
      v.currentTime = 0
    }
    if (v.duration > MAX_SEC + 1) throw new Error('Видео длиннее 60 секунд. Обрежьте его в галерее телефона и прикрепите снова.')
    if (file.size <= MAX_BYTES) return file
    const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => window.MediaRecorder?.isTypeSupported(m))
    if (!mime) throw new Error('Видео больше 15 МБ, а сжать его в этом браузере нельзя. Снимите в меньшем качестве.')
    onProgress?.('Сжимаю видео — это займёт столько же, сколько длится ролик…')
    const scale = Math.min(1, 480 / Math.min(v.videoWidth, v.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round((v.videoWidth * scale) / 2) * 2
    canvas.height = Math.round((v.videoHeight * scale) / 2) * 2
    const ctx = canvas.getContext('2d')!
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 1_500_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const done = new Promise((ok) => { rec.onstop = ok })
    rec.start(1000)
    await v.play()
    await new Promise<void>((ok) => {
      const draw = () => {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        if (v.ended) ok()
        else requestAnimationFrame(draw)
      }
      draw()
    })
    rec.stop()
    await done
    const out = new Blob(chunks, { type: mime.split(';')[0] })
    if (out.size > 20_000_000) throw new Error('Видео всё ещё слишком большое. Снимите покороче или в меньшем качестве.')
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const videoExt = (type: string) => (type.includes('webm') ? 'webm' : type.includes('quicktime') ? 'mov' : 'mp4')

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open('kt-videos', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('blobs')
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((ok, fail) => {
    const r = f(d.transaction('blobs', mode).objectStore('blobs'))
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
}
export const putBlob = (key: string, b: Blob) => tx('readwrite', (s) => s.put(b, key))
export const getBlob = (key: string) => tx<Blob | undefined>('readonly', (s) => s.get(key))
export const delBlob = (key: string) => tx('readwrite', (s) => s.delete(key))
