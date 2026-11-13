# Kharitonov team — трекер тренировок

Веб-приложение (PWA) для тренера и его атлетов, замена TRNR. Интерфейс по-русски, рассчитан на телефон.
План и задания по этапам — `задания/трекер_тренировок/` (`ПЛАН.md`, `этап_N.md`); папка только локальная, в git не входит (репозиторий публичный). Ветка этапа — `task-trekker-N`.

## Карта проекта

| Путь | Что там |
|---|---|
| `src/App.tsx` | Вход в приложение: сессия, профиль, приглашение по ссылке, вкладки, маршруты `#/…`, лого. Тренер: Лента · Атлеты · План · Упражнения · Настройки; атлет: Тренировки · Прогресс · Упражнения · Настройки |
| `src/screens/` | Экраны: `Login` (вход через Telegram; входа по email нет — решено 2026-11-13), `Athletes` (список с % выполнения, «Пригласить», группы), `AthleteCard` (анкета, заметка тренера, видимость плана), `MyProfile` (анкета атлета), `Exercises` (каталог, правка, «лучше меньше», объединение), `Settings` (тема, палитры, уведомления, гриф и блины, место в хранилище), `InstallHint` |
| `src/screens/Plan.tsx` | Тренер: неделя атлета таблицей, карточки (перетаскивание между днями, меню: копировать, перенести, шаблон, результаты), «Копировать неделю», «Назначить программу», «Отправить напоминания сейчас» |
| `src/screens/WorkoutEditor.tsx` | Редактор тренировки: поиск «история · шаблоны · база», суперсеты, перетаскивание заданий, % от 1ПМ, таймер; режим дня программы (`save`) |
| `src/screens/WeekTools.tsx`, `Programs.tsx` | Копирование недели, назначение программы (атлетам/группам, «добавить/заменить/пропустить»); программы N недель × 7 дней и шаблоны тренировок |
| `src/screens/Today.tsx` | Атлет: «Тренировки» по дням — ввод подходов, свои упражнения и тренировки, видео, таймер, «Завершить». Работает без сети |
| `src/screens/WorkoutView.tsx` | Тренировка «Списком» (у атлета с вводом, у тренера чтение + ответы): подходы, 🏆, % от 1ПМ, калькулятор блинов 🏋, комментарии с видео |
| `src/screens/Progress.tsx` | Прогресс: графики по упражнению, рекорды (авто и вручную), замеры, фото «до/после», регулярность |
| `src/screens/Feed.tsx` | Тренер: лента за 2 недели — выполнил / своё / пропустил, «ждут ответа», «просмотрено» |
| `src/screens/Timer.tsx` | Таймер комплекса на весь экран (АМРАП, EMOM, на время, табата): звук, вибрация, экран не гаснет |
| `src/lib/offline.ts` | Атлет без сети: данные ±2 недели в localStorage, очередь действий (`Op`), отправка при появлении сети, «прошлый раз» |
| `src/lib/` (прочее) | `dates` (даты 'ГГГГ-ММ-ДД' по местному времени), `workout` (типы, нумерация 3А/3Б), `progress` (Эпли, рекорды, % от максимума), `timer`, `plates`, `format` (запятая, мм:сс), `markup` (**жирный**/*курсив*/списки), `video` (плеер Rutube/VK/YouTube), `videoUpload` (сжатие, IndexedDB), `photo` (сжатие ≤300 КБ), `LineChart` |
| `src/theme.ts` | 16 палитр и правило вычисления цветов (ПЛАН.md п. 9). Экраны берут цвета **только** из CSS-переменных `--primary --on-primary --secondary --on-secondary --bg --text --card --done-bg --muted --line` |
| `src/search.ts` | Поиск упражнений (все слова запроса, ё=е, по русскому и английскому названию), проверка ссылки на видео |
| `src/supabase.ts` | Клиент Supabase и тип `Profile` |
| `src/styles.css` | Общие стили: кнопки `.btn`/`.btn.secondary`, `.card`, скругление 16px |
| `src/logic.test.ts` | Тесты (vitest): палитры, поиск, суперсеты, видео-ссылки, очередь без сети, рекорды, % от максимума, блины, таймер |
| `supabase/migrations/` | Схема базы и правила доступа (RLS). Новый этап — новый файл миграции, старые не править |
| `supabase/functions/telegram/` | Серверная функция: вход через бота (`start`/`check`), webhook Telegram, `cron` (раз в минуту: напоминания, отправка очереди, раз в час — чистка видео), `remind_now`, `cleanup`, `setup` |
| `supabase/seed.sql` | 876 упражнений; **генерируется** `npm run exercises`, руками не править |
| `data/exercises-ru.txt` | Русские названия упражнений, строка `English | Русское` — править здесь |
| `scripts/check-rls.sql` | Проверка правил доступа запросами под тренером и атлетами |
| `scripts/build-exercises.mjs` | Скачивает free-exercise-db и собирает `seed.sql`; там же словари мышц и оборудования |
| `public/icons/` | Иконки приложения (жёлтый квадрат «KT») |
| `.github/workflows/deploy.yml` | Сборка, тесты и выкладка на GitHub Pages |

## Данные и доступ (Supabase)

- Вход через Telegram: приложение берёт код (`start`), человек жмёт «Войти» в боте, функция по `check` создаёт учётку `tg<id>@telegram.invalid` (писем не шлём) и отдаёт `token_hash` для `auth.verifyOtp`. Коды — в `telegram_logins` (живут 10 минут; после подтверждения ещё 2 минуты отдают вход — ответ мог потеряться, пока человек был в Telegram). Telegram-id, имя и роль тренера по нику функция пишет в `profiles` при каждом входе (триггер их не видит: GoTrue заполняет `app_metadata` после вставки).
- `profiles` — человек (роль `coach`/`athlete`, анкета, тема и палитра). Создаётся триггером при первом входе; роль «тренер» — если email есть в `coach_emails` (триггер) или ник Telegram (строчными, без @) — в `coach_telegram_usernames` (функция `telegram`, со следующего входа).
- `coach_athletes` — связь тренер—атлет (у атлета один тренер) + `note`, заметка тренера (атлету не видна).
- `invites` — ссылки-приглашения (одноразовые, 7 дней). Принимаются функцией `accept_invite(token)`.
- `athlete_groups`, `group_members` — группы атлетов (тренировка группе = копия каждому).
- `exercises` — база упражнений (`source`: base/coach/athlete; `lower_is_better` — для времени). `merge_exercises` — объединить два названия.
- `workouts` (тренировка: атлет, дата, опубликована, `self` — своя атлета, `completed_at`, `reviewed_at`) и `workout_items` (задания: `superset`, `block_note`, `pct`, `timer`, `self` — добавлено атлетом). Тренер сохраняет через `save_workout` (одна транзакция; убранное задание с результатами становится «сам»), копирует — `copy_workout`, `copy_week`, `assign_program` → `place_workout`.
- `set_results` (подходы, ключ — задание + номер), `comments` (с видео `video_path`, через 30 дней — `video_deleted`). Атлет пишет результаты за 7 дней назад и вперёд (`can_write_results`), завершает — `complete_workout`.
- `item_templates`, `workout_templates`, `programs` + `program_workouts` — шаблоны и программы (снимки заданий: правка шаблона назначенное не меняет).
- `records`, `measurements`, `progress_photos` — прогресс (атлет и его тренер). Хранилища: `progress` (фото), `videos` (видео) — папка = id атлета.
- `notifications` — очередь сообщений в Telegram; наполняют триггеры (`workout_changed`, `workout_completed`, `comment_added`) и `enqueue_reminders` (20:00 по часовому поясу атлета). Отправляет функция `telegram` (pg_cron `telegram-notify` раз в минуту; секрет — в Vault `telegram_webhook_secret`).
- `coach_athletes.visible_days` — сколько дней вперёд атлет видит план (`can_see_date` в правилах доступа).
- Права: атлет видит свой профиль и профиль своего тренера; тренер — свой и своих атлетов. Роль и email сам себе не поменять (права на столбцы). Проверять права — запросом под атлетом, не только глазами в интерфейсе: `scripts/check-rls.sql` покрывает все таблицы, хранилища и функции.

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
  - Authentication → Sign In / Providers → Email: должен оставаться включён — через него функция `telegram` выдаёт сессию (`generateLink` + `verifyOtp`); писем не шлём, почта не настроена.
  - Authentication → URL Configuration → Site URL: адрес сайта на GitHub Pages.
  - Тренер: `insert into coach_telegram_usernames values ('ник');` или `insert into coach_emails values ('адрес');` — **до** его первого входа (`npx supabase db query --remote --yes "…"`).
  - Edge Functions → Secrets: `TELEGRAM_BOT_TOKEN` (токен от @BotFather, вписывает владелец), `TELEGRAM_WEBHOOK_SECRET` (случайная строка; копия — в `.env.local`).
- Секреты (пароль SMTP, ключ service_role, пароль базы) — только в панели Supabase, никогда в коде и в git.

## Как выкладывать

- Сайт: push в `main` или `task-trekker-*` → GitHub Actions собирает и выкладывает на GitHub Pages. После смены Variables нужен новый коммит: повторная выкладка того же коммита сайт не обновляет.
- База: `npx supabase login` (один раз), `npx supabase link --project-ref <ref>`, затем `npx supabase db push --remote --yes` (новые миграции; `--include-seed` — при первой загрузке упражнений). В PowerShell на этом компьютере `npx` запрещён настройками Windows — писать `npx.cmd`.
- Функция: `npx supabase functions deploy telegram --no-verify-jwt --use-api --yes`. После смены токена бота — привязать webhook: POST на функцию `{"action":"setup","secret":"<TELEGRAM_WEBHOOK_SECRET>"}`.
- Проверка правил доступа: `npx supabase db query --remote --yes -f scripts/check-rls.sql`. Успех — ошибка с текстом `RLS_OK`, тестовые данные откатываются. Новые таблицы с доступом — дописывать туда.
- Новые русские названия: поправить `data/exercises-ru.txt` → `npm run exercises`. Уже загруженные упражнения seed не перезаписывает — правку в базе делать в приложении или SQL.

## Правила

- Видео и тексты TRNR не использовать. База упражнений — free-exercise-db (Unlicense), картинки грузятся с yuhonas.github.io.
- Маршруты — через `#/…` (GitHub Pages не умеет отдавать index.html на любой путь).
- Крупные кнопки (≥ 48 px), всё одной рукой на телефоне.
