import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { isVideoUrl, searchExercises, type Exercise } from '../search'

const PAGE = 1000  // столько строк Supabase отдаёт за один запрос
const SHOW = 40

const CACHE_KEY = 'exercises:v1'

/** Вся база упражнений; копия лежит в телефоне — без сети отдаём её. */
export async function loadExercises(): Promise<Exercise[]> {
  try {
    const all: Exercise[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, aliases, muscles, equipment, image_url, video_url, source')
        .order('name')
        .range(from, from + PAGE - 1)
      if (error) throw error
      all.push(...(data as Exercise[]))
      if (data.length < PAGE) break
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)) } catch { /* места нет — обойдёмся без копии */ }
    return all
  } catch (e) {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) return JSON.parse(cached) as Exercise[]
    throw e
  }
}

const uniq = (a: (string | null)[]) => [...new Set(a.filter((x): x is string => !!x))].sort((x, y) => x.localeCompare(y, 'ru'))

/** Каталог упражнений: поиск по-русски (и по-английски), фильтры, карточка, правка тренером. */
export function Exercises({ canEdit }: { canEdit: boolean }) {
  const [list, setList] = useState<Exercise[] | null>(null)
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState('')
  const [equipment, setEquipment] = useState('')
  const [limit, setLimit] = useState(SHOW)
  const [open, setOpen] = useState<Exercise | 'new' | null>(null)

  useEffect(() => {
    loadExercises().then(setList, (e) => { alert('Не загрузилось: ' + e.message); setList([]) })
  }, [])

  const muscles = useMemo(() => uniq((list ?? []).flatMap((e) => e.muscles)), [list])
  const equipments = useMemo(() => uniq((list ?? []).map((e) => e.equipment)), [list])
  const found = useMemo(() => searchExercises(list ?? [], q, muscle, equipment), [list, q, muscle, equipment])

  const saved = (e: Exercise) => {
    setList((l) => [e, ...(l ?? []).filter((x) => x.id !== e.id)])
    setOpen(e)
  }

  if (open) return <ExerciseCard ex={open === 'new' ? null : open} canEdit={canEdit} muscles={muscles} equipments={equipments} onBack={() => setOpen(null)} onSaved={saved} />

  return (
    <>
      <div className="row-between">
        <h2>Упражнения {list && <span className="muted">· {found.length}</span>}</h2>
        {canEdit && <button className="btn small" onClick={() => setOpen('new')}>+ Своё</button>}
      </div>
      <input type="search" placeholder="Поиск: присед, жим лёжа…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(SHOW) }} />
      <div className="row">
        <select value={muscle} onChange={(e) => { setMuscle(e.target.value); setLimit(SHOW) }} aria-label="Группа мышц">
          <option value="">Все мышцы</option>
          {muscles.map((m) => <option key={m}>{m}</option>)}
        </select>
        <select value={equipment} onChange={(e) => { setEquipment(e.target.value); setLimit(SHOW) }} aria-label="Оборудование">
          <option value="">Любое оборудование</option>
          {equipments.map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>
      {list === null && <p className="muted">Загрузка…</p>}
      {list && found.length === 0 && <p className="muted">Ничего не нашлось.</p>}
      <div className="ex-list">
        {found.slice(0, limit).map((e) => (
          <button key={e.id} className="card ex-item" onClick={() => setOpen(e)}>
            {e.image_url ? <img src={e.image_url} alt="" loading="lazy" /> : <span className="ex-noimg">KT</span>}
            <span>
              <b>{e.name}</b>
              <span className="muted">{[e.muscles.join(', '), e.equipment].filter(Boolean).join(' · ')}</span>
            </span>
          </button>
        ))}
      </div>
      {found.length > limit && <button className="btn secondary" onClick={() => setLimit(limit + SHOW)}>Показать ещё</button>}
    </>
  )
}

function ExerciseCard({ ex, canEdit, muscles, equipments, onBack, onSaved }: {
  ex: Exercise | null; canEdit: boolean; muscles: string[]; equipments: string[]
  onBack: () => void; onSaved: (e: Exercise) => void
}) {
  const [editing, setEditing] = useState(!ex)
  const [name, setName] = useState(ex?.name ?? '')
  const [video, setVideo] = useState(ex?.video_url ?? '')
  const [muscle, setMuscle] = useState(ex?.muscles[0] ?? '')
  const [equipment, setEquipment] = useState(ex?.equipment ?? '')
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = video.trim()
    if (v && !isVideoUrl(v)) return setError('Ссылка на видео должна начинаться с https://')
    // старое название остаётся в «других названиях», чтобы находилось и по нему
    const aliases = ex && ex.name !== name.trim() ? [...new Set([...ex.aliases, ex.name])] : ex?.aliases ?? []
    const row = { name: name.trim(), video_url: v || null, aliases, muscles: ex && muscle === (ex.muscles[0] ?? '') ? ex.muscles : muscle ? [muscle] : [], equipment: equipment || null }
    const { data, error } = ex
      ? await supabase.from('exercises').update(row).eq('id', ex.id).select().single()
      : await supabase.from('exercises').insert({ ...row, source: 'coach' }).select().single()
    if (error) return setError('Не сохранилось: ' + error.message)
    setEditing(false)
    onSaved(data as Exercise)
  }

  const removeImage = async () => {
    if (!ex || !confirm('Убрать картинку у этого упражнения? У всех атлетов она тоже пропадёт.')) return
    const { data, error } = await supabase.from('exercises').update({ image_url: null }).eq('id', ex.id).select().single()
    if (error) return setError('Не получилось: ' + error.message)
    onSaved(data as Exercise)
  }

  return (
    <>
      <button className="back" onClick={onBack}>← Упражнения</button>
      {ex?.image_url && <img className="ex-big" src={ex.image_url} alt={ex.name} />}
      {!editing && ex && (
        <>
          <h2>{ex.name}</h2>
          <div className="card">
            <div className="field"><span className="muted">Мышцы</span><span>{ex.muscles.join(', ') || '—'}</span></div>
            <div className="field"><span className="muted">Оборудование</span><span>{ex.equipment || '—'}</span></div>
            {ex.aliases.length > 0 && <div className="field"><span className="muted">Другие названия</span><span>{ex.aliases.join(', ')}</span></div>}
          </div>
          {ex.video_url && isVideoUrl(ex.video_url) && (
            <a className="btn" href={ex.video_url} target="_blank" rel="noreferrer">▶ Смотреть видео</a>
          )}
          {canEdit && <button className="btn secondary" onClick={() => setEditing(true)}>Изменить название или видео</button>}
          {canEdit && ex.image_url && <button className="btn secondary" onClick={removeImage}>Убрать картинку</button>}
          {error && <p className="error">{error}</p>}
        </>
      )}
      {editing && (
        <form onSubmit={submit}>
          <h2>{ex ? 'Правка упражнения' : 'Новое упражнение'}</h2>
          <label>Название<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Ссылка на видео (YouTube, Rutube, VK Видео)
            <input type="url" inputMode="url" placeholder="https://" value={video} onChange={(e) => setVideo(e.target.value)} />
          </label>
          <label>Группа мышц
            <select value={muscle} onChange={(e) => setMuscle(e.target.value)}>
              <option value="">—</option>
              {muscles.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label>Оборудование
            <select value={equipment} onChange={(e) => setEquipment(e.target.value)}>
              <option value="">—</option>
              {equipments.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn">Сохранить</button>
          {ex && <button type="button" className="btn secondary" onClick={() => setEditing(false)}>Отмена</button>}
        </form>
      )}
    </>
  )
}
