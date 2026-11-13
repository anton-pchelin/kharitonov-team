-- Этап 5: рекорды вручную, замеры, фото прогресса, объединение упражнений, «лучше меньше».

alter table public.exercises add column lower_is_better boolean not null default false;  -- бег на время — меньше лучше
grant update (lower_is_better) on public.exercises to authenticated;

-- Доступ «сам атлет или его тренер» — для всех таблиц прогресса.
create function public.is_me_or_my_athlete(a uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select a = auth.uid() or public.is_my_athlete(a)
$$;
revoke execute on function public.is_me_or_my_athlete(uuid) from public, anon;
grant execute on function public.is_me_or_my_athlete(uuid) to authenticated;

create table public.records (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles on delete cascade,
  exercise_id uuid references public.exercises on delete set null,
  name text not null,
  weight numeric,
  reps int,
  time_sec int,
  meters numeric,
  date date not null default current_date,
  note text not null default '',
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles on delete cascade,
  kind text not null check (length(trim(kind)) > 0),
  value numeric not null,
  date date not null default current_date,
  created_at timestamptz not null default now()
);
create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles on delete cascade,
  date date not null default current_date,
  pose text not null check (pose in ('front', 'side', 'back')),
  path text not null,  -- в хранилище progress: <athlete_id>/<id>.jpg
  created_at timestamptz not null default now()
);
create index on public.records (athlete_id);
create index on public.measurements (athlete_id);
create index on public.progress_photos (athlete_id);

alter table public.records enable row level security;
alter table public.measurements enable row level security;
alter table public.progress_photos enable row level security;
create policy "рекорды: атлет и его тренер" on public.records for all to authenticated
  using (public.is_me_or_my_athlete(athlete_id)) with check (public.is_me_or_my_athlete(athlete_id));
create policy "замеры: атлет и его тренер" on public.measurements for all to authenticated
  using (public.is_me_or_my_athlete(athlete_id)) with check (public.is_me_or_my_athlete(athlete_id));
create policy "фото: атлет и его тренер" on public.progress_photos for all to authenticated
  using (public.is_me_or_my_athlete(athlete_id)) with check (public.is_me_or_my_athlete(athlete_id));

-- Фото прогресса — закрытое хранилище, папка = id атлета.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress', 'progress', false, 1048576, array['image/jpeg']) on conflict (id) do nothing;
create policy "фото прогресса: атлет и его тренер" on storage.objects for all to authenticated
  using (bucket_id = 'progress' and public.is_me_or_my_athlete(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'progress' and public.is_me_or_my_athlete(((storage.foldername(name))[1])::uuid));

-- Тренер объединяет два названия одного упражнения: история складывается в одно.
create function public.merge_exercises(p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  src public.exercises := (select e from public.exercises e where e.id = p_from);
begin
  if not public.is_coach() then raise exception 'Только тренер' using errcode = '42501'; end if;
  if src.id is null or p_from = p_to then raise exception 'Нечего объединять'; end if;
  update public.workout_items set exercise_id = p_to
  where exercise_id = p_from or (exercise_id is null and lower(name) = lower(src.name));
  update public.item_templates set exercise_id = p_to where exercise_id = p_from;
  update public.records set exercise_id = p_to where exercise_id = p_from;
  update public.exercises set aliases = (select array_agg(distinct a) from unnest(aliases || src.name || src.aliases) a)
  where id = p_to;
  delete from public.exercises where id = p_from;
end
$$;
revoke execute on function public.merge_exercises(uuid, uuid) from public, anon;
grant execute on function public.merge_exercises(uuid, uuid) to authenticated;

-- % выполнения плана тренера по атлетам за период (для списка атлетов).
create function public.completion_stats(p_from date, p_to date default current_date)
returns table (athlete_id uuid, planned int, done int)
language sql stable security invoker set search_path = '' as $$
  select w.athlete_id, count(i.id)::int,
         count(i.id) filter (where exists (select 1 from public.set_results r where r.item_id = i.id
           and (r.done or r.weight is not null or r.reps is not null or r.time_sec is not null
                or r.meters is not null or r.calories is not null or r.rounds is not null)))::int
  from public.workouts w join public.workout_items i on i.workout_id = w.id and not i.self
  where w.published and not w.self and w.date between p_from and p_to
  group by w.athlete_id
$$;

-- Новый рекорд (расчётный 1ПМ по Эпли выше всех прошлых в этом упражнении) — 🏆 в сообщении тренеру.
create function public.has_new_record(p_workout uuid) returns boolean
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
    select 1 from cur where cur.best > coalesce((
      select max(r.weight * (1 + case when r.reps > 1 then r.reps / 30.0 else 0 end))
      from public.workouts w join public.workout_items i on i.workout_id = w.id
      join public.set_results r on r.item_id = i.id
      where w.athlete_id = cur.athlete_id and w.date < cur.date and w.id <> p_workout
        and coalesce(i.exercise_id::text, lower(i.name)) = cur.k and r.weight > 0 and r.reps > 0), 0)
  )
$$;

create or replace function public.on_workout_completed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  coach uuid := (select coach_id from public.coach_athletes where athlete_id = new.athlete_id);
  total int; done int; has_comments boolean;
begin
  if old.completed_at is not null or new.completed_at is null or coach is null then return new; end if;
  if not (select notify_completed from public.profiles where id = coach) then return new; end if;
  select count(*), count(*) filter (where exists (
    select 1 from public.set_results r where r.item_id = i.id
      and (r.done or r.weight is not null or r.reps is not null or r.time_sec is not null
           or r.meters is not null or r.calories is not null or r.rounds is not null)))
    into total, done
  from public.workout_items i where i.workout_id = new.id and not i.self;
  has_comments := exists (select 1 from public.comments where workout_id = new.id and author_id = new.athlete_id);
  perform public.notify(coach,
    (select coalesce(nullif(name, ''), 'Атлет') from public.profiles where id = new.athlete_id)
      || ': выполнена «' || coalesce(nullif(new.title, ''), 'Тренировка') || '»'
      || case when new.self then ' (своя)' else ' (' || done || ' из ' || total || ')' end
      || case when has_comments then ', есть комментарий' else '' end
      || case when public.has_new_record(new.id) then ' 🏆 новый рекорд' else '' end,
    '#/plan/' || new.athlete_id || '/' || public.monday(new.date) || '/' || new.id,
    'done:' || new.id);
  return new;
end
$$;
