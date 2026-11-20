-- Тренер может сам заниматься у другого тренера (принять его приглашение).
-- Режим «сам себе атлет» убран: связь тренер = атлет больше не нужна и запрещена.
drop function public.coach_self_link();
delete from public.coach_athletes where coach_id = athlete_id;
alter table public.coach_athletes add constraint coach_athletes_not_self check (coach_id <> athlete_id);

create or replace function public.accept_invite(p_token uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invites;
  my_coach uuid;
begin
  if auth.uid() is null then return 'not_logged_in'; end if;

  select * into inv from public.invites where token = p_token for update;
  if not found then return 'invalid'; end if;
  if inv.coach_id = auth.uid() then return 'own_invite'; end if;

  select coach_id into my_coach from public.coach_athletes where athlete_id = auth.uid();
  if my_coach is not null then
    return case when my_coach = inv.coach_id then 'ok' else 'has_other_coach' end;
  end if;

  if inv.used_at is not null then return 'used'; end if;
  if inv.expires_at < now() then return 'expired'; end if;

  -- роль не меняется: тренер, принявший приглашение, остаётся тренером своих атлетов
  insert into public.coach_athletes (coach_id, athlete_id) values (inv.coach_id, auth.uid());
  update public.invites set used_by = auth.uid(), used_at = now() where token = p_token;
  return 'ok';
end
$$;
