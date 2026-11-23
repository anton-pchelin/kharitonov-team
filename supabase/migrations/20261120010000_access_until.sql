-- Доступ по оплате: тренер ставит атлету срок («доступ до», включительно, по местному времени атлета).
-- null — без ограничения. Срок у пары тренер—атлет: атлет сам его не поменяет.
alter table public.coach_athletes add column access_until date;
revoke update on public.coach_athletes from anon, authenticated;
grant update (note, visible_days, access_until) on public.coach_athletes to authenticated;

create function public.has_access(a uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select access_until from public.coach_athletes where athlete_id = a) >= public.local_today(a), true)
$$;
revoke execute on function public.has_access(uuid) from public, anon;
grant execute on function public.has_access(uuid) to authenticated;

-- Атлету: свой тренер, срок и ник тренера для «Написать тренеру». null — тренера нет.
create function public.my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('coach_id', ca.coach_id, 'until', ca.access_until,
                            'coach_username', u.raw_app_meta_data ->> 'telegram_username')
  from public.coach_athletes ca left join auth.users u on u.id = ca.coach_id
  where ca.athlete_id = auth.uid()
$$;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- Срок прошёл — атлет не читает и не пишет свои тренировки и подходы (тренер — как раньше).
-- Задания и комментарии проверяют тренировку подзапросом, поэтому закрываются вместе с ней.
create policy "тренировки: доступ оплачен" on public.workouts as restrictive for all to authenticated
  using (athlete_id <> auth.uid() or public.has_access(athlete_id))
  with check (athlete_id <> auth.uid() or public.has_access(athlete_id));
create policy "результаты: доступ оплачен" on public.set_results as restrictive for all to authenticated
  using (athlete_id <> auth.uid() or public.has_access(athlete_id))
  with check (athlete_id <> auth.uid() or public.has_access(athlete_id));

create or replace function public.complete_workout(p_id uuid, p_at timestamptz default now()) returns void
language sql security definer set search_path = '' as $$
  update public.workouts set completed_at = coalesce(completed_at, p_at)
  where id = p_id and athlete_id = auth.uid() and public.has_access(auth.uid())
$$;

-- Напоминание об оплате: за 7 дней и в последний день, в 20:00 по времени атлета.
create function public.enqueue_access_reminders(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select ca.athlete_id, ca.access_until,
           ca.access_until - (p_at at time zone coalesce(p.timezone, 'Europe/Moscow'))::date as days_left
    from public.coach_athletes ca join public.profiles p on p.id = ca.athlete_id
    where ca.access_until is not null
      and extract(hour from p_at at time zone coalesce(p.timezone, 'Europe/Moscow')) = 20
  loop
    if r.days_left not in (0, 7) then continue; end if;
    perform public.notify(r.athlete_id,
      case when r.days_left = 0
        then 'Сегодня последний день доступа к тренировкам. Не забудьте оплатить занятия у тренера.'
        else 'Доступ к тренировкам до ' || to_char(r.access_until, 'DD.MM') || ' — осталось 7 дней. Не забудьте оплатить.' end,
      '#/today',
      'access:' || r.athlete_id || ':' || r.access_until || ':' || r.days_left);
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke execute on function public.enqueue_access_reminders(timestamptz) from public, anon, authenticated;

-- Раз в минуту функция telegram зовёт enqueue_reminders() — заодно и напоминания об оплате.
create or replace function public.enqueue_reminders(p_coach uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.id, public.local_today(p.id) + 1 as tomorrow,
           string_agg('«' || coalesce(nullif(w.title, ''), 'Тренировка') || '»', ', ') as titles
    from public.profiles p
    join public.workouts w on w.athlete_id = p.id and w.published and not w.self and w.date = public.local_today(p.id) + 1
    where p.telegram_id is not null and p.notify_tomorrow and public.has_access(p.id)
      and (case when p_coach is null
             then extract(hour from now() at time zone coalesce(p.timezone, 'Europe/Moscow')) = 20
             else exists (select 1 from public.coach_athletes ca where ca.coach_id = p_coach and ca.athlete_id = p.id) end)
    group by p.id
  loop
    perform public.notify(r.id, 'На завтра новая тренировка: ' || r.titles, '#/today/' || r.tomorrow,
                          case when p_coach is null then 'tomorrow:' || r.id || ':' || r.tomorrow end);
    n := n + 1;
  end loop;
  if p_coach is null then n := n + public.enqueue_access_reminders(); end if;
  return n;
end
$$;
