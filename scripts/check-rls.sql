-- Проверка правил доступа запросами под тренером и атлетами. Запуск:
--   npx supabase db query --remote --yes -f scripts/check-rls.sql
-- Весь блок заканчивается исключением, поэтому тестовые люди и записи откатываются.
-- Успех — ошибка с текстом «RLS_OK»; любая другая ошибка — проверка не прошла.
do $$
declare
  coach1 uuid := gen_random_uuid();
  coach2 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid();
  a3 uuid := gen_random_uuid();
  newcomer uuid := gen_random_uuid();
  mail1 text := 'rls-' || gen_random_uuid() || '@example.com';
  mail2 text := 'rls-' || gen_random_uuid() || '@example.com';
  inv1 uuid; inv2 uuid; inv3 uuid; inv_old uuid;
  base_id uuid;
  n int;
  t text;
begin
  select count(*) into n from public.exercises where source = 'base';
  assert n >= 870, 'в базе мало упражнений: ' || n;
  select id into base_id from public.exercises where source = 'base' limit 1;

  insert into public.coach_emails values (mail1), (mail2);
  insert into auth.users (id, email) values
    (coach1, upper(mail1)),  -- регистр адреса не должен мешать
    (coach2, mail2),
    (a1, 'a1-' || mail1), (a2, 'a2-' || mail1), (a3, 'a3-' || mail1), (newcomer, 'new-' || mail1);

  select role into t from public.profiles where id = coach1;
  assert t = 'coach', 'адрес из списка не стал тренером';
  select role into t from public.profiles where id = a1;
  assert t = 'athlete', 'обычный адрес должен быть атлетом';

  -- Тренер создаёт приглашения
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', coach1, 'role', 'authenticated')::text, true);
  insert into public.invites default values returning token into inv1;
  insert into public.invites default values returning token into inv2;
  insert into public.invites default values returning token into inv_old;
  perform set_config('request.jwt.claims', json_build_object('sub', coach2, 'role', 'authenticated')::text, true);
  insert into public.invites default values returning token into inv3;

  perform set_config('role', 'none', true);
  update public.invites set expires_at = now() - interval '1 day' where token = inv_old;
  perform set_config('role', 'authenticated', true);

  -- Атлет без приглашения: видит только себя, тренера нет
  perform set_config('request.jwt.claims', json_build_object('sub', newcomer, 'role', 'authenticated')::text, true);
  select count(*) into n from public.profiles;
  assert n = 1, 'новичок видит чужие профили: ' || n;
  assert public.my_coach_id() is null, 'у новичка не должно быть тренера';
  assert public.accept_invite(inv_old) = 'expired', 'просроченная ссылка';
  assert public.accept_invite(gen_random_uuid()) = 'invalid', 'несуществующая ссылка';
  begin
    insert into public.invites default values;
    assert false, 'атлет создал приглашение';
  exception when insufficient_privilege then null;
  end;

  -- Приглашения
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  assert public.accept_invite(inv1) = 'ok', 'атлет 1 не принял приглашение';
  assert public.accept_invite(inv1) = 'ok', 'повторное открытие своей ссылки';
  assert public.my_coach_id() = coach1, 'атлет 1 не у своего тренера';
  assert public.accept_invite(inv3) = 'has_other_coach', 'чужой тренер при уже имеющемся';

  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  assert public.accept_invite(inv1) = 'used', 'ссылка сработала второй раз';
  assert public.accept_invite(inv2) = 'ok', 'атлет 2 не принял приглашение';

  perform set_config('request.jwt.claims', json_build_object('sub', a3, 'role', 'authenticated')::text, true);
  assert public.accept_invite(inv3) = 'ok', 'атлет 3 не принял приглашение';

  perform set_config('request.jwt.claims', json_build_object('sub', coach2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'none', true);
  insert into public.invites (coach_id) values (coach1) returning token into inv_old;
  perform set_config('role', 'authenticated', true);
  assert public.accept_invite(inv_old) = 'is_coach', 'тренер принял приглашение как атлет';

  -- Атлет: прямые запросы к базе
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.profiles;
  assert n = 2, 'атлет должен видеть себя и тренера, видит: ' || n;
  select count(*) into n from public.profiles where id in (a2, a3, coach2);
  assert n = 0, 'атлет видит чужих атлетов или чужого тренера';
  select count(*) into n from public.coach_athletes;
  assert n = 0, 'атлету видна таблица связей с заметками';
  select count(*) into n from public.invites;
  assert n = 0, 'атлет видит приглашения';
  select count(*) into n from public.coach_emails;
  assert n = 0, 'атлет видит список тренеров';

  update public.profiles set theme = 'dark', palette = 'Лаванда' where id = a1;
  get diagnostics n = row_count;
  assert n = 1, 'атлет не смог сохранить свою тему';
  update public.profiles set name = 'взлом' where id = a2;
  get diagnostics n = row_count;
  assert n = 0, 'атлет изменил чужой профиль';
  begin
    update public.profiles set role = 'coach' where id = a1;
    assert false, 'атлет сделал себя тренером';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.coach_athletes (coach_id, athlete_id) values (coach2, a1);
    assert false, 'атлет сам привязался к тренеру';
  exception when insufficient_privilege then null;
  end;

  -- Упражнения: атлет
  select count(*) into n from public.exercises;
  assert n >= 870, 'атлет не видит упражнения';
  update public.exercises set name = 'взлом' where id = base_id;
  get diagnostics n = row_count;
  assert n = 0, 'атлет изменил упражнение из базы';
  insert into public.exercises (name, source) values ('Своё упражнение атлета', 'athlete');
  begin
    insert into public.exercises (name, source) values ('Подделка', 'coach');
    assert false, 'атлет добавил упражнение от имени тренера';
  exception when insufficient_privilege then null;
  end;

  -- Тренер: только свои
  perform set_config('request.jwt.claims', json_build_object('sub', coach1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.profiles;
  assert n = 3, 'тренер должен видеть себя и двух своих, видит: ' || n;
  select count(*) into n from public.profiles where id in (a3, coach2, newcomer);
  assert n = 0, 'тренер видит чужих атлетов';
  update public.coach_athletes set note = 'заметка' where athlete_id = a1;
  get diagnostics n = row_count;
  assert n = 1, 'тренер не сохранил заметку';
  update public.coach_athletes set note = 'взлом' where athlete_id = a3;
  get diagnostics n = row_count;
  assert n = 0, 'тренер изменил заметку чужого атлета';
  update public.exercises set name = name, video_url = 'https://rutube.ru/video/1/' where id = base_id;
  get diagnostics n = row_count;
  assert n = 1, 'тренер не смог изменить упражнение';
  begin
    update public.exercises set video_url = 'javascript:alert(1)' where id = base_id;
    assert false, 'база приняла ссылку javascript:';
  exception when check_violation then null;
  end;

  -- Без входа ничего не видно
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into n from public.profiles;
  assert n = 0, 'без входа видны профили';
  select count(*) into n from public.exercises;
  assert n = 0, 'без входа видны упражнения';

  raise exception 'RLS_OK: все проверки пройдены, тестовые данные откатываются';
end
$$;
