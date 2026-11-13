-- Этап 2: тренировки, задания в тренировке, шаблоны заданий.

create function public.is_my_athlete(a uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_athletes where coach_id = auth.uid() and athlete_id = a)
$$;
revoke execute on function public.is_my_athlete(uuid) from public, anon;
grant execute on function public.is_my_athlete(uuid) to authenticated;

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles on delete cascade,
  date date not null,
  title text not null default '',
  prescription text not null default '',
  published boolean not null default false,
  self boolean not null default false,  -- своя тренировка атлета («сам»)
  created_by uuid default auth.uid() references public.profiles on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.workouts (athlete_id, date);

create table public.workout_items (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts on delete cascade,
  position int not null default 0,
  exercise_id uuid references public.exercises on delete set null,
  name text not null check (length(trim(name)) > 0),
  plan_text text not null default '',
  video_url text check (video_url ~* '^https?://'),
  result_type text not null default 'weight_reps'
    check (result_type in ('weight_reps', 'reps', 'weight', 'time', 'meters', 'calories', 'rounds', 'check')),
  planned_sets int not null default 1 check (planned_sets between 0 and 50),
  superset int,  -- одинаковое число у соседних заданий — суперсет (3А, 3Б)
  block_note text not null default '',  -- подпись суперсета: «5 раундов, отдых 2 мин»
  self boolean not null default false,  -- добавлено атлетом
  created_at timestamptz not null default now()
);
create index on public.workout_items (workout_id);

create table public.item_templates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null default auth.uid() references public.profiles on delete cascade,
  exercise_id uuid references public.exercises on delete set null,
  name text not null check (length(trim(name)) > 0),
  plan_text text not null default '',
  video_url text check (video_url ~* '^https?://'),
  result_type text not null default 'weight_reps',
  planned_sets int not null default 1,
  created_at timestamptz not null default now()
);

alter table public.workouts enable row level security;
alter table public.workout_items enable row level security;
alter table public.item_templates enable row level security;

-- Тренер — всё у своих атлетов; атлет видит опубликованные и свои, правит только свои.
create policy "тренировки: видеть" on public.workouts for select to authenticated
  using (public.is_my_athlete(athlete_id) or (athlete_id = auth.uid() and (published or self)));
create policy "тренировки: создать" on public.workouts for insert to authenticated
  with check ((public.is_my_athlete(athlete_id) and not self) or (athlete_id = auth.uid() and self));
create policy "тренировки: править" on public.workouts for update to authenticated
  using (public.is_my_athlete(athlete_id) or (athlete_id = auth.uid() and self))
  with check (public.is_my_athlete(athlete_id) or (athlete_id = auth.uid() and self));
create policy "тренировки: удалить" on public.workouts for delete to authenticated
  using (public.is_my_athlete(athlete_id) or (athlete_id = auth.uid() and self));

-- Задания видны вместе с тренировкой (подзапрос сам подчиняется правилам workouts).
create policy "задания: видеть" on public.workout_items for select to authenticated
  using (exists (select 1 from public.workouts w where w.id = workout_id));
create policy "задания: тренер" on public.workout_items for all to authenticated
  using (exists (select 1 from public.workouts w where w.id = workout_id and public.is_my_athlete(w.athlete_id)))
  with check (exists (select 1 from public.workouts w where w.id = workout_id and public.is_my_athlete(w.athlete_id)));
create policy "задания: атлет добавляет своё" on public.workout_items for all to authenticated
  using (self and exists (select 1 from public.workouts w where w.id = workout_id and w.athlete_id = auth.uid()))
  with check (self and exists (
    select 1 from public.workouts w where w.id = workout_id and w.athlete_id = auth.uid() and (w.self or w.published)
  ));

create policy "шаблоны заданий: свои" on public.item_templates for all to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid() and public.is_coach());

-- Сохранить тренировку целиком одной транзакцией (права — как у вызывающего).
-- Задания, добавленные атлетом (self), тренерское сохранение не трогает.
create function public.save_workout(w jsonb, items jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  wid uuid := coalesce((w ->> 'id')::uuid, gen_random_uuid());
begin
  if jsonb_array_length(items) = 0 then raise exception 'Добавьте хотя бы одно задание'; end if;

  insert into public.workouts (id, athlete_id, date, title, prescription, published, self)
  values (wid, (w ->> 'athlete_id')::uuid, (w ->> 'date')::date, coalesce(w ->> 'title', ''),
          coalesce(w ->> 'prescription', ''), coalesce((w ->> 'published')::boolean, false),
          coalesce((w ->> 'self')::boolean, false))
  on conflict (id) do update set
    date = excluded.date, title = excluded.title, prescription = excluded.prescription,
    published = excluded.published, updated_at = now();

  delete from public.workout_items i
  where i.workout_id = wid and i.self = coalesce((w ->> 'self')::boolean, false)
    and i.id not in (select (x ->> 'id')::uuid from jsonb_array_elements(items) x);

  insert into public.workout_items
    (id, workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, self)
  select (x ->> 'id')::uuid, wid, (x ->> 'position')::int, nullif(x ->> 'exercise_id', '')::uuid, x ->> 'name',
         coalesce(x ->> 'plan_text', ''), nullif(x ->> 'video_url', ''), x ->> 'result_type',
         (x ->> 'planned_sets')::int, (x ->> 'superset')::int, coalesce(x ->> 'block_note', ''),
         coalesce((w ->> 'self')::boolean, false)
  from jsonb_array_elements(items) x
  on conflict (id) do update set
    position = excluded.position, exercise_id = excluded.exercise_id, name = excluded.name,
    plan_text = excluded.plan_text, video_url = excluded.video_url, result_type = excluded.result_type,
    planned_sets = excluded.planned_sets, superset = excluded.superset, block_note = excluded.block_note;
  return wid;
end
$$;
revoke execute on function public.save_workout(jsonb, jsonb) from public, anon;
grant execute on function public.save_workout(jsonb, jsonb) to authenticated;

-- Скопировать тренировку (атлету на дату). Копия — черновик того же вида, без результатов.
create function public.copy_workout(src uuid, to_athlete uuid, to_date date) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  nid uuid := gen_random_uuid();
begin
  insert into public.workouts (id, athlete_id, date, title, prescription, published)
  select nid, to_athlete, to_date, title, prescription, published from public.workouts where id = src;
  if not found then raise exception 'Тренировка не найдена'; end if;
  insert into public.workout_items
    (workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note)
  select nid, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note
  from public.workout_items where workout_id = src and not self;
  return nid;
end
$$;
revoke execute on function public.copy_workout(uuid, uuid, date) from public, anon;
grant execute on function public.copy_workout(uuid, uuid, date) to authenticated;
