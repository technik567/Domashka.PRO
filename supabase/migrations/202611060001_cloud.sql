-- Домашка.ПРО: opt-in cloud backend. No local credentials are imported.
-- Run with the project owner's migration role. Never expose service_role.
begin;
create schema if not exists domashka_private;
revoke all on schema domashka_private from public, anon, authenticated;

create table public.domashka_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('parent','child')),
  login text not null unique check (length(login) between 3 and 254),
  name text not null check (length(btrim(name)) between 1 and 60),
  avatar text not null default '🦊' check (octet_length(avatar) < 100000),
  grade smallint, age smallint,
  family_code text unique,
  time_zone text not null default 'UTC',
  tutor_only boolean not null default true,
  allow_ai boolean not null default true,
  free_model text not null default 'auto' check(free_model ~ '^[a-z0-9_.-]{1,80}$'),
  disabled boolean not null default false,
  session_not_before timestamptz not null default '1970-01-01',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  check ((role = 'parent' and grade is null and age is null and family_code is not null)
    or (role = 'child' and grade is not null and age is not null and grade between 1 and 11 and age between 5 and 21 and family_code is null))
);
create table public.domashka_family_links (
  parent_id uuid not null references public.domashka_profiles(id) on delete cascade,
  child_id uuid not null references public.domashka_profiles(id) on delete cascade,
  primary key(parent_id,child_id), check(parent_id <> child_id)
);
create index domashka_links_child on public.domashka_family_links(child_id);
create table public.domashka_documents (
  user_id uuid not null references public.domashka_profiles(id) on delete cascade,
  key text not null check (length(key) between 1 and 180),
  value jsonb,
  version bigint not null default 1,
  deleted boolean not null default false,
  mutation_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key(user_id,key), check(octet_length(coalesce(value::text,'')) <= 500000)
);
create table public.domashka_stats (
  user_id uuid primary key references public.domashka_profiles(id) on delete cascade,
  xp bigint not null default 0 check(xp >= 0),
  solved_count integer not null default 0, checked_count integer not null default 0,
  quiz_correct integer not null default 0, streak_days integer not null default 0,
  last_active_date date, version bigint not null default 1,
  imported_xp bigint not null default 0 check(imported_xp between 0 and 10000000),
  legacy_imported boolean not null default false
);
create table domashka_private.activity_events (
  user_id uuid not null references public.domashka_profiles(id) on delete cascade,
  id uuid not null, kind text not null, created_at timestamptz not null default now(),
  primary key(user_id,id)
);
create index domashka_activity_day on domashka_private.activity_events(user_id,created_at);
create table domashka_private.revoked_sessions (
  id uuid primary key, user_id uuid not null references public.domashka_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table domashka_private.family_invitations (
  code text primary key, child_id uuid not null references public.domashka_profiles(id) on delete cascade,
  created_by uuid not null references public.domashka_profiles(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);
create table domashka_private.invite_attempts (
  user_id uuid primary key references public.domashka_profiles(id) on delete cascade,
  window_start timestamptz not null default now(), attempts integer not null default 0
);
create table public.domashka_homework (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.domashka_profiles(id) on delete cascade,
  author_id uuid not null references public.domashka_profiles(id),
  author_name text not null,
  subject text not null check(length(subject) between 1 and 40),
  title text not null check(length(btrim(title)) between 1 and 200),
  instructions text not null check(length(btrim(instructions)) between 1 and 12000),
  due date, status text not null default 'assigned' check(status in ('assigned','submitted','accepted','revision')),
  submission jsonb, review jsonb, version bigint not null default 1,
  mutation_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index domashka_homework_child on public.domashka_homework(child_id,updated_at desc);

-- Called from policies as well as RPCs. A JWT alone is not sufficient: check
-- the real Auth session, disabled state, password-reset epoch and app logout.
create function domashka_private.active_user() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.domashka_profiles p
  join auth.users u on u.id=p.id and (p.role='child' or u.email_confirmed_at is not null)
  join auth.sessions s on s.user_id=p.id and s.id::text=(auth.jwt()->>'session_id')
  where p.id=auth.uid() and not p.disabled and s.created_at >= p.session_not_before
    and not exists(select 1 from domashka_private.revoked_sessions r where r.id=s.id)
$$;
create function domashka_private.actor() returns public.domashka_profiles
language plpgsql stable security definer set search_path = '' as $$
declare p public.domashka_profiles;
begin
  select * into p from public.domashka_profiles where id=domashka_private.active_user();
  if p.id is null then raise exception 'Сеанс недоступен. Войдите заново; проверьте ограничения родителя.' using errcode='42501'; end if;
  return p;
end $$;
create function domashka_private.is_parent(parent uuid, child uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.domashka_family_links l
   join public.domashka_profiles p on p.id=l.parent_id and p.role='parent' and not p.disabled
   where l.parent_id=parent and l.child_id=child)
$$;
create function domashka_private.require_parent(child uuid default null) returns public.domashka_profiles
language plpgsql stable security definer set search_path = '' as $$
declare p public.domashka_profiles := domashka_private.actor();
begin
 if p.role <> 'parent' or (child is not null and not domashka_private.is_parent(p.id,child)) then
   raise exception 'Действие доступно только родителю своего ученика.' using errcode='42501'; end if;
 return p;
end $$;
create function domashka_private.valid_avatar(value text) returns boolean
language sql immutable set search_path = '' as $$
 select value in ('🦊','🐱','🐼','🦉','🐸','🐯','🐨','🐰','🚀','🌟','🎨','🧑‍🏫') or
   (octet_length(value)<100000 and value ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$')
$$;

-- ONLY the server-controlled app_metadata can create a child. User-editable
-- user_metadata never determines the role, parent link or access policies.
create function domashka_private.on_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent public.domashka_profiles; r text; display_login text; zone text;
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
   if new.email is null or lower(new.email) like '%@children.domashka.invalid' then raise exception 'Родителю нужна настоящая почта.'; end if;
   display_login := lower(new.email);
   select name into zone from pg_catalog.pg_timezone_names where name=new.raw_user_meta_data->>'time_zone';
 end if;
 if not domashka_private.valid_avatar(coalesce(new.raw_user_meta_data->>'avatar','🦊')) then raise exception 'Invalid avatar'; end if;
 insert into public.domashka_profiles(id,role,login,name,avatar,grade,age,family_code,time_zone)
 values(new.id,r,display_login,btrim(coalesce(new.raw_user_meta_data->>'name','Родитель')),
   coalesce(new.raw_user_meta_data->>'avatar','🦊'),
   case when r='child' then (new.raw_user_meta_data->>'grade')::smallint end,
   case when r='child' then (new.raw_user_meta_data->>'age')::smallint end,
   case when r='parent' then substr(replace(gen_random_uuid()::text,'-',''),1,12) end,coalesce(zone,'UTC'));
 insert into public.domashka_stats(user_id) values(new.id);
 if r='child' then insert into public.domashka_family_links values(parent.id,new.id); end if;
 return new;
end $$;
create trigger domashka_auth_created after insert on auth.users for each row execute function domashka_private.on_auth_user();

create function domashka_private.profile_json(p public.domashka_profiles, full_login boolean default true) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',p.id,'role',p.role,'login',case when full_login then p.login else '' end,
 'name',p.name,'avatar',p.avatar,'grade',p.grade,'age',p.age,'disabled',p.disabled,'version',p.version,
 'familyCode',case when full_login then p.family_code end,'timeZone',p.time_zone,
 'parentIds',coalesce((select jsonb_agg(l.parent_id order by l.parent_id) from public.domashka_family_links l where l.child_id=p.id),'[]'::jsonb),
 'policy',jsonb_build_object('tutorOnly',p.tutor_only,'allowAi',p.allow_ai,'aiSettingsOwnerId','','freeModel',p.free_model))
$$;
create function domashka_private.stats_json(target uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('xp',s.xp+s.imported_xp,'earnedXp',s.xp,'importedXp',s.imported_xp,
 'legacyImported',s.legacy_imported,'solvedCount',s.solved_count,'checkedCount',s.checked_count,'quizCorrect',s.quiz_correct,
 'streakDays',s.streak_days,'lastActiveDate',coalesce(s.last_active_date::text,''),'version',s.version)
 from public.domashka_stats s where s.user_id=target
$$;
create function public.domashka_get_family() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); children jsonb; parents jsonb; summaries jsonb;
begin
 select coalesce(jsonb_agg(domashka_private.profile_json(c) order by c.created_at),'[]'::jsonb) into children
 from public.domashka_profiles c where domashka_private.is_parent(me.id,c.id);
 select coalesce(jsonb_agg(domashka_private.profile_json(p,false)),'[]'::jsonb) into parents
 from public.domashka_profiles p where p.role='parent' and p.id<>me.id and p.id in
   (select l.parent_id from public.domashka_family_links l where l.child_id=me.id
      or domashka_private.is_parent(me.id,l.child_id));
 select coalesce(jsonb_object_agg(c.id,jsonb_build_object('stats',domashka_private.stats_json(c.id),'tasks','[]'::jsonb,'grades','{}'::jsonb)),'{}'::jsonb)
 into summaries from public.domashka_profiles c where domashka_private.is_parent(me.id,c.id);
 return jsonb_build_object('account',domashka_private.profile_json(me),'children',children,'parents',parents,
   'summaries',summaries,'stats',domashka_private.stats_json(me.id));
end $$;

create function public.domashka_update_appearance(new_name text,new_avatar text,expected_version bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); changed public.domashka_profiles;
begin
 if not domashka_private.valid_avatar(new_avatar) then raise exception 'Некорректный аватар.'; end if;
 update public.domashka_profiles set name=btrim(new_name),avatar=new_avatar,version=version+1
 where id=me.id and version=expected_version returning * into changed;
 if changed.id is null then raise exception 'Профиль изменён на другом устройстве. Обновите страницу.' using errcode='40001'; end if;
 return domashka_private.profile_json(changed);
end $$;
create function public.domashka_update_child(child uuid,new_grade smallint,new_age smallint,new_tutor_only boolean,new_allow_ai boolean,new_disabled boolean,expected_version bigint,new_free_model text default 'auto') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare changed public.domashka_profiles;
begin
 perform domashka_private.require_parent(child);
 update public.domashka_profiles set grade=new_grade,age=new_age,tutor_only=new_tutor_only,allow_ai=new_allow_ai,
   disabled=new_disabled,free_model=new_free_model,version=version+1 where id=child and version=expected_version returning * into changed;
 if changed.id is null then raise exception 'Настройки изменились. Обновите семейный кабинет.' using errcode='40001'; end if;
 return domashka_private.profile_json(changed);
end $$;
create function public.domashka_rotate_sessions(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor();
begin
 if target<>me.id then perform domashka_private.require_parent(target); end if;
 update public.domashka_profiles set session_not_before=clock_timestamp(),version=version+1 where id=target;
end $$;
create function public.domashka_revoke_session() returns void
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor();
begin
 insert into domashka_private.revoked_sessions(id,user_id) values((auth.jwt()->>'session_id')::uuid,me.id) on conflict do nothing;
end $$;

create function public.domashka_create_link(child uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.require_parent(child); token text := upper(replace(gen_random_uuid()::text,'-',''));
begin
 perform 1 from public.domashka_profiles where id=child for update;
 perform domashka_private.require_parent(child);
 delete from domashka_private.family_invitations where child_id=child;
 insert into domashka_private.family_invitations(code,child_id,created_by) values(token,child,me.id);
 return token;
end $$;
create function public.domashka_accept_link(token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.require_parent(); invitation domashka_private.family_invitations; tries integer;
begin
 insert into domashka_private.invite_attempts(user_id,attempts) values(me.id,1)
 on conflict(user_id) do update set attempts=case when domashka_private.invite_attempts.window_start<now()-interval '1 hour' then 1 else domashka_private.invite_attempts.attempts+1 end,
 window_start=case when domashka_private.invite_attempts.window_start<now()-interval '1 hour' then now() else domashka_private.invite_attempts.window_start end returning attempts into tries;
 -- Return an error value, not an exception: failed-attempt counters must commit.
 if tries>30 then return jsonb_build_object('error','Слишком много кодов. Повторите через час.'); end if;
 select * into invitation from domashka_private.family_invitations where code=upper(btrim(token)) and expires_at>now();
 if invitation.code is null or not domashka_private.is_parent(invitation.created_by,invitation.child_id) then
   return jsonb_build_object('error','Код не найден, истёк или уже использован.'); end if;
 perform pg_advisory_xact_lock(hashtextextended(me.id::text,3));
 -- Lock child before invitation, consistently with create/revoke. Re-read the
 -- invitation after waiting; it may have been revoked or consumed meanwhile.
 perform 1 from public.domashka_profiles where id=invitation.child_id for update;
 select * into invitation from domashka_private.family_invitations where code=upper(btrim(token)) and expires_at>now() for update;
 if invitation.code is null or not domashka_private.is_parent(invitation.created_by,invitation.child_id) then
   return jsonb_build_object('error','Код не найден, истёк или уже использован.'); end if;
 if (select count(*) from public.domashka_family_links where parent_id=me.id)>=20 or
    (select count(*) from public.domashka_family_links where child_id=invitation.child_id)>=5 then
   return jsonb_build_object('error','Достигнут предел: 20 учеников или 5 родителей.'); end if;
 insert into public.domashka_family_links values(me.id,invitation.child_id) on conflict do nothing;
 delete from domashka_private.family_invitations where code=invitation.code;
 return jsonb_build_object('childId',invitation.child_id);
end $$;
create function public.domashka_revoke_link(child uuid,parent uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform domashka_private.require_parent(child);
 perform 1 from public.domashka_profiles where id=child for update;
 perform domashka_private.require_parent(child);
 if (select count(*) from public.domashka_family_links where child_id=child)<=1 then raise exception 'У ученика должен остаться хотя бы один родитель.'; end if;
 delete from public.domashka_family_links where child_id=child and parent_id=parent;
 delete from domashka_private.family_invitations where child_id=child;
end $$;

create function domashka_private.validate_document(doc_key text,doc_value jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare content jsonb;
begin
 if doc_value is null then return; end if;
 if octet_length(doc_value::text)>500000 then raise exception 'Один раздел/чат: не более 500 КБ текста. Фото хранятся отдельно.'; end if;
 if doc_key = any(array['pref/domashka_pro_student_profile_v2','pref/domashka_pro_theme_v3','pref/domashka_cheat_bookmarks_v21',
 'pref/domashka_diary_tasks_v21','pref/domashka_subject_grades_v22','pref/domashka_grade_round_frac_v22',
 'pref/domashka_timetable_v30','pref/domashka_bells_v30','pref/domashka_mistake_bank_v32']) then
   if jsonb_typeof(doc_value)<>'string' then raise exception 'Invalid preference'; end if;
   if doc_key<>'pref/domashka_pro_theme_v3' then
     content := (doc_value #>> '{}')::jsonb;
     if doc_key=any(array['pref/domashka_diary_tasks_v21','pref/domashka_cheat_bookmarks_v21','pref/domashka_mistake_bank_v32']) and jsonb_typeof(content)<>'array' then raise exception 'Expected list'; end if;
     if doc_key='pref/domashka_subject_grades_v22' and jsonb_typeof(content)<>'object' then raise exception 'Expected grades'; end if;
   end if;
 elsif doc_key ~ '^chat/[A-Za-z0-9_-]{1,128}$' then
   if jsonb_typeof(doc_value)<>'object' or doc_value->>'id'<>substr(doc_key,6)
      or jsonb_typeof(doc_value->'response_md')<>'string' then raise exception 'Invalid notebook record'; end if;
 else raise exception 'Этот тип данных не синхронизируется.' using errcode='42501'; end if;
end $$;
create function public.domashka_save_document(doc_key text,doc_value jsonb,expected_version bigint,operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); old public.domashka_documents; changed public.domashka_documents; bytes bigint; records integer;
begin
 -- Validate tombstone keys too; a client cannot create auth/settings documents.
 if doc_value is null then
   if doc_key !~ '^chat/[A-Za-z0-9_-]{1,128}$' and doc_key<>all(array['pref/domashka_pro_student_profile_v2','pref/domashka_pro_theme_v3','pref/domashka_cheat_bookmarks_v21','pref/domashka_diary_tasks_v21','pref/domashka_subject_grades_v22','pref/domashka_grade_round_frac_v22','pref/domashka_timetable_v30','pref/domashka_bells_v30','pref/domashka_mistake_bank_v32']) then raise exception 'Unsupported document'; end if;
 else perform domashka_private.validate_document(doc_key,doc_value); end if;
 if operation_id is null or expected_version is null or expected_version<0 then raise exception 'Invalid revision'; end if;
 perform pg_advisory_xact_lock(hashtextextended(me.id::text,0));
 select * into old from public.domashka_documents where user_id=me.id and key=doc_key for update;
 if old.mutation_id=operation_id then return to_jsonb(old)||jsonb_build_object('ok',true,'replayed',true); end if;
 if coalesce(old.version,0)<>expected_version then return jsonb_build_object('ok',false,'conflict',true,'remote',to_jsonb(old)); end if;
 select coalesce(sum(octet_length(coalesce(value::text,''))),0),count(*) into bytes,records from public.domashka_documents where user_id=me.id;
 if (old.user_id is null and records>=5000) or bytes-octet_length(coalesce(old.value::text,''))+octet_length(coalesce(doc_value::text,''))>10000000 then
   raise exception 'Лимит личной тетради: 10 МБ текста / 5000 записей. Фото учитываются отдельно. Экспортируйте и удалите ненужные чаты.'; end if;
 insert into public.domashka_documents(user_id,key,value,version,deleted,mutation_id)
 values(me.id,doc_key,doc_value,coalesce(old.version,0)+1,doc_value is null,operation_id)
 on conflict(user_id,key) do update set value=excluded.value,version=excluded.version,deleted=excluded.deleted,mutation_id=excluded.mutation_id,updated_at=now()
 returning * into changed;
 return to_jsonb(changed)||jsonb_build_object('ok',true);
end $$;

create function domashka_private.bump_stats(target uuid,kind text,gain integer) returns void
language plpgsql security definer set search_path = '' as $$
declare today date;
begin
 select (now() at time zone time_zone)::date into today from public.domashka_profiles where id=target;
 update public.domashka_stats set xp=xp+gain,solved_count=solved_count+case when kind='solve' then 1 else 0 end,
 checked_count=checked_count+case when kind='check' then 1 else 0 end,quiz_correct=quiz_correct+case when kind='quiz_correct' then 1 else 0 end,
 streak_days=case when last_active_date=today then greatest(1,streak_days) when last_active_date=today-1 then streak_days+1 else 1 end,
 last_active_date=today,version=version+1 where user_id=target;
end $$;
create function public.domashka_record_activity(event_id uuid,kind text,gain integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); inserted integer;
begin
 if event_id is null or kind is null or gain is null or kind<>all(array['solve','check','quiz','quiz_correct','homework_done']) or gain<0 or gain>240 then raise exception 'Invalid activity'; end if;
 perform pg_advisory_xact_lock(hashtextextended(me.id::text,0));
 if exists(select 1 from domashka_private.activity_events e where e.user_id=me.id and e.id=event_id) then return domashka_private.stats_json(me.id); end if;
 if (select count(*) from domashka_private.activity_events where user_id=me.id and created_at>now()-interval '1 day')>=500 then raise exception 'Слишком много событий за день. Повторите позже.'; end if;
 insert into domashka_private.activity_events(user_id,id,kind) values(me.id,event_id,kind) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=1 then perform domashka_private.bump_stats(me.id,kind,gain); end if;
 return domashka_private.stats_json(me.id);
end $$;

create function domashka_private.homework_json(h public.domashka_homework) returns jsonb
language sql stable set search_path = '' as $$
 select jsonb_build_object('id',h.id,'childId',h.child_id,'authorId',h.author_id,'authorName',h.author_name,
 'subject',h.subject,'title',h.title,'instructions',h.instructions,'due',coalesce(h.due::text,''),'status',h.status,
 'submission',h.submission,'review',h.review,'version',h.version,'createdAt',floor(extract(epoch from h.created_at)*1000),
 'updatedAt',floor(extract(epoch from h.updated_at)*1000),'mutationId',h.mutation_id)
$$;
create function public.domashka_write_homework(action text,work_id uuid,child uuid,payload jsonb,expected_version bigint,operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); h public.domashka_homework; stamp bigint := floor(extract(epoch from now())*1000); image jsonb;
begin
 if operation_id is null or work_id is null then raise exception 'Missing operation'; end if;
 select * into h from public.domashka_homework where id=work_id for update;
 if h.id is not null and not (h.child_id=me.id or domashka_private.is_parent(me.id,h.child_id)) then raise exception 'Нет доступа.' using errcode='42501'; end if;
 if h.mutation_id=operation_id then return domashka_private.homework_json(h); end if;
 if action='assign' then
   perform domashka_private.require_parent(child);
   if h.id is not null then raise exception 'Задание уже существует.' using errcode='40001'; end if;
   perform pg_advisory_xact_lock(hashtextextended(child::text,1));
   if (select count(*) from public.domashka_homework where child_id=child)>=1000 then raise exception 'Не более 1000 работ на ученика. Сохраните архив.'; end if;
   insert into public.domashka_homework(id,child_id,author_id,author_name,subject,title,instructions,due,mutation_id)
   values(work_id,child,me.id,me.name,payload->>'subject',btrim(payload->>'title'),btrim(payload->>'instructions'),nullif(payload->>'due','')::date,operation_id) returning * into h;
 else
   if h.id is null then raise exception 'Задание недоступно.' using errcode='42501'; end if;
   if expected_version is null or h.version<>expected_version then raise exception 'Работа изменена на другом устройстве. Обновите её, сохранив свой ответ.' using errcode='40001'; end if;
   if action='submit' then
     if me.role<>'child' or me.id<>h.child_id or h.status='accepted' then raise exception 'Отправка недоступна.' using errcode='42501'; end if;
     if length(coalesce(payload->>'answer',''))>16000 then raise exception 'Слишком длинный ответ.'; end if;
     image := coalesce(payload->'image','""'::jsonb);
     if image<>'""'::jsonb and (jsonb_typeof(image)<>'object' or coalesce(image->>'path','') !~ ('^'||me.id::text||'/family/'||me.id::text||'/[a-f0-9]{64}\.(jpeg|png|webp)$')) then raise exception 'Invalid private photo'; end if;
     if length(btrim(coalesce(payload->>'answer','')))=0 and image='""'::jsonb then raise exception 'Добавьте ответ или фото.'; end if;
     update public.domashka_homework set status='submitted',submission=jsonb_build_object('text',coalesce(payload->>'answer',''),'image',image,'submittedAt',stamp),review=null,
       version=version+1,mutation_id=operation_id,updated_at=now() where id=work_id returning * into h;
   elsif action='review' then
     perform domashka_private.require_parent(h.child_id);
     if h.submission is null then raise exception 'Сначала ученик должен прислать работу.'; end if;
     if length(coalesce(payload->>'comment',''))>8000 or (not coalesce((payload->>'accepted')::boolean,false) and length(btrim(coalesce(payload->>'comment','')))=0) then raise exception 'Добавьте комментарий до 8000 символов.'; end if;
     if nullif(payload->>'mark','') is not null and (payload->>'mark')::integer not between 1 and 5 then raise exception 'Оценка: 1–5.'; end if;
     update public.domashka_homework set status=case when coalesce((payload->>'accepted')::boolean,false) then 'accepted' else 'revision' end,
       review=jsonb_build_object('comment',coalesce(payload->>'comment',''),'mark',nullif(payload->>'mark','')::integer,'byId',me.id,'byName',me.name,'reviewedAt',stamp),
       version=version+1,mutation_id=operation_id,updated_at=now() where id=work_id returning * into h;
   elsif action='delete' then
     perform domashka_private.require_parent(h.child_id);
     delete from public.domashka_homework where id=work_id; return jsonb_build_object('deleted',true);
   else raise exception 'Unknown action'; end if;
 end if;
 return domashka_private.homework_json(h);
end $$;
create function public.domashka_get_homework(work_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); h public.domashka_homework;
begin
 select * into h from public.domashka_homework where id=work_id and (child_id=me.id or domashka_private.is_parent(me.id,child_id));
 if h.id is null then raise exception 'Задание недоступно.' using errcode='42501'; end if;
 return domashka_private.homework_json(h);
end $$;

-- Deny direct writes even if a deployment's default privileges were permissive.
alter table public.domashka_profiles enable row level security;
alter table public.domashka_family_links enable row level security;
alter table public.domashka_documents enable row level security;
alter table public.domashka_stats enable row level security;
alter table public.domashka_homework enable row level security;
revoke all on public.domashka_profiles,public.domashka_family_links,public.domashka_documents,public.domashka_stats,public.domashka_homework from public,anon,authenticated;
grant select on public.domashka_profiles,public.domashka_family_links,public.domashka_documents,public.domashka_stats,public.domashka_homework to authenticated;
-- The schema remains inaccessible except for these narrowly-scoped policy helpers.
grant usage on schema domashka_private to authenticated;
revoke all on all tables in schema domashka_private from public,anon,authenticated;
revoke all on all functions in schema domashka_private from public,anon,authenticated;
grant execute on function domashka_private.active_user(),domashka_private.is_parent(uuid,uuid) to authenticated;
create policy own_or_child_profile on public.domashka_profiles for select to authenticated
 using(domashka_private.active_user() is not null and (id=auth.uid() or domashka_private.is_parent(auth.uid(),id)));
create policy own_family_links on public.domashka_family_links for select to authenticated
 using(domashka_private.active_user() is not null and (parent_id=auth.uid() or child_id=auth.uid()));
create policy private_workspace on public.domashka_documents for select to authenticated
 using(user_id=domashka_private.active_user());
create policy family_statistics on public.domashka_stats for select to authenticated
 using(domashka_private.active_user() is not null and (user_id=auth.uid() or domashka_private.is_parent(auth.uid(),user_id)));
create policy family_homework on public.domashka_homework for select to authenticated
 using(domashka_private.active_user() is not null and (child_id=auth.uid() or domashka_private.is_parent(auth.uid(),child_id)));

-- Every exposed mutation is an explicit RPC with a server-side ownership check.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'domashka\_%' escape '\' loop
   execute format('revoke all on function %s from public, anon, authenticated',f.signature);
   execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
commit;
