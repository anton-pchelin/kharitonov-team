-- Telegram-данные и роль тренера по нику пишет функция telegram при входе: GoTrue заполняет
-- app_metadata уже после вставки пользователя, и триггер их не видит.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    case when new.email not like '%@telegram.invalid' then new.email end,  -- служебный адрес не показываем
    case when exists (select 1 from public.coach_emails where lower(email) = lower(new.email))
      then 'coach' else 'athlete' end
  );
  return new;
end
$$;

-- Уже вошедшим через Telegram: убрать служебный адрес из профиля.
update public.profiles set email = null where email like '%@telegram.invalid';
