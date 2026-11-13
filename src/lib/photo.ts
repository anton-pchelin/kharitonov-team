/** Сжать фото в телефоне до JPEG не больше maxBytes (по умолчанию ~300 КБ — бесплатное хранилище 1 ГБ). */
export async function compressImage(file: File, maxBytes = 300_000, maxSide = 1280): Promise<Blob> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  let w = Math.round(img.width * scale)
  let h = Math.round(img.height * scale)
  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q))
      if (blob && blob.size <= maxBytes) return blob
    }
    w = Math.round(w * 0.8)
    h = Math.round(h * 0.8)
  }
  throw new Error('Не получилось сжать фото')
}
