-- Тренер смотрит приложение как атлет: становится атлетом у самого себя,
-- чтобы назначать себе тренировки и видеть их на экране атлета.
create function public.coach_self_link() returns void
language sql security definer set search_path = '' as $$
  insert into public.coach_athletes (coach_id, athlete_id)
  select auth.uid(), auth.uid() where public.is_coach()
  on conflict do nothing
$$;
revoke execute on function public.coach_self_link() from public, anon;
grant execute on function public.coach_self_link() to authenticated;
