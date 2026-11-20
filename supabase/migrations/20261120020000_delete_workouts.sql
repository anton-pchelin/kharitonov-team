-- Удаление тренировок: тренер — только свои (не «сам» атлета), атлет — только свои «сам».
drop policy "тренировки: удалить" on public.workouts;
create policy "тренировки: удалить" on public.workouts for delete to authenticated
  using ((public.is_my_athlete(athlete_id) and not self) or (athlete_id = auth.uid() and self));

-- Видео из комментариев удалённой тренировки: файл остаётся без комментария — его забирает ежечасная чистка
-- (функция telegram удаляет файлы и помечает комментарии по id; у осиротевших файлов id случайный — пометка ничего не трогает).
create or replace function public.expired_videos() returns table (id uuid, video_path text)
language sql stable security definer set search_path = '' as $$
  select id, video_path from public.comments
  where video_path is not null and created_at < now() - interval '30 days'
  union all
  select gen_random_uuid(), o.name from storage.objects o
  where o.bucket_id = 'videos' and o.created_at < now() - interval '1 hour'
    and not exists (select 1 from public.comments c where c.video_path = o.name)
$$;
