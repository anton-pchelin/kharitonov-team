// Собирает supabase/seed.sql из открытой базы free-exercise-db (Unlicense) и русских названий
// из data/exercises-ru.txt (строка «английское | русское», правится руками).
// Запуск: npm run exercises
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
const IMG = 'https://yuhonas.github.io/free-exercise-db/exercises/'

const MUSCLES = {
  abdominals: 'пресс', abductors: 'отводящие мышцы бедра', adductors: 'приводящие мышцы бедра',
  biceps: 'бицепс', calves: 'икры', chest: 'грудь', forearms: 'предплечья', glutes: 'ягодицы',
  hamstrings: 'задняя поверхность бедра', lats: 'широчайшие', 'lower back': 'поясница',
  'middle back': 'середина спины', neck: 'шея', quadriceps: 'квадрицепс', shoulders: 'плечи',
  traps: 'трапеции', triceps: 'трицепс',
}
const EQUIPMENT = {
  'body only': 'свой вес', machine: 'тренажёр', other: 'другое', 'foam roll': 'ролик',
  kettlebells: 'гиря', dumbbell: 'гантели', cable: 'блок', barbell: 'штанга', bands: 'резина',
  'medicine ball': 'медбол', 'exercise ball': 'фитбол', 'e-z curl bar': 'EZ-гриф',
}

const ru = new Map(
  readFileSync('data/exercises-ru.txt', 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => l.split(' | ').map((s) => s.trim())),
)
const list = await (await fetch(SRC)).json()

const q = (s) => (s == null ? 'null' : `'${String(s).replaceAll("'", "''")}'`)
const arr = (a) => `array[${a.map(q).join(', ')}]::text[]`
const tr = (dict, v) => {
  if (!(v in dict)) throw new Error(`Нет перевода для «${v}»`)
  return dict[v]
}

const missing = list.filter((e) => !ru.get(e.name))
if (missing.length) throw new Error(`Нет русского названия: ${missing.map((e) => e.name).join(', ')}`)

const rows = list.map((e) => `(${[
  q(e.id),
  q(ru.get(e.name)),
  arr([e.name]),  // английское — в «других названиях», чтобы искалось и так
  arr(e.primaryMuscles.map((m) => tr(MUSCLES, m))),
  q(e.equipment ? tr(EQUIPMENT, e.equipment) : null),
  q(e.images[0] ? IMG + e.images[0] : null),
  q('base'),
].join(', ')})`)

writeFileSync('supabase/seed.sql', `-- Сгенерировано scripts/build-exercises.mjs, руками не править.
-- Повторный запуск не трогает уже загруженные (и, возможно, исправленные тренером) упражнения.
insert into public.exercises (source_id, name, aliases, muscles, equipment, image_url, source) values
${rows.join(',\n')}
on conflict (source_id) do nothing;
`)
console.log(`supabase/seed.sql: ${rows.length} упражнений`)
