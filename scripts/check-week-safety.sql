-- Временные записи откатываются после успешной проверки.
begin;
do $$
declare
  coach uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  mail text := 'week-' || coach || '@example.com';
  source_week date := public.monday(current_date + 21);
  target_week date := source_week + 7;
  with_history uuid := gen_random_uuid();
  skipped uuid := gen_random_uuid();
  movable uuid := gen_random_uuid();
  occupied uuid := gen_random_uuid();
  item uuid := gen_random_uuid();
  comment_id uuid := gen_random_uuid();
  exercise_id uuid := gen_random_uuid();
  prog uuid;
  last_workout uuid;
  last_item uuid := gen_random_uuid();
  report jsonb;
  plan jsonb := '[{"name":"Жим","result_type":"weight_reps","planned_sets":1}]';
begin
  insert into public.coach_emails values (mail);
  insert into auth.users (id, email) values (coach, mail), (a, 'a-' || mail), (b, 'b-' || mail), (outsider, 'x-' || mail);
  insert into public.coach_athletes (coach_id, athlete_id) values (coach,a), (coach,b);
  insert into public.workouts (id, athlete_id, date, title, published, completed_at) values
    (with_history, a, source_week, 'История', true, null),
    (skipped, a, source_week + 1, 'Пропуск', true, null),
    (movable, a, source_week + 2, 'Перенос', true, null),
    (occupied, b, target_week + 1, 'Выполнено', true, now());
  insert into public.workout_items (id, workout_id, name) values (item,with_history,'Жим');
  insert into public.set_results (item_id, set_no, athlete_id, weight, reps) values (item,1,a,40,10);
  insert into public.comments (id, workout_id, item_id, author_id, text) values (comment_id,with_history,item,coach,'История');
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',json_build_object('sub',coach,'role','authenticated')::text,true);

  report := public.copy_week_report(a,source_week,array[a],source_week,'replace',true);
  assert (report->>'placed')::int = 0 and (report->>'moved')::int = 0, 'перенос к себе изменил план';
  assert exists (select 1 from public.workouts where id = movable), 'исчез исходник при переносе к себе';

  report := public.copy_week_report(a,source_week,array[a,b],target_week,'skip',true);
  assert (report->>'placed')::int = 5 and (report->>'moved')::int = 1, 'неверные итоги группового переноса';
  assert report->'issues' @> jsonb_build_array(jsonb_build_object('athlete_id',b,'date',target_week+1,'reason','occupied')),
    'нет причины пропуска для атлета и дня';
  assert exists (select 1 from public.workouts where id = with_history), 'удалена тренировка с историей';
  assert exists (select 1 from public.workouts where id = skipped), 'удалён неполностью перенесённый исходник';
  assert not exists (select 1 from public.workouts where id = movable), 'успешно перенесённый исходник остался';
  assert exists (select 1 from public.set_results where item_id = item), 'потерян подход';
  assert exists (select 1 from public.comments where id = comment_id), 'потерян комментарий';
  assert not public.place_workout(b,target_week+1,'Замена','',plan,'replace'), 'старый вызов заменил выполненную тренировку';
  assert public.copy_week(a,source_week,array[b],target_week,'skip',true) = 0, 'старый вызов нарушил пропуск';
  assert exists (select 1 from public.workouts where id = skipped), 'старый вызов удалил пропущенный исходник';

  insert into public.programs (name,weeks) values ('Программа',1) returning id into prog;
  insert into public.program_workouts (program_id,week,day,title,items) values
    (prog,1,1,'Первое назначение',plan), (prog,1,1,'Второе назначение',plan);
  report := public.assign_program_report(prog,array[a,b],target_week,'replace');
  assert (report->>'placed')::int = 2, 'замена потеряла одно из двух заданий либо удалила защищённое';
  assert (select count(*) from public.workouts where athlete_id = a and date = target_week+1) = 2,
    'замена удалила одну из назначаемых тренировок';
  assert report->'issues' @> jsonb_build_array(jsonb_build_object('athlete_id',b,'date',target_week+1,'reason','target_history')),
    'нет причины сохранения истории в отчёте';
  assert exists (select 1 from public.workouts where id = occupied and completed_at is not null), 'программа удалила выполненную тренировку';
  begin
    perform public.place_workout(outsider,target_week,'Чужой атлет','',plan,'add');
    assert false, 'тренер записал данные чужому атлету';
  exception when insufficient_privilege then null;
  end;

  -- Удаление последней позиции оставляет тренировку и историю атлета.
  last_workout := public.save_workout(jsonb_build_object('athlete_id', a, 'date', target_week + 4, 'title', 'Последнее задание'),
    jsonb_build_array(jsonb_build_object('id',last_item,'position',0,'name','Жим','result_type','weight_reps','planned_sets',1)));
  perform set_config('role','none',true);
  insert into public.set_results (item_id,set_no,athlete_id,weight,reps) values (last_item,1,a,55,10);
  perform set_config('role','authenticated',true);
  perform public.save_workout(jsonb_build_object('id',last_workout,'athlete_id',a,'date',target_week+4,'title','Последнее задание'), '[]');
  assert exists (select 1 from public.workout_items where id=last_item and self), 'последнее задание с историей не сохранено';
  assert exists (select 1 from public.set_results where item_id=last_item), 'удалены подходы последнего задания';
  perform public.save_workout(jsonb_build_object('id',last_workout,'athlete_id',a,'date',target_week+4,'title','Последнее задание'), '[]');
  assert exists (select 1 from public.workout_items where id=last_item and self), 'повтор сохранил тренировку с потерей истории';

  -- Повтор после потерянного ответа использует тот же первичный ключ.
  insert into public.comments (id,workout_id,item_id,text) values (comment_id,with_history,item,'История') on conflict (id) do nothing;
  insert into public.exercises (id,name,source) values (exercise_id,'Жим с повтором','coach') on conflict (id) do nothing;
  insert into public.exercises (id,name,source) values (exercise_id,'Жим с повтором','coach') on conflict (id) do nothing;
  assert (select count(*) from public.exercises where id = exercise_id) = 1, 'повтор создал дубль упражнения';
end
$$;
rollback;
