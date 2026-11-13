-- Палитры без чужого названия: «TRNR» → «Классика».
update public.profiles set palette = 'Классика' where palette = 'TRNR';
update public.profiles set palette = 'Классика мягкая' where palette = 'TRNR мягкий';
alter table public.profiles alter column palette set default 'Классика';
