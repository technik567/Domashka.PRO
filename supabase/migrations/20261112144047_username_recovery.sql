-- Username-only parent accounts and ten one-use recovery codes.
-- Additive migration: installed migrations remain immutable. Passwords are
-- still hashed/verified by Auth, NEVER by an application table or browser.
begin;
create table domashka_private.backup_codes (
 user_id uuid not null references public.domashka_profiles(id) on delete cascade,
 position smallint not null check(position between 1 and 10),
 code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 used_at timestamptz, created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,position), unique(user_id,code_hash)
);
-- GoTrue may UPDATE the password before applying app_metadata in another
-- statement in the SAME transaction. A private transaction receipt binds the
-- later ticket consumption to that exact password change, not a future one.
create table domashka_private.account_password_changes (
 user_id uuid primary key references public.domashka_profiles(id) on delete cascade,
 transaction_id text not null, previous_epoch timestamptz not null
);
create table domashka_private.account_tickets (
 id uuid primary key default gen_random_uuid(),
 action text not null check(action in ('register','recover')),
 login text not null, user_id uuid, code_hash text, code_hashes text[],
 auth_epoch timestamptz, used_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '2 minutes'
);
create unique index domashka_registration_user on domashka_private.account_tickets(user_id) where action='register';
create table domashka_private.account_attempts (
 id bigint generated always as identity primary key,
 action text not null check(action in ('register','recover')),
 ip_hash text not null, identity_hash text not null,
 created_at timestamptz not null default clock_timestamp()
);
create index domashka_account_attempt_time on domashka_private.account_attempts(created_at);
create index domashka_account_attempt_identity on domashka_private.account_attempts(identity_hash,created_at);
create index domashka_account_attempt_ip on domashka_private.account_attempts(ip_hash,created_at);

create function domashka_private.valid_backup_hashes(hashes text[]) returns boolean
language sql immutable set search_path = '' as $$
 select coalesce(array_ndims(hashes)=1 and cardinality(hashes)=10
   and (select count(distinct h)=10 and bool_and(h ~ '^[a-f0-9]{64}$') from unnest(hashes) h),false)
$$;
-- Service-only, before CAPTCHA verification. Rejected requests are not retried.
-- IP is an extra limit, never an authorization factor; CAPTCHA, per-identity
-- and global caps still apply even if a proxy header is spoofed/absent.
create function public.domashka_account_rate(action_name text,ip_digest text,identity_digest text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if action_name is null or action_name<>all(array['register','recover']) or
    ip_digest is null or ip_digest !~ '^[a-f0-9]{64}$' or identity_digest is null or identity_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid rate bucket'; end if;
 perform pg_advisory_xact_lock(hashtextextended('domashka_account_rate',7));
 delete from domashka_private.account_attempts where created_at<clock_timestamp()-interval '1 day';
 delete from domashka_private.account_tickets where expires_at<clock_timestamp()-interval '1 day';
 if (select count(*) from domashka_private.account_attempts where action=action_name)>=(case when action_name='register' then 500 else 1000 end) or
    (select count(*) from domashka_private.account_attempts where action=action_name and created_at>clock_timestamp()-interval '1 hour')>=(case when action_name='register' then 120 else 300 end) or
    (select count(*) from domashka_private.account_attempts where action=action_name and ip_hash=ip_digest and created_at>clock_timestamp()-interval '1 hour')>=(case when action_name='register' then 10 else 30 end) or
    (select count(*) from domashka_private.account_attempts where action=action_name and identity_hash=identity_digest and created_at>clock_timestamp()-interval '1 hour')>=(case when action_name='register' then 5 else 10 end)
 then raise exception 'Too many account requests' using errcode='P0001'; end if;
 insert into domashka_private.account_attempts(action,ip_hash,identity_hash) values(action_name,ip_digest,identity_digest);
end $$;
create function public.domashka_register_ticket(username text,hashes text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ticket uuid; target uuid := gen_random_uuid();
begin
 if username is null or username !~ '^[a-z0-9_-]{3,24}$' or not domashka_private.valid_backup_hashes(hashes) then raise exception 'Invalid registration'; end if;
 if exists(select 1 from public.domashka_profiles where login=username) then raise exception 'Account unavailable'; end if;
 insert into domashka_private.account_tickets(action,login,user_id,code_hashes) values('register',username,target,hashes) returning id into ticket;
 return jsonb_build_object('ticket',ticket,'userId',target);
end $$;
-- Authorization does NOT consume the code. The Auth UPDATE trigger consumes it
-- in the SAME transaction as the password change, so a failed Auth update does
-- not destroy a code. Multiple tickets for the same code are harmless.
create function public.domashka_recovery_ticket(username text,hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.domashka_profiles; ticket uuid; remaining integer;
begin
 select * into p from public.domashka_profiles where login=username and role='parent' and not disabled for update;
 if p.id is null or hash is null or hash !~ '^[a-f0-9]{64}$' or
    not exists(select 1 from auth.users where id=p.id and email_confirmed_at is not null) or
    not exists(select 1 from domashka_private.backup_codes where user_id=p.id and code_hash=hash and used_at is null)
 then raise exception 'Invalid login or recovery code' using errcode='42501'; end if;
 select count(*)-1 into remaining from domashka_private.backup_codes where user_id=p.id and used_at is null;
 insert into domashka_private.account_tickets(action,login,user_id,code_hash,auth_epoch)
 values('recover',p.login,p.id,hash,p.session_not_before) returning id into ticket;
 return jsonb_build_object('ticket',ticket,'userId',p.id,'remaining',remaining);
end $$;
create function domashka_private.consume_recovery(ticket_id uuid,target uuid,password_changed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t domashka_private.account_tickets; p public.domashka_profiles; prior_epoch timestamptz;
begin
 -- Consistent lock order: profile -> ticket -> code (also used by rotation).
 select * into p from public.domashka_profiles where id=target and role='parent' and not disabled for update;
 select * into t from domashka_private.account_tickets where id=ticket_id for update;
 if password_changed then prior_epoch:=p.session_not_before;
 else select previous_epoch into prior_epoch from domashka_private.account_password_changes where user_id=target and transaction_id=pg_current_xact_id()::text; end if;
 if prior_epoch is null or p.id is null or t.id is null or t.action<>'recover' or t.user_id is distinct from target or t.used_at is not null or
    t.expires_at<clock_timestamp() or t.auth_epoch is distinct from prior_epoch
 then raise exception 'Invalid/expired recovery authorization' using errcode='42501'; end if;
 update domashka_private.backup_codes set used_at=clock_timestamp() where user_id=target and code_hash=t.code_hash and used_at is null;
 if not found then raise exception 'Recovery code unavailable' using errcode='42501'; end if;
 update domashka_private.account_tickets set used_at=clock_timestamp() where id=t.id;
end $$;

create or replace function domashka_private.guard_auth_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent uuid; t domashka_private.account_tickets; child_ticket domashka_private.admin_tickets; username text; changed boolean;
begin
 if TG_OP='INSERT' then
   -- GoTrue initially inserts provider metadata only. Bind server creation to
   -- an explicitly preallocated UUID; never rely on user-editable metadata or
   -- on app_metadata already existing at INSERT time.
   if lower(new.email) like '%@children.domashka.invalid' or new.raw_app_meta_data->>'domashka_role'='child' then
     select * into child_ticket from domashka_private.admin_tickets where id=coalesce((new.raw_app_meta_data->>'domashka_create_ticket')::uuid,new.id);
     parent:=domashka_private.consume_admin_ticket(child_ticket.id,'create_child',null,child_ticket.login);
     if new.email is distinct from child_ticket.login||'.'||(select family_code from public.domashka_profiles where id=parent)||'@children.domashka.invalid' then raise exception 'Child address mismatch'; end if;
     perform pg_advisory_xact_lock(hashtextextended(parent::text,3));
     new.raw_app_meta_data:=(coalesce(new.raw_app_meta_data,'{}')-'domashka_create_ticket')||jsonb_build_object('domashka_role','child','domashka_parent',parent,'domashka_login',child_ticket.login);
   end if;
   if lower(new.email) like '%@parents.domashka.invalid' or new.raw_app_meta_data->>'domashka_auth'='username' then
     select * into t from domashka_private.account_tickets where user_id=new.id and action='register' for update;
     if t.id is null or t.login !~ '^[a-z0-9_-]{3,24}$' or new.email is distinct from t.login||'@parents.domashka.invalid' or
        t.used_at is not null or t.expires_at<clock_timestamp() or not domashka_private.valid_backup_hashes(t.code_hashes)
       then raise exception 'Invalid registration authorization' using errcode='42501'; end if;
     update domashka_private.account_tickets set used_at=clock_timestamp() where id=t.id;
     new.raw_app_meta_data:=(coalesce(new.raw_app_meta_data,'{}')-'domashka_registration_ticket')||jsonb_build_object('domashka_role','parent','domashka_auth','username','domashka_login',t.login);
   end if;
 else
   changed:=new.encrypted_password is distinct from old.encrypted_password and coalesce(new.encrypted_password,'')<>'';
   if new.raw_app_meta_data ? 'domashka_recovery_ticket' then
     perform domashka_private.consume_recovery((new.raw_app_meta_data->>'domashka_recovery_ticket')::uuid,new.id,changed);
     new.raw_app_meta_data:=new.raw_app_meta_data-'domashka_recovery_ticket';
   end if;
   if new.raw_app_meta_data ? 'domashka_reset_ticket' then
     if not changed and not exists(select 1 from domashka_private.account_password_changes where user_id=new.id and transaction_id=pg_current_xact_id()::text) then raise exception 'Reset requires a password change in this transaction'; end if;
     perform domashka_private.consume_admin_ticket((new.raw_app_meta_data->>'domashka_reset_ticket')::uuid,'reset_child',new.id,null);
     new.raw_app_meta_data:=new.raw_app_meta_data-'domashka_reset_ticket';
   end if;
   if new.email is distinct from old.email and (lower(old.email) like '%@parents.domashka.invalid' or
       exists(select 1 from public.domashka_profiles where id=new.id and role='child')) then raise exception 'Username cannot change via email'; end if;
 end if;
 return new;
end $$;
create or replace function domashka_private.on_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent public.domashka_profiles; r text; display_login text; zone text; hashes text[];
begin
 r := case when new.raw_app_meta_data->>'domashka_role'='child' then 'child' else 'parent' end;
 if r='child' then
   select * into parent from public.domashka_profiles where id=(new.raw_app_meta_data->>'domashka_parent')::uuid and role='parent' and not disabled;
   if parent.id is null then raise exception 'Parent missing'; end if;
   if (new.raw_app_meta_data->>'domashka_login') !~ '^[a-z0-9_-]{3,24}$' then raise exception 'Invalid child login'; end if;
   display_login := (new.raw_app_meta_data->>'domashka_login') || '.' || parent.family_code;
   if new.email <> display_login || '@children.domashka.invalid' then raise exception 'Invalid child address'; end if;
   if (select count(*) from public.domashka_family_links where parent_id=parent.id) >= 20 then raise exception 'Не более 20 учеников на родителя.'; end if;
   zone := parent.time_zone;
 else
   if new.email is null or lower(new.email) like '%@children.domashka.invalid' then raise exception 'Invalid parent identity'; end if;
   if new.raw_app_meta_data->>'domashka_auth'='username' then
     display_login:=new.raw_app_meta_data->>'domashka_login';
     select code_hashes into hashes from domashka_private.account_tickets where action='register' and user_id=new.id and used_at is not null;
     if not domashka_private.valid_backup_hashes(hashes) then raise exception 'Missing registration codes'; end if;
   else display_login:=lower(new.email); end if;
   select name into zone from pg_catalog.pg_timezone_names where name=new.raw_user_meta_data->>'time_zone';
 end if;
 if not domashka_private.valid_avatar(coalesce(new.raw_user_meta_data->>'avatar','🦊')) then raise exception 'Invalid avatar'; end if;
 insert into public.domashka_profiles(id,role,login,name,avatar,grade,age,family_code,time_zone)
 values(new.id,r,display_login,btrim(coalesce(new.raw_user_meta_data->>'name','Родитель')),coalesce(new.raw_user_meta_data->>'avatar','🦊'),
   case when r='child' then (new.raw_user_meta_data->>'grade')::smallint end,
   case when r='child' then (new.raw_user_meta_data->>'age')::smallint end,
   case when r='parent' then substr(replace(gen_random_uuid()::text,'-',''),1,12) end,coalesce(zone,'UTC'));
 insert into public.domashka_stats(user_id) values(new.id);
 if r='child' then insert into public.domashka_family_links values(parent.id,new.id); end if;
 if hashes is not null then
   insert into domashka_private.backup_codes(user_id,position,code_hash) select new.id,n,h from unnest(hashes) with ordinality as codes(h,n);
   update domashka_private.account_tickets set code_hashes=null where action='register' and user_id=new.id;
 end if;
 return new;
end $$;
-- Keep the old password-reset session invalidation, and never replace a
-- username by a synthetic email address in a profile.
create or replace function domashka_private.after_auth_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare epoch timestamptz;
begin
 if new.encrypted_password is distinct from old.encrypted_password then
   select session_not_before into epoch from public.domashka_profiles where id=new.id for update;
   insert into domashka_private.account_password_changes(user_id,transaction_id,previous_epoch) values(new.id,pg_current_xact_id()::text,epoch)
     on conflict(user_id) do update set transaction_id=excluded.transaction_id,previous_epoch=excluded.previous_epoch
     where domashka_private.account_password_changes.transaction_id<>excluded.transaction_id;
   update public.domashka_profiles set session_not_before=clock_timestamp(),version=version+1 where id=new.id;
 end if;
 if new.email is distinct from old.email and new.raw_app_meta_data->>'domashka_auth' is distinct from 'username' then
   update public.domashka_profiles set login=lower(new.email),version=version+1 where id=new.id and role='parent';
 end if;
 return new;
end $$;
create function public.domashka_backup_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.require_parent(); result jsonb;
begin
 select jsonb_build_object('remaining',count(*) filter(where used_at is null),'total',count(*),'createdAt',max(created_at))
 into result from domashka_private.backup_codes where user_id=me.id;
 return result;
end $$;
-- Service-only. The original and fresh password-authenticated sessions are
-- checked again under the profile lock; revoked/stale/child sessions fail.
create function public.domashka_replace_backup_codes(actor_id uuid,actor_session uuid,proof_session uuid,hashes text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.domashka_profiles;
begin
 select * into p from public.domashka_profiles where id=actor_id and role='parent' and not disabled for update;
 if p.id is null or not domashka_private.valid_backup_hashes(hashes) or
    not exists(select 1 from auth.users where id=p.id and email_confirmed_at is not null) or
    not exists(select 1 from auth.sessions where id=actor_session and user_id=p.id and created_at>=p.session_not_before) or
    not exists(select 1 from auth.sessions where id=proof_session and user_id=p.id and created_at>=p.session_not_before and created_at>clock_timestamp()-interval '2 minutes') or
    exists(select 1 from domashka_private.revoked_sessions where id in (actor_session,proof_session))
 then raise exception 'Fresh parent authentication required' using errcode='42501'; end if;
 -- Limit authenticated rotations too; no arbitrary public bulk generation.
 if exists(select 1 from domashka_private.backup_codes where user_id=p.id and created_at>clock_timestamp()-interval '1 minute') then raise exception 'Wait one minute before replacing codes'; end if;
 delete from domashka_private.backup_codes where user_id=p.id;
 insert into domashka_private.backup_codes(user_id,position,code_hash) select p.id,n,h from unnest(hashes) with ordinality as codes(h,n);
end $$;

revoke all on domashka_private.backup_codes,domashka_private.account_tickets,domashka_private.account_attempts,domashka_private.account_password_changes from public,anon,authenticated;
revoke all on function domashka_private.valid_backup_hashes(text[]),domashka_private.consume_recovery(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.domashka_account_rate(text,text,text),public.domashka_register_ticket(text,text[]),public.domashka_recovery_ticket(text,text),public.domashka_replace_backup_codes(uuid,uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.domashka_account_rate(text,text,text),public.domashka_register_ticket(text,text[]),public.domashka_recovery_ticket(text,text),public.domashka_replace_backup_codes(uuid,uuid,uuid,text[]) to service_role;
revoke all on function public.domashka_backup_status() from public,anon,authenticated;
grant execute on function public.domashka_backup_status() to authenticated;
commit;
