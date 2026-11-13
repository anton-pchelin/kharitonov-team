-- Этап 7: лента тренера (отметка «просмотрено»), видео подхода от атлета (хранится 30 дней).

alter table public.workouts add column reviewed_at timestamptz;  -- тренер посмотрел — уходит из «ждут ответа»

alter table public.comments
  add column video_path text,                              -- videos/<athlete_id>/<id>.<ext>
  add column video_deleted boolean not null default false; -- старше 30 дней — файл удалён, отметка осталась

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 20971520, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;
create policy "видео: атлет и его тренер" on storage.objects for all to authenticated
  using (bucket_id = 'videos' and public.is_me_or_my_athlete(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'videos' and public.is_me_or_my_athlete(((storage.foldername(name))[1])::uuid));

-- Занятое место в хранилище (фото и видео атлетов тренера) — для строки «Файлов загружено» и предупреждения >90%.
create function public.storage_usage() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
  from storage.objects o
  where o.bucket_id in ('progress', 'videos')
    and ((storage.foldername(o.name))[1])::uuid in (
      select athlete_id from public.coach_athletes where coach_id = auth.uid()
      union select auth.uid())
$$;
revoke execute on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;

-- Видео старше 30 дней: какие файлы удалить (функция telegram удаляет их через API хранилища и ставит отметку).
create function public.expired_videos() returns table (id uuid, video_path text)
language sql stable security definer set search_path = '' as $$
  select id, video_path from public.comments
  where video_path is not null and created_at < now() - interval '30 days'
$$;
revoke execute on function public.expired_videos() from public, anon, authenticated;
