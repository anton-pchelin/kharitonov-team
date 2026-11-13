-- Этап 3: результаты подходов, комментарии, завершение тренировки атлетом.

create table public.set_results (
  item_id uuid not null references public.workout_items on delete cascade,
  set_no int not null check (set_no between 1 and 100),
  athlete_id uuid not null default auth.uid() references public.profiles on delete cascade,
  weight numeric check (weight >= 0 and weight < 1000),
  reps int check (reps >= 0 and reps < 10000),
  time_sec int check (time_sec >= 0),
  meters numeric check (meters >= 0),
  calories numeric check (calories >= 0),
  rounds int check (rounds >= 0),
  done boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (item_id, set_no)
);
create index on public.set_results (athlete_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts on delete cascade,
  item_id uuid references public.workout_items on delete set null,
  author_id uuid not null default auth.uid() references public.profiles on delete cascade,
  text text not null default '',
  created_at timestamptz not null default now()
);
create index on public.comments (workout_id);

alter table public.set_results enable row level security;
alter table public.comments enable row level security;

-- Атлет пишет результаты в свои тренировки за последние 7 дней (и вперёд); тренер — только смотрит.
create function public.can_write_results(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workout_items i join public.workouts w on w.id = i.workout_id
    where i.id = p_item and w.athlete_id = auth.uid() and (w.published or w.self) and w.date >= current_date - 7
  )
$$;
revoke execute on function public.can_write_results(uuid) from public, anon;
grant execute on function public.can_write_results(uuid) to authenticated;

create policy "результаты: видеть" on public.set_results for select to authenticated
  using (athlete_id = auth.uid() or public.is_my_athlete(athlete_id));
create policy "результаты: атлет пишет" on public.set_results for insert to authenticated
  with check (athlete_id = auth.uid() and public.can_write_results(item_id));
create policy "результаты: атлет правит" on public.set_results for update to authenticated
  using (athlete_id = auth.uid() and public.can_write_results(item_id))
  with check (athlete_id = auth.uid() and public.can_write_results(item_id));
create policy "результаты: атлет удаляет" on public.set_results for delete to authenticated
  using (athlete_id = auth.uid() and public.can_write_results(item_id));

create policy "комментарии: видеть" on public.comments for select to authenticated
  using (exists (select 1 from public.workouts w where w.id = workout_id));
create policy "комментарии: писать" on public.comments for insert to authenticated
  with check (author_id = auth.uid() and exists (
    select 1 from public.workouts w where w.id = workout_id and (w.athlete_id = auth.uid() or public.is_my_athlete(w.athlete_id))
  ));
create policy "комментарии: удалить свой" on public.comments for delete to authenticated
  using (author_id = auth.uid());

-- Завершить тренировку может только сам атлет.
create function public.complete_workout(p_id uuid, p_at timestamptz default now()) returns void
language sql security definer set search_path = '' as $$
  update public.workouts set completed_at = coalesce(completed_at, p_at)
  where id = p_id and athlete_id = auth.uid()
$$;
revoke execute on function public.complete_workout(uuid, timestamptz) from public, anon;
grant execute on function public.complete_workout(uuid, timestamptz) to authenticated;

-- Тренер убрал задание, у которого уже есть результаты атлета, — задание остаётся как «сам», результаты не теряются.
create or replace function public.save_workout(w jsonb, items jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  wid uuid := coalesce((w ->> 'id')::uuid, gen_random_uuid());
  is_self boolean := coalesce((w ->> 'self')::boolean, false);
  keep uuid[] := array(select (x ->> 'id')::uuid from jsonb_array_elements(items) x);
begin
  if jsonb_array_length(items) = 0 then raise exception 'Добавьте хотя бы одно задание'; end if;

  insert into public.workouts (id, athlete_id, date, title, prescription, published, self)
  values (wid, (w ->> 'athlete_id')::uuid, (w ->> 'date')::date, coalesce(w ->> 'title', ''),
          coalesce(w ->> 'prescription', ''), coalesce((w ->> 'published')::boolean, false), is_self)
  on conflict (id) do update set
    date = excluded.date, title = excluded.title, prescription = excluded.prescription,
    published = excluded.published, updated_at = now();

  update public.workout_items i set self = true
  where i.workout_id = wid and i.self = is_self and not is_self and i.id <> all (keep)
    and exists (select 1 from public.set_results r where r.item_id = i.id);
  delete from public.workout_items i
  where i.workout_id = wid and i.self = is_self and i.id <> all (keep);

  insert into public.workout_items
    (id, workout_id, position, exercise_id, name, plan_text, video_url, result_type, planned_sets, superset, block_note, self)
  select (x ->> 'id')::uuid, wid, (x ->> 'position')::int, nullif(x ->> 'exercise_id', '')::uuid, x ->> 'name',
         coalesce(x ->> 'plan_text', ''), nullif(x ->> 'video_url', ''), x ->> 'result_type',
         (x ->> 'planned_sets')::int, (x ->> 'superset')::int, coalesce(x ->> 'block_note', ''), is_self
  from jsonb_array_elements(items) x
  on conflict (id) do update set
    position = excluded.position, exercise_id = excluded.exercise_id, name = excluded.name,
    plan_text = excluded.plan_text, video_url = excluded.video_url, result_type = excluded.result_type,
    planned_sets = excluded.planned_sets, superset = excluded.superset, block_note = excluded.block_note;
  return wid;
end
$$;
