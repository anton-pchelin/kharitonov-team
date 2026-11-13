-- Этап 6: шаблоны тренировок, программы на N недель, копирование недели, % от максимума, видимость плана.

alter table public.workout_items add column pct numeric check (pct > 0 and pct <= 200);  -- % от 1ПМ этого упражнения

-- Сколько дней вперёд атлет видит план (null — всё). Ставит тренер.
alter table public.coach_athletes add column visible_days int check (visible_days between 0 and 365);
revoke update on public.coach_athletes from anon, authenticated;
grant update (note, visible_days) on public.coach_athletes to authenticated;

create function public.can_see_date(a uuid, d date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(d <= public.local_today(a) + (select visible_days from public.coach_athletes where athlete_id = a), true)
$$;
revoke execute on function public.can_see_date(uuid, date) from public, anon;
grant execute on function public.can_see_date(uuid, date) to authenticated;

drop policy "тренировки: видеть" on public.workouts;
create policy "тренировки: видеть" on public.workouts for select to authenticated
  using (public.is_my_athlete(athlete_id)
         or (athlete_id = auth.uid() and (self or (published and public.can_see_date(athlete_id, date)))));

create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null default auth.uid() references public.profiles on delete cascade,
  title text not null default '',
  prescription text not null default '',
  items jsonb not null default '[]',  -- снимок заданий: изменение шаблона не трогает назначенные тренировки
  created_at timestamptz not null default now()
);
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null default auth.uid() references public.profiles on delete cascade,
  name text not null check (length(trim(name)) > 0),
  weeks int not null default 1 check (weeks between 1 and 52),
  created_at timestamptz not null default now()
);
create table public.program_workouts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs on delete cascade,
  week int not null check (week >= 1),
  day int not null check (day between 0 and 6),  -- 0 — понедельник
  title text not null default '',
  prescription text not null default '',
  items jsonb not null default '[]',
  created_at timestamptz not null default now()
);
alter table public.workout_templates enable row level security;
alter table public.programs enable row level security;
alter table public.program_workouts enable row level security;
create policy "шаблоны тренировок: свои" on public.workout_templates for all to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid() and public.is_coach());
create policy "программы: свои" on public.programs for all to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid() and public.is_coach());
create policy "дни программы: свои программы" on public.program_workouts for all to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id and p.coach_id = auth.uid()))
  with check (exists (select 1 from public.programs p where p.id = program_id and p.coach_id = auth.uid()));

-- Положить тренировку атлету на дату с учётом уже стоящих: add — рядом, replace — заменить, skip — пропустить.
-- Права — как у вызывающего (RLS): только своим атлетам.
create function public.place_workout(p_athlete uuid, p_date date, p_title text, p_prescription text, p_items jsonb, p_conflict text)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  wid uuid := gen_random_uuid();
begin
  if exists (select 1 from public.workouts where athlete_id = p_athlete and date = p_date and not self) then
    if p_conflict = 'skip' then return false; end if;
    if p_conflict = 'replace' then delete from public.workouts where athlete_id = p_athlete and date = p_date and not self; end if;
  end if;
  insert into public.workouts (id, athlete_id, date, title, prescription, published) values (wid, p_athlete, p_date, p_title, p_prescription, true);
  insert into public.workout_items
    (workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, pct)
  select wid, coalesce((x ->> 'position')::int, n::int), nullif(x ->> 'exercise_id', '')::uuid, x ->> 'name',
         coalesce(x ->> 'plan_text', ''), nullif(x ->> 'video_url', ''), coalesce(x ->> 'result_type', 'weight_reps'),
         coalesce((x ->> 'planned_sets')::int, 1), (x ->> 'superset')::int, coalesce(x ->> 'block_note', ''), (x ->> 'pct')::numeric
  from jsonb_array_elements(p_items) with ordinality as t(x, n);
  return true;
end
$$;

create function public.assign_program(p_program uuid, p_athletes uuid[], p_start date, p_conflict text) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  pw record; a uuid; n int := 0;
begin
  for a in select unnest(p_athletes) loop
    for pw in select * from public.program_workouts where program_id = p_program order by week, day, created_at loop
      if public.place_workout(a, p_start + (pw.week - 1) * 7 + pw.day, pw.title, pw.prescription, pw.items, p_conflict) then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end
$$;

-- Скопировать (или перенести) неделю атлета другим атлетам на выбранную неделю.
create function public.copy_week(p_from_athlete uuid, p_from_monday date, p_athletes uuid[], p_to_monday date, p_conflict text, p_move boolean default false)
returns int
language plpgsql security invoker set search_path = '' as $$
declare
  w record; a uuid; n int := 0;
begin
  for a in select unnest(p_athletes) loop
    for w in
      select x.*, (select coalesce(jsonb_agg(to_jsonb(i) order by i.position), '[]') from public.workout_items i where i.workout_id = x.id and not i.self) items
      from public.workouts x where x.athlete_id = p_from_athlete and not x.self and x.date between p_from_monday and p_from_monday + 6
      order by x.date, x.created_at
    loop
      if public.place_workout(a, p_to_monday + (w.date - p_from_monday), w.title, w.prescription, w.items, p_conflict) then n := n + 1; end if;
    end loop;
  end loop;
  if p_move then
    delete from public.workouts where athlete_id = p_from_athlete and not self and date between p_from_monday and p_from_monday + 6
      and created_at < now();  -- копии созданы в этой же транзакции (created_at = now()) и не удаляются
  end if;
  return n;
end
$$;

revoke execute on function public.place_workout(uuid, date, text, text, jsonb, text) from public, anon;
revoke execute on function public.assign_program(uuid, uuid[], date, text) from public, anon;
revoke execute on function public.copy_week(uuid, date, uuid[], date, text, boolean) from public, anon;
grant execute on function public.place_workout(uuid, date, text, text, jsonb, text) to authenticated;
grant execute on function public.assign_program(uuid, uuid[], date, text) to authenticated;
grant execute on function public.copy_week(uuid, date, uuid[], date, text, boolean) to authenticated;

-- save_workout и copy_workout теперь переносят и % от максимума
create or replace function public.save_workout(w jsonb, items jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  wid uuid := coalesce((w ->> 'id')::uuid, gen_random_uuid());
  is_self boolean := coalesce((w ->> 'self')::boolean, false);
  keep uuid[] := array(select (x ->> 'id')::uuid from jsonb_array_elements(items) x);
begin
  if jsonb_array_length(items) = 0 then raise exception 'Добавьте хотя бы одно задание'; end if;

  insert into public.workouts (id, athlete_id, date, title, prescription, published, self)
  values (wid, (w ->> 'athlete_id')::uuid, (w ->> 'date')::date, coalesce(w ->> 'title', ''),
          coalesce(w ->> 'prescription', ''), coalesce((w ->> 'published')::boolean, false), is_self)
  on conflict (id) do update set
    date = excluded.date, title = excluded.title, prescription = excluded.prescription,
    published = excluded.published, updated_at = now();

  update public.workout_items i set self = true
  where i.workout_id = wid and i.self = is_self and not is_self and i.id <> all (keep)
    and exists (select 1 from public.set_results r where r.item_id = i.id);
  delete from public.workout_items i
  where i.workout_id = wid and i.self = is_self and i.id <> all (keep);

  insert into public.workout_items
    (id, workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, self, pct)
  select (x ->> 'id')::uuid, wid, (x ->> 'position')::int, nullif(x ->> 'exercise_id', '')::uuid, x ->> 'name',
         coalesce(x ->> 'plan_text', ''), nullif(x ->> 'video_url', ''), x ->> 'result_type',
         (x ->> 'planned_sets')::int, (x ->> 'superset')::int, coalesce(x ->> 'block_note', ''), is_self, (x ->> 'pct')::numeric
  from jsonb_array_elements(items) x
  on conflict (id) do update set
    position = excluded.position, exercise_id = excluded.exercise_id, name = excluded.name,
    plan_text = excluded.plan_text, video_url = excluded.video_url, result_type = excluded.result_type,
    planned_sets = excluded.planned_sets, superset = excluded.superset, block_note = excluded.block_note, pct = excluded.pct;
  return wid;
end
$$;

create or replace function public.copy_workout(src uuid, to_athlete uuid, to_date date) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  nid uuid := gen_random_uuid();
begin
  insert into public.workouts (id, athlete_id, date, title, prescription, published)
  select nid, to_athlete, to_date, title, prescription, published from public.workouts where id = src;
  if not found then raise exception 'Тренировка не найдена'; end if;
  insert into public.workout_items
    (workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, pct)
  select nid, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, pct
  from public.workout_items where workout_id = src and not self;
  return nid;
end
$$;
