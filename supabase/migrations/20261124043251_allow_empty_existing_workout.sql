-- У существующей тренировки можно снять последнюю позицию плана. Уже записанные подходы сохраняются.
create or replace function public.save_workout(w jsonb, items jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  wid uuid := coalesce((w ->> 'id')::uuid, gen_random_uuid());
  is_self boolean := coalesce((w ->> 'self')::boolean, false);
  keep uuid[] := array(select (x ->> 'id')::uuid from jsonb_array_elements(items) x);
begin
  if jsonb_array_length(items) = 0 and not exists (
    select 1 from public.workouts where id = wid and athlete_id = (w ->> 'athlete_id')::uuid
  ) then raise exception 'Добавьте хотя бы одно задание'; end if;

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
