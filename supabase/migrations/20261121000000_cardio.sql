-- Кардио-тренажёры (Concept2 и аналоги): тип результата «кардио» = время + метры + средний пульс.

alter table public.set_results add column hr int check (hr between 0 and 300);  -- средний пульс, руками с часов

-- Новый тип в задании. Имя старой проверки задал Postgres — ищем по столбцу.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.workout_items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%result_type%'
  loop
    execute format('alter table public.workout_items drop constraint %I', c);
  end loop;
end
$$;
alter table public.workout_items add constraint workout_items_result_type_check
  check (result_type in ('weight_reps', 'reps', 'weight', 'time', 'meters', 'calories', 'rounds', 'check', 'cardio'));

-- Тип результата, который ставится сам при выборе упражнения (пусто — «кг + повторения», как раньше).
alter table public.exercises add column default_result_type text
  check (default_result_type in ('weight_reps', 'reps', 'weight', 'time', 'meters', 'calories', 'rounds', 'check', 'cardio'));

-- Гребной тренажёр из free-exercise-db переименовываем, лыжи и байк — новые.
-- source_id у лыж и байка свой (не из free-exercise-db) — чтобы повторный запуск не плодил копии.
insert into public.exercises (source_id, name, aliases, muscles, equipment, image_url, source, default_result_type) values
  ('Rowing_Stationary', 'Гребля (Concept2 RowErg)', array['Rowing, Stationary', 'Гребной тренажёр', 'RowErg', 'Concept2'],
   array['квадрицепс'], 'тренажёр', 'https://yuhonas.github.io/free-exercise-db/exercises/Rowing_Stationary/0.jpg', 'base', 'cardio'),
  ('concept2_skierg', 'Лыжи (Concept2 SkiErg)', array['SkiErg', 'Лыжный тренажёр', 'Concept2'],
   array['широчайшие'], 'тренажёр', null, 'base', 'cardio'),
  ('concept2_bikeerg', 'Байк (Concept2 BikeErg)', array['BikeErg', 'Велотренажёр', 'Concept2'],
   array['квадрицепс'], 'тренажёр', null, 'base', 'cardio')
on conflict (source_id) do update set
  name = excluded.name, default_result_type = excluded.default_result_type,
  aliases = (select array_agg(distinct a) from unnest(public.exercises.aliases || excluded.aliases) a);
