-- Этап 4: уведомления в Telegram. База кладёт сообщения в очередь notifications,
-- функция telegram отправляет их (токен бота есть только у неё). Раз в минуту её будит pg_cron.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

alter table public.profiles
  add column notify_tomorrow boolean not null default true,   -- атлету: напоминание о завтрашней (20:00)
  add column notify_changed boolean not null default true,    -- атлету: тренер изменил тренировку на сегодня
  add column notify_replies boolean not null default true,    -- атлету: ответ тренера в комментариях
  add column notify_completed boolean not null default true,  -- тренеру: атлет выполнил тренировку
  add column notify_comments boolean not null default true;   -- тренеру: комментарий атлета
grant update (notify_tomorrow, notify_changed, notify_replies, notify_completed, notify_comments) on public.profiles to authenticated;

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  text text not null,
  link text,
  dedup text unique,  -- одно напоминание на атлета и дату
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);
alter table public.notifications enable row level security;  -- только сервер

create function public.local_today(p_user uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.profiles where id = p_user), 'Europe/Moscow'))::date
$$;

create function public.notify(p_user uuid, p_text text, p_link text, p_dedup text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, text, link, dedup)
  select p_user, p_text, p_link, p_dedup
  where exists (select 1 from public.profiles where id = p_user and telegram_id is not null)
  on conflict (dedup) do nothing
$$;
revoke execute on function public.notify(uuid, text, text, text) from public, anon, authenticated;

create function public.monday(d date) returns date language sql immutable as $$ select d - (extract(isodow from d)::int - 1) $$;

-- Атлету: тренер опубликовал или изменил тренировку на сегодня (не чаще раза в 10 минут на тренировку).
create function public.on_workout_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.self or not new.published or new.date <> public.local_today(new.athlete_id) then return new; end if;
  if tg_op = 'UPDATE' and new.updated_at is not distinct from old.updated_at and new.published = old.published then return new; end if;
  if not (select notify_changed from public.profiles where id = new.athlete_id) then return new; end if;
  if exists (select 1 from public.notifications where user_id = new.athlete_id and link like '%' || new.id || '%'
             and created_at > now() - interval '10 minutes') then return new; end if;
  perform public.notify(new.athlete_id,
    case when tg_op = 'INSERT' or not old.published then 'На сегодня новая тренировка: «' else 'Тренер изменил тренировку на сегодня: «' end
      || coalesce(nullif(new.title, ''), 'Тренировка') || '»',
    '#/today/' || new.date || '/' || new.id);
  return new;
end
$$;
create trigger workout_changed after insert or update on public.workouts
  for each row execute function public.on_workout_changed();

-- Тренеру: атлет завершил тренировку — одно сообщение на тренировку.
create function public.on_workout_completed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  coach uuid := (select coach_id from public.coach_athletes where athlete_id = new.athlete_id);
  total int; done int; has_comments boolean;
begin
  if old.completed_at is not null or new.completed_at is null or coach is null then return new; end if;
  if not (select notify_completed from public.profiles where id = coach) then return new; end if;
  select count(*), count(*) filter (where exists (
    select 1 from public.set_results r where r.item_id = i.id
      and (r.done or r.weight is not null or r.reps is not null or r.time_sec is not null
           or r.meters is not null or r.calories is not null or r.rounds is not null)))
    into total, done
  from public.workout_items i where i.workout_id = new.id and not i.self;
  has_comments := exists (select 1 from public.comments where workout_id = new.id and author_id = new.athlete_id);
  perform public.notify(coach,
    (select coalesce(nullif(name, ''), 'Атлет') from public.profiles where id = new.athlete_id)
      || ': выполнена «' || coalesce(nullif(new.title, ''), 'Тренировка') || '»'
      || case when new.self then ' (своя)' else ' (' || done || ' из ' || total || ')' end
      || case when has_comments then ', есть комментарий' else '' end,
    '#/plan/' || new.athlete_id || '/' || public.monday(new.date) || '/' || new.id,
    'done:' || new.id);
  return new;
end
$$;
create trigger workout_completed after update of completed_at on public.workouts
  for each row execute function public.on_workout_completed();

-- Комментарии: тренер ответил — атлету; атлет написал после завершения тренировки — тренеру.
create function public.on_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  w public.workouts := (select w from public.workouts w where w.id = new.workout_id);
  coach uuid := (select coach_id from public.coach_athletes where athlete_id = w.athlete_id);
begin
  if new.author_id = coach and (select notify_replies from public.profiles where id = w.athlete_id) then
    perform public.notify(w.athlete_id, 'Тренер ответил: ' || left(new.text, 300), '#/today/' || w.date || '/' || w.id);
  elsif new.author_id = w.athlete_id and w.completed_at is not null and coach is not null
        and (select notify_comments from public.profiles where id = coach) then
    perform public.notify(coach,
      (select coalesce(nullif(name, ''), 'Атлет') from public.profiles where id = w.athlete_id) || ' пишет: ' || left(new.text, 300),
      '#/plan/' || w.athlete_id || '/' || public.monday(w.date) || '/' || w.id);
  end if;
  return new;
end
$$;
create trigger comment_added after insert on public.comments
  for each row execute function public.on_comment();

-- Напоминания о завтрашней тренировке: в 20:00 по времени атлета (или сразу всем атлетам тренера — для проверки).
create function public.enqueue_reminders(p_coach uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.id, public.local_today(p.id) + 1 as tomorrow,
           string_agg('«' || coalesce(nullif(w.title, ''), 'Тренировка') || '»', ', ') as titles
    from public.profiles p
    join public.workouts w on w.athlete_id = p.id and w.published and not w.self and w.date = public.local_today(p.id) + 1
    where p.telegram_id is not null and p.notify_tomorrow
      and (case when p_coach is null
             then extract(hour from now() at time zone coalesce(p.timezone, 'Europe/Moscow')) = 20
             else exists (select 1 from public.coach_athletes ca where ca.coach_id = p_coach and ca.athlete_id = p.id) end)
    group by p.id
  loop
    perform public.notify(r.id, 'На завтра новая тренировка: ' || r.titles, '#/today/' || r.tomorrow,
                          case when p_coach is null then 'tomorrow:' || r.id || ':' || r.tomorrow end);
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke execute on function public.enqueue_reminders(uuid) from public, anon, authenticated;

-- Раз в минуту: функция telegram собирает напоминания и отправляет очередь.
-- Секрет берётся из Vault (кладётся вручную, в git его нет): select vault.create_secret('<секрет>', 'telegram_webhook_secret');
select cron.schedule('telegram-notify', '* * * * *', $$
  select net.http_post(
    url := 'https://qzjuaqpdzmcoiltqpfkz.supabase.co/functions/v1/telegram',
    headers := '{"content-type": "application/json"}'::jsonb,
    body := jsonb_build_object('action', 'cron', 'secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_webhook_secret'))
  )
$$);
