-- «Написать тренеру»: ник появляется в учётке только после нового входа тренера — добавляем его Telegram-id как запасной путь.
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('coach_id', ca.coach_id, 'until', ca.access_until,
                            'coach_username', u.raw_app_meta_data ->> 'telegram_username',
                            'coach_telegram_id', p.telegram_id)
  from public.coach_athletes ca
  left join auth.users u on u.id = ca.coach_id
  left join public.profiles p on p.id = ca.coach_id
  where ca.athlete_id = auth.uid()
$$;
