-- Первое выполнение упражнения — ещё не рекорд (как и на экране атлета): сравнивать не с чем.
create or replace function public.has_new_record(p_workout uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with cur as (
    select coalesce(i.exercise_id::text, lower(i.name)) k, w.athlete_id, w.date,
           max(r.weight * (1 + case when r.reps > 1 then r.reps / 30.0 else 0 end)) best
    from public.workouts w join public.workout_items i on i.workout_id = w.id
    join public.set_results r on r.item_id = i.id
    where w.id = p_workout and r.weight > 0 and r.reps > 0
    group by 1, 2, 3
  )
  select exists (
    select 1 from cur where cur.best > (
      select max(r.weight * (1 + case when r.reps > 1 then r.reps / 30.0 else 0 end))
      from public.workouts w join public.workout_items i on i.workout_id = w.id
      join public.set_results r on r.item_id = i.id
      where w.athlete_id = cur.athlete_id and w.date < cur.date and w.id <> p_workout
        and coalesce(i.exercise_id::text, lower(i.name)) = cur.k and r.weight > 0 and r.reps > 0)
  )
$$;
