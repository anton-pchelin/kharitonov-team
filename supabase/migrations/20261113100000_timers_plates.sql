-- Этап 8: таймер комплекса у задания, гриф и набор блинов атлета для калькулятора.

-- {"kind": "amrap" | "emom" | "fortime" | "tabata", "minutes": 12, "work": 20, "rest": 10, "rounds": 8}
alter table public.workout_items add column timer jsonb;

alter table public.profiles
  add column bar numeric not null default 20 check (bar in (10, 15, 20)),
  add column plates numeric[] not null default '{25, 20, 15, 10, 5, 2.5, 1.25}';
grant update (bar, plates) on public.profiles to authenticated;

-- Таймер переносится вместе с заданием при сохранении, копировании и назначении программы.
create or replace function public.place_workout(p_athlete uuid, p_date date, p_title text, p_prescription text, p_items jsonb, p_conflict text)
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
    (workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, pct, timer)
  select wid, coalesce((x ->> 'position')::int, n::int), nullif(x ->> 'exercise_id', '')::uuid, x ->> 'name',
         coalesce(x ->> 'plan_text', ''), nullif(x ->> 'video_url', ''), coalesce(x ->> 'result_type', 'weight_reps'),
         coalesce((x ->> 'planned_sets')::int, 1), (x ->> 'superset')::int, coalesce(x ->> 'block_note', ''), (x ->> 'pct')::numeric, x -> 'timer'
  from jsonb_array_elements(p_items) with ordinality as t(x, n);
  return true;
end
$$;

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
    (id, workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, self, pct, timer)
  select (x ->> 'id')::uuid, wid, (x ->> 'position')::int, nullif(x ->> 'exercise_id', '')::uuid, x ->> 'name',
         coalesce(x ->> 'plan_text', ''), nullif(x ->> 'video_url', ''), x ->> 'result_type',
         (x ->> 'planned_sets')::int, (x ->> 'superset')::int, coalesce(x ->> 'block_note', ''), is_self, (x ->> 'pct')::numeric, nullif(x -> 'timer', 'null'::jsonb)
  from jsonb_array_elements(items) x
  on conflict (id) do update set
    position = excluded.position, exercise_id = excluded.exercise_id, name = excluded.name,
    plan_text = excluded.plan_text, video_url = excluded.video_url, result_type = excluded.result_type,
    planned_sets = excluded.planned_sets, superset = excluded.superset, block_note = excluded.block_note, pct = excluded.pct, timer = excluded.timer;
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
    (workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, pct, timer)
  select nid, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, pct, timer
  from public.workout_items where workout_id = src and not self;
  return nid;
end
$$;
