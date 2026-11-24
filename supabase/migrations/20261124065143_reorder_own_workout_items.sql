-- Меняем только позиции своих заданий. Подходы и комментарии остаются у прежних идентификаторов.
create function public.reorder_own_workout_items(p_workout uuid, p_items uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  updated_count int;
begin
  if not exists (
    select 1 from public.workouts w where w.id = p_workout and w.athlete_id = auth.uid()
  ) then
    raise insufficient_privilege using message = 'Тренировка недоступна';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('own-workout-order:' || p_workout::text, 0));
  if p_items is null or cardinality(p_items) <> (
    select count(*) from public.workout_items i where i.workout_id = p_workout and i.self
  ) then
    raise exception 'Список упражнений изменился. Обновите тренировку и повторите.';
  end if;

  update public.workout_items i set position = 999 + x.ordinality::int
  from unnest(p_items) with ordinality as x(id, ordinality)
  where i.workout_id = p_workout and i.self and i.id = x.id;
  get diagnostics updated_count = row_count;
  if updated_count <> cardinality(p_items) then
    raise exception 'Список упражнений изменился. Обновите тренировку и повторите.';
  end if;
end
$$;

revoke execute on function public.reorder_own_workout_items(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_own_workout_items(uuid, uuid[]) to authenticated;
