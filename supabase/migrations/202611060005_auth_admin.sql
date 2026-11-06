begin;
create table domashka_private.admin_tickets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.domashka_profiles(id) on delete cascade,
 session_id uuid not null, action text not null check(action in ('create_child','reset_child')),
 child_id uuid, login text, used boolean not null default false,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '2 minutes'
);
create function public.domashka_admin_ticket(action text,child uuid default null,login text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.require_parent(case when action='reset_child' then child else null end); ticket uuid;
begin
 if action is null or action<>all(array['create_child','reset_child']) or (action='reset_child' and child is null) then raise exception 'Unknown admin action'; end if;
 if action='create_child' and (login is null or login !~ '^[a-z0-9_-]{3,24}$') then raise exception 'Логин: 3–24 латинские буквы, цифры, дефис или подчёркивание.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(me.id::text,3));
 delete from domashka_private.admin_tickets where user_id=me.id and expires_at<now()-interval '1 day';
 if (select count(*) from domashka_private.admin_tickets where user_id=me.id and created_at>now()-interval '1 hour')>=60 then raise exception 'Слишком много операций с аккаунтами. Повторите позже.'; end if;
 insert into domashka_private.admin_tickets(user_id,session_id,action,child_id,login)
 values(me.id,(auth.jwt()->>'session_id')::uuid,action,child,login) returning id into ticket;
 return ticket;
end $$;
create function domashka_private.consume_admin_ticket(ticket_id uuid,expected_action text,child uuid,child_login text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t domashka_private.admin_tickets; p public.domashka_profiles;
begin
 select * into t from domashka_private.admin_tickets where id=ticket_id for update;
 if t.id is null or t.used or t.expires_at<now() or t.action<>expected_action or
    (expected_action='reset_child' and t.child_id is distinct from child) or
    (expected_action='create_child' and t.login is distinct from child_login) then raise exception 'Invalid/expired admin authorization' using errcode='42501'; end if;
 select * into p from public.domashka_profiles where id=t.user_id and role='parent' and not disabled;
 if p.id is null or not exists(select 1 from auth.sessions s where s.id=t.session_id and s.user_id=p.id and s.created_at>=p.session_not_before)
   or exists(select 1 from domashka_private.revoked_sessions where id=t.session_id) then raise exception 'Parent session revoked' using errcode='42501'; end if;
 if expected_action='reset_child' then perform 1 from public.domashka_profiles where id=child for update; end if;
 if expected_action='reset_child' and not domashka_private.is_parent(p.id,child) then raise exception 'Parent link revoked' using errcode='42501'; end if;
 update domashka_private.admin_tickets set used=true where id=t.id;
 return p.id;
end $$;
-- Tickets close the check/use race between the Edge Function and Auth: the Auth
-- database transaction itself rechecks the session and the family relationship.
create function domashka_private.guard_auth_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent uuid;
begin
 if TG_OP='INSERT' then
   if new.raw_app_meta_data->>'domashka_role'='child' then
     parent:=domashka_private.consume_admin_ticket((new.raw_app_meta_data->>'domashka_create_ticket')::uuid,'create_child',null,new.raw_app_meta_data->>'domashka_login');
     if parent::text is distinct from new.raw_app_meta_data->>'domashka_parent' then raise exception 'Parent mismatch'; end if;
     perform pg_advisory_xact_lock(hashtextextended(parent::text,3));
     new.raw_app_meta_data:=new.raw_app_meta_data-'domashka_create_ticket';
   end if;
 else
   if new.encrypted_password is distinct from old.encrypted_password and
     new.raw_app_meta_data ? 'domashka_reset_ticket' then
     perform domashka_private.consume_admin_ticket((new.raw_app_meta_data->>'domashka_reset_ticket')::uuid,'reset_child',new.id,null);
     new.raw_app_meta_data:=new.raw_app_meta_data-'domashka_reset_ticket';
   end if;
   if new.email is distinct from old.email and exists(select 1 from public.domashka_profiles where id=new.id and role='child') then raise exception 'Child login cannot change via email'; end if;
 end if;
 return new;
end $$;
create trigger domashka_auth_admin_guard before insert or update on auth.users for each row execute function domashka_private.guard_auth_admin();
create function domashka_private.after_auth_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.encrypted_password is distinct from old.encrypted_password then
   update public.domashka_profiles set session_not_before=clock_timestamp(),version=version+1 where id=new.id;
 end if;
 if new.email is distinct from old.email then
   update public.domashka_profiles set login=lower(new.email),version=version+1 where id=new.id and role='parent';
 end if;
 return new;
end $$;
create trigger domashka_auth_updated after update on auth.users for each row execute function domashka_private.after_auth_update();
revoke all on all tables in schema domashka_private from public,anon,authenticated;
revoke all on function domashka_private.consume_admin_ticket(uuid,text,uuid,text),domashka_private.guard_auth_admin(),domashka_private.after_auth_update() from public,anon,authenticated;
revoke all on function public.domashka_admin_ticket(text,uuid,text) from public,anon,authenticated;
grant execute on function public.domashka_admin_ticket(text,uuid,text) to authenticated;
commit;
