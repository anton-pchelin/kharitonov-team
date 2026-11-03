-- Этап 1: люди, связь тренер—атлет, приглашения, группы, упражнения.
-- Правила доступа (RLS): атлет видит только себя и своего тренера, тренер — себя и своих атлетов.

-- Адреса, которые при первом входе получают роль «тренер». Заполняется вручную в SQL-редакторе.
create table public.coach_emails (
  email text primary key
);
alter table public.coach_emails enable row level security;  -- без политик: из приложения не видно

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null default 'athlete' check (role in ('coach', 'athlete')),
  name text not null default '',
  email text,
  telegram_id bigint unique,
  city text not null default '',
  timezone text not null default 'Europe/Moscow',
  goals text not null default '',
  equipment text not null default '',
  health_limits text not null default '',
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  palette text not null default 'TRNR',
  created_at timestamptz not null default now()
);

create table public.coach_athletes (
  coach_id uuid not null references public.profiles on delete cascade,
  athlete_id uuid not null unique references public.profiles on delete cascade,  -- у атлета один тренер
  note text not null default '',  -- заметка тренера, атлету не видна
  created_at timestamptz not null default now(),
  primary key (coach_id, athlete_id)
);

create table public.invites (
  token uuid primary key default gen_random_uuid(),
  coach_id uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references public.profiles on delete set null,
  used_at timestamptz
);

create table public.athlete_groups (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null default auth.uid() references public.profiles on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.athlete_groups on delete cascade,
  athlete_id uuid not null references public.profiles on delete cascade,
  primary key (group_id, athlete_id)
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  source_id text unique,  -- id в free-exercise-db, у своих упражнений пусто
  name text not null check (length(trim(name)) > 0),
  aliases text[] not null default '{}',
  muscles text[] not null default '{}',
  equipment text,
  image_url text,
  video_url text check (video_url ~* '^https?://'),
  source text not null default 'coach' check (source in ('base', 'coach', 'athlete')),
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

-- Помощники для правил доступа. security definer — чтобы не упираться в RLS самих таблиц.
create function public.is_coach() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coach')
$$;

create function public.my_coach_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select coach_id from public.coach_athletes where athlete_id = auth.uid()
$$;

-- Профиль создаётся сам при первом входе; роль «тренер» — только по списку coach_emails.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when exists (select 1 from public.coach_emails where lower(email) = lower(new.email))
      then 'coach' else 'athlete' end
  );
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Атлет принимает приглашение. Ответ — код, текст показывает приложение.
create function public.accept_invite(p_token uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invites;
  my_coach uuid;
begin
  if auth.uid() is null then return 'not_logged_in'; end if;

  select * into inv from public.invites where token = p_token for update;
  if not found then return 'invalid'; end if;

  select coach_id into my_coach from public.coach_athletes where athlete_id = auth.uid();
  if my_coach is not null then
    return case when my_coach = inv.coach_id then 'ok' else 'has_other_coach' end;
  end if;

  if inv.used_at is not null then return 'used'; end if;
  if inv.expires_at < now() then return 'expired'; end if;
  if public.is_coach() then return 'is_coach'; end if;

  insert into public.coach_athletes (coach_id, athlete_id) values (inv.coach_id, auth.uid());
  update public.invites set used_by = auth.uid(), used_at = now() where token = p_token;
  return 'ok';
end
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;

-- Правила доступа
alter table public.profiles enable row level security;
alter table public.coach_athletes enable row level security;
alter table public.invites enable row level security;
alter table public.athlete_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.exercises enable row level security;

create policy "профиль: свой, своих атлетов, своего тренера" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or id = public.my_coach_id()
    or exists (select 1 from public.coach_athletes ca where ca.coach_id = auth.uid() and ca.athlete_id = profiles.id)
  );
create policy "профиль: правит только себя" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Роль, email и Telegram сам себе не поменяешь — только эти поля:
revoke update on public.profiles from anon, authenticated;
grant update (name, city, timezone, goals, equipment, health_limits, theme, palette) on public.profiles to authenticated;

create policy "связи: тренер видит своих" on public.coach_athletes
  for select to authenticated using (coach_id = auth.uid());
create policy "связи: тренер правит заметку" on public.coach_athletes
  for update to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
revoke update on public.coach_athletes from anon, authenticated;
grant update (note) on public.coach_athletes to authenticated;

create policy "приглашения: тренер видит свои" on public.invites
  for select to authenticated using (coach_id = auth.uid());
create policy "приглашения: создаёт только тренер" on public.invites
  for insert to authenticated with check (coach_id = auth.uid() and public.is_coach());

create policy "группы: только свои" on public.athlete_groups
  for all to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid() and public.is_coach());
create policy "состав групп: только свои группы и свои атлеты" on public.group_members
  for all to authenticated
  using (exists (select 1 from public.athlete_groups g where g.id = group_id and g.coach_id = auth.uid()))
  with check (
    exists (select 1 from public.athlete_groups g where g.id = group_id and g.coach_id = auth.uid())
    and exists (select 1 from public.coach_athletes ca where ca.coach_id = auth.uid() and ca.athlete_id = group_members.athlete_id)
  );

create policy "упражнения: видят все вошедшие" on public.exercises
  for select to authenticated using (true);
create policy "упражнения: добавить своё" on public.exercises
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and source = case when public.is_coach() then 'coach' else 'athlete' end
  );
-- shortcut: любой тренер правит любое упражнение — при втором тренере ограничить базой и своими
create policy "упражнения: тренер правит любое, атлет — своё" on public.exercises
  for update to authenticated
  using (public.is_coach() or created_by = auth.uid());
revoke update on public.exercises from anon, authenticated;
grant update (name, aliases, muscles, equipment, video_url) on public.exercises to authenticated;
