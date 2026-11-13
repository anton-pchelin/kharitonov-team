-- Вход через Telegram: приложение получает одноразовый код, человек подтверждает вход в боте,
-- серверная функция telegram выдаёт сессию. Таблицы — только для сервера (RLS без политик).

-- Ники тренеров в Telegram (без @, строчными). Заполняется вручную, до первого входа тренера.
create table public.coach_telegram_usernames (
  username text primary key check (username = lower(username) and username !~ '^@')
);
alter table public.coach_telegram_usernames enable row level security;

create table public.telegram_logins (
  code text primary key,
  created_at timestamptz not null default now(),
  telegram_id bigint,
  telegram_username text,
  name text,
  confirmed_at timestamptz,
  used_at timestamptz
);
alter table public.telegram_logins enable row level security;

-- Telegram-данные берём из app_metadata: её задаёт только сервер. user_metadata человек может
-- подставить сам при входе по email, поэтому роль по ней не определяем.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tg_id bigint := (new.raw_app_meta_data ->> 'telegram_id')::bigint;
  tg_username text := lower(new.raw_app_meta_data ->> 'telegram_username');
begin
  insert into public.profiles (id, email, telegram_id, name, role)
  values (
    new.id,
    case when tg_id is null then new.email end,  -- у Telegram-входа служебный адрес, его не показываем
    tg_id,
    case when tg_id is null then '' else coalesce(new.raw_app_meta_data ->> 'name', '') end,
    case
      when exists (select 1 from public.coach_emails where lower(email) = lower(new.email)) then 'coach'
      when tg_username is not null
        and exists (select 1 from public.coach_telegram_usernames where username = tg_username) then 'coach'
      else 'athlete'
    end
  );
  return new;
end
$$;
