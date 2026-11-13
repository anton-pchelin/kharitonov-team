-- Тренер может убрать картинку у упражнения (кто что правит — политика из init).
grant update (image_url) on public.exercises to authenticated;
