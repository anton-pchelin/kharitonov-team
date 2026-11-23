-- Блокировки удерживаются до конца операции, чтобы атлет не потерял запись,
-- отправленную одновременно с переносом. Проверки доступа остаются в RLS.
create function public.lock_workout_has_history(p_workout uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.workouts where id = p_workout for update;
  perform 1 from public.workout_items where workout_id = p_workout order by id for update;
  return exists (select 1 from public.workouts where id = p_workout and completed_at is not null)
    or exists (select 1 from public.comments where workout_id = p_workout)
    or exists (
      select 1 from public.workout_items i join public.set_results r on r.item_id = i.id
      where i.workout_id = p_workout
    );
end
$$;

create function public.place_workout_report(p_athlete uuid, p_date date, p_title text, p_prescription text, p_items jsonb, p_conflict text)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  wid uuid := gen_random_uuid();
  existing uuid;
  checked_ids uuid[] := '{}';
begin
  if not public.is_my_athlete(p_athlete) then raise insufficient_privilege using message = 'Атлет недоступен'; end if;
  if p_conflict is null or p_conflict not in ('add', 'replace', 'skip') then
    raise exception 'Неизвестное действие для занятого дня';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bulk-workouts:' || auth.uid()::text, 0));
  if p_conflict <> 'add' then
    for existing in
      select id from public.workouts where athlete_id = p_athlete and date = p_date and not self order by id for update
    loop
      if p_conflict = 'skip' then return 'occupied'; end if;
      if public.lock_workout_has_history(existing) then return 'target_history'; end if;
      checked_ids := array_append(checked_ids, existing);
    end loop;
    if p_conflict = 'replace' then
      delete from public.workouts where id = any(checked_ids);
    end if;
  end if;

  insert into public.workouts (id, athlete_id, date, title, prescription, published)
  values (wid, p_athlete, p_date, p_title, p_prescription, true);
  insert into public.workout_items
    (workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, pct, timer)
  select wid, coalesce((x ->> 'position')::int, n::int), nullif(x ->> 'exercise_id', '')::uuid, x ->> 'name',
         coalesce(x ->> 'plan_text', ''), nullif(x ->> 'video_url', ''), coalesce(x ->> 'result_type', 'weight_reps'),
         coalesce((x ->> 'planned_sets')::int, 1), (x ->> 'superset')::int, coalesce(x ->> 'block_note', ''),
         (x ->> 'pct')::numeric, nullif(x -> 'timer', 'null'::jsonb)
  from jsonb_array_elements(p_items) with ordinality as t(x, n);
  return 'placed';
end
$$;

create function public.copy_week_report(p_from_athlete uuid, p_from_monday date, p_athletes uuid[], p_to_monday date, p_conflict text, p_move boolean default false)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  w record;
  a uuid;
  target_date date;
  target_key text;
  outcome text;
  all_placed boolean;
  placed int := 0;
  moved int := 0;
  issues jsonb := '[]';
  replaced_days text[] := '{}';
begin
  if not public.is_my_athlete(p_from_athlete) then raise insufficient_privilege using message = 'Атлет недоступен'; end if;
  if coalesce(cardinality(p_athletes), 0) = 0 then raise exception 'Выберите получателей'; end if;
  if extract(isodow from p_from_monday) is distinct from 1::numeric
     or extract(isodow from p_to_monday) is distinct from 1::numeric then raise exception 'Укажите понедельник'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bulk-workouts:' || auth.uid()::text, 0));
  for w in
    select x.*, (select coalesce(jsonb_agg(to_jsonb(i) order by i.position), '[]')
      from public.workout_items i where i.workout_id = x.id and not i.self) items
    from public.workouts x where x.athlete_id = p_from_athlete and not x.self and x.date between p_from_monday and p_from_monday + 6
    order by x.date, x.created_at, x.id for update of x
  loop
    all_placed := true;
    target_date := p_to_monday + (w.date - p_from_monday);
    for a in select distinct unnest(p_athletes) order by 1 loop
      target_key := a::text || '/' || target_date::text;
      if a = p_from_athlete and target_date = w.date then
        outcome := 'same_day';
      else
        outcome := public.place_workout_report(a, target_date, w.title, w.prescription, w.items,
          case when target_key = any(replaced_days) then 'add' else p_conflict end);
      end if;
      if outcome = 'placed' then
        placed := placed + 1;
        if p_conflict in ('replace', 'skip') and not target_key = any(replaced_days) then
          replaced_days := array_append(replaced_days, target_key);
        end if;
      else
        all_placed := false;
        issues := issues || jsonb_build_array(jsonb_build_object('athlete_id', a, 'date', target_date, 'reason', outcome));
      end if;
    end loop;
    if p_move then
      if public.lock_workout_has_history(w.id) then
        issues := issues || jsonb_build_array(jsonb_build_object('athlete_id', p_from_athlete, 'date', w.date, 'reason', 'source_history'));
      elsif not all_placed then
        issues := issues || jsonb_build_array(jsonb_build_object('athlete_id', p_from_athlete, 'date', w.date, 'reason', 'source_kept'));
      else
        delete from public.workouts where id = w.id;
        moved := moved + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('placed', placed, 'moved', moved, 'issues', issues);
end
$$;

create function public.assign_program_report(p_program uuid, p_athletes uuid[], p_start date, p_conflict text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  pw record;
  a uuid;
  target_date date;
  outcome text;
  placed int := 0;
  issues jsonb := '[]';
  handled_days date[];
begin
  if not exists (select 1 from public.programs where id = p_program) then raise insufficient_privilege using message = 'Программа недоступна'; end if;
  if coalesce(cardinality(p_athletes), 0) = 0 then raise exception 'Выберите получателей'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bulk-workouts:' || auth.uid()::text, 0));
  for a in select distinct unnest(p_athletes) order by 1 loop
    handled_days := '{}';
    for pw in select * from public.program_workouts where program_id = p_program order by week, day, created_at, id loop
      target_date := p_start + (pw.week - 1) * 7 + pw.day;
      outcome := public.place_workout_report(a, target_date, pw.title, pw.prescription, pw.items,
        case when target_date = any(handled_days) then 'add' else p_conflict end);
      if outcome = 'placed' then
        placed := placed + 1;
        if p_conflict in ('replace', 'skip') and not target_date = any(handled_days) then
          handled_days := array_append(handled_days, target_date);
        end if;
      else
        issues := issues || jsonb_build_array(jsonb_build_object('athlete_id', a, 'date', target_date, 'reason', outcome));
      end if;
    end loop;
  end loop;
  return jsonb_build_object('placed', placed, 'moved', 0, 'issues', issues);
end
$$;

create or replace function public.place_workout(p_athlete uuid, p_date date, p_title text, p_prescription text, p_items jsonb, p_conflict text)
returns boolean language sql security invoker set search_path = '' as $$
  select public.place_workout_report(p_athlete, p_date, p_title, p_prescription, p_items, p_conflict) = 'placed'
$$;

create or replace function public.copy_week(p_from_athlete uuid, p_from_monday date, p_athletes uuid[], p_to_monday date, p_conflict text, p_move boolean default false)
returns int language sql security invoker set search_path = '' as $$
  select (public.copy_week_report(p_from_athlete, p_from_monday, p_athletes, p_to_monday, p_conflict, p_move) ->> 'placed')::int
$$;

create or replace function public.assign_program(p_program uuid, p_athletes uuid[], p_start date, p_conflict text)
returns int language sql security invoker set search_path = '' as $$
  select (public.assign_program_report(p_program, p_athletes, p_start, p_conflict) ->> 'placed')::int
$$;

create function public.workout_records(p_workouts uuid[]) returns setof uuid
language sql stable security invoker set search_path = '' as $$
  select w.id from public.workouts w
  where w.id = any(p_workouts) and w.completed_at is not null and public.has_new_record(w.id)
$$;

revoke execute on function public.lock_workout_has_history(uuid),
  public.place_workout_report(uuid, date, text, text, jsonb, text),
  public.copy_week_report(uuid, date, uuid[], date, text, boolean),
  public.assign_program_report(uuid, uuid[], date, text),
  public.workout_records(uuid[]) from public, anon;
grant execute on function public.lock_workout_has_history(uuid),
  public.place_workout_report(uuid, date, text, text, jsonb, text),
  public.copy_week_report(uuid, date, uuid[], date, text, boolean),
  public.assign_program_report(uuid, uuid[], date, text),
  public.workout_records(uuid[]) to authenticated;
