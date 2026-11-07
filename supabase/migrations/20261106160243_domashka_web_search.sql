begin;
-- Search queries/snippets and API secrets are NEVER stored here. The ledger is
-- a conservative reservation: a timeout does not refund a possibly billed call.
create table domashka_private.search_requests (
 id uuid primary key, user_id uuid not null references public.domashka_profiles(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp()
);
create index domashka_search_user_time on domashka_private.search_requests(user_id,created_at);
create table domashka_private.search_budget (
 month date primary key, used integer not null default 0 check (used between 0 and 900)
);
revoke all on domashka_private.search_requests,domashka_private.search_budget from public,anon,authenticated;

-- Only the server-only Edge credential may reserve. A user cannot consume
-- other families' monthly credits by invoking an authenticated public RPC.
create function public.domashka_reserve_search(actor_id uuid,actor_session uuid,request_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare p public.domashka_profiles; at_time timestamptz; month_start date; total integer;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 if actor_id is null or actor_session is null or request_id is null then raise exception 'Missing search identity'; end if;
 perform pg_advisory_xact_lock(hashtext('domashka_search_budget'));
 -- Same active-session checks as the app actor, with the user/session taken
 -- from a JWT already verified by Auth.getUser in the Edge Function.
 select profile.* into p from public.domashka_profiles profile
 join auth.users u on u.id=profile.id and (profile.role='child' or u.email_confirmed_at is not null)
 join auth.sessions s on s.user_id=profile.id and s.id=actor_session
 where profile.id=actor_id and not profile.disabled and s.created_at>=profile.session_not_before
 and not exists(select 1 from domashka_private.revoked_sessions r where r.id=s.id);
 if p.id is null or (p.role='child' and (not p.allow_ai or p.tutor_only)) then
  raise exception 'Search not allowed for this session or policy' using errcode='42501'; end if;
 at_time := clock_timestamp(); month_start := date_trunc('month',at_time at time zone 'UTC')::date;
 -- Keep at most two months of request IDs; not a permanent browsing history.
 delete from domashka_private.search_requests where created_at < (month_start - interval '1 month');
 delete from domashka_private.search_budget where month < (month_start - interval '1 month')::date;
 if exists(select 1 from domashka_private.search_requests where id=request_id) then raise exception 'Search request already reserved' using errcode='23505'; end if;
 if (select count(*) from domashka_private.search_requests where user_id=p.id and created_at>at_time-interval '1 hour')>=8
 or (select count(*) from domashka_private.search_requests where user_id=p.id and created_at>at_time-interval '1 day')>=30 then
  raise exception 'Personal search quota reached' using errcode='P0001'; end if;
 insert into domashka_private.search_budget(month,used) values(month_start,0) on conflict do nothing;
 select used into total from domashka_private.search_budget where month=month_start;
 if total>=900 then raise exception 'Monthly search quota reached' using errcode='P0001'; end if;
 insert into domashka_private.search_requests(id,user_id,created_at) values(request_id,p.id,at_time);
 update domashka_private.search_budget set used=used+1 where month=month_start;
 return true;
end $$;
revoke all on function public.domashka_reserve_search(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.domashka_reserve_search(uuid,uuid,uuid) to service_role;
commit;
