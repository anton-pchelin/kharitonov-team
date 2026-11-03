# Kharitonov team — трекер тренировок

Веб-приложение (PWA) для тренера и его атлетов, замена TRNR. Интерфейс по-русски, рассчитан на телефон.
План и задания по этапам — `задания/трекер_тренировок/` (`ПЛАН.md`, `этап_N.md`); папка только локальная, в git не входит (репозиторий публичный). Ветка этапа — `task-trekker-N`.

## Карта проекта

| Путь | Что там |
|---|---|
| `src/App.tsx` | Вход в приложение: сессия, профиль, приглашение по ссылке, вкладки, маршруты `#/…`, лого |
| `src/screens/` | Экраны: `Login` (email + код), `Athletes` (список, «Пригласить»), `AthleteCard` (анкета атлета + заметка тренера), `MyProfile` (анкета атлета, имя при первом входе), `Exercises` (каталог, поиск, правка), `Settings` (тема, палитры, выход), `InstallHint` («Добавить на экран Домой») |
| `src/theme.ts` | 16 палитр и правило вычисления цветов (ПЛАН.md п. 9). Экраны берут цвета **только** из CSS-переменных `--primary --on-primary --secondary --on-secondary --bg --text --card --done-bg --muted --line` |
| `src/search.ts` | Поиск упражнений (все слова запроса, ё=е, по русскому и английскому названию), проверка ссылки на видео |
| `src/supabase.ts` | Клиент Supabase и тип `Profile` |
| `src/styles.css` | Общие стили: кнопки `.btn`/`.btn.secondary`, `.card`, скругление 16px |
| `src/logic.test.ts` | Тесты (vitest): палитры, поиск «присед»/«жим лёжа» |
| `supabase/migrations/` | Схема базы и правила доступа (RLS). Новый этап — новый файл миграции, старые не править |
| `supabase/seed.sql` | 876 упражнений; **генерируется** `npm run exercises`, руками не править |
| `data/exercises-ru.txt` | Русские названия упражнений, строка `English | Русское` — править здесь |
| `scripts/build-exercises.mjs` | Скачивает free-exercise-db и собирает `seed.sql`; там же словари мышц и оборудования |
| `public/icons/` | Иконки приложения (жёлтый квадрат «KT») |
| `.github/workflows/deploy.yml` | Сборка, тесты и выкладка на GitHub Pages |

## Данные и доступ (Supabase)

- `profiles` — человек (роль `coach`/`athlete`, анкета, тема и палитра). Создаётся триггером при первом входе; роль «тренер» — если email есть в `coach_emails`.
- `coach_athletes` — связь тренер—атлет (у атлета один тренер) + `note`, заметка тренера (атлету не видна).
- `invites` — ссылки-приглашения (одноразовые, 7 дней). Принимаются функцией `accept_invite(token)`.
- `athlete_groups`, `group_members` — группы (интерфейс — этап 6).
- `exercises` — база упражнений (`source`: base/coach/athlete).
- Права: атлет видит свой профиль и профиль своего тренера; тренер — свой и своих атлетов. Роль и email сам себе не поменять (права на столбцы). Проверять права — запросом под атлетом, не только глазами в интерфейсе.

## Как запустить

```bash
npm install
cp .env.example .env.local   # вписать адрес и anon-ключ Supabase
npm run dev                  # http://localhost:5173
npm test
npm run build                # проверка типов + сборка в dist/
```

## Настройки (где что лежит)

- `.env.local` (не в git): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Для выкладки те же два значения — в GitHub: Settings → Secrets and variables → Actions → **Variables**.
- Supabase, панель проекта:
  - Authentication → Sign In / Providers → Email: включён, «Confirm email» включён; длина кода 6.
  - Authentication → Emails → Templates → **Magic Link**: в письме должен быть код `{{ .Token }}` (вход по коду, не по ссылке).
  - Authentication → Emails → SMTP Settings: бесплатный почтовый сервис (Resend / Brevo / Яндекс), не встроенная почта.
  - Authentication → URL Configuration → Site URL: адрес сайта на GitHub Pages.
  - Email тренера: SQL Editor → `insert into coach_emails values ('адрес');` — **до** первого входа тренера.
- Секреты (пароль SMTP, ключ service_role, пароль базы) — только в панели Supabase, никогда в коде и в git.

## Как выкладывать

- Сайт: push в `main` или `task-trekker-*` → GitHub Actions собирает и выкладывает на GitHub Pages.
- База: `npx supabase login` (один раз), `npx supabase link --project-ref <ref>`, затем `npx supabase db push` (новые миграции) и при первой загрузке упражнений `npx supabase db push --include-seed`.
- Новые русские названия: поправить `data/exercises-ru.txt` → `npm run exercises`. Уже загруженные упражнения seed не перезаписывает — правку в базе делать в приложении или SQL.

## Правила

- Видео и тексты TRNR не использовать. База упражнений — free-exercise-db (Unlicense), картинки грузятся с yuhonas.github.io.
- Маршруты — через `#/…` (GitHub Pages не умеет отдавать index.html на любой путь).
- Крупные кнопки (≥ 48 px), всё одной рукой на телефоне.
