-- Без входа эти функции не нужны: правила доступа заданы только для authenticated.
revoke execute on function public.is_coach() from public, anon;
revoke execute on function public.my_coach_id() from public, anon;
grant execute on function public.is_coach() to authenticated;
grant execute on function public.my_coach_id() to authenticated;
