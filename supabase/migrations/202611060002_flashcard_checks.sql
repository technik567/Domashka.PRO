begin;
create table domashka_private.card_questions (
 card_key text not null, variant smallint not null, question text not null,
 answers text[] not null check(cardinality(answers)>0), kind text not null,
 primary key(card_key,variant)
);
create table domashka_private.answer_words(word text primary key, canonical text not null);
create table domashka_private.card_attempts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.domashka_profiles(id) on delete cascade,
 card_key text not null, answers text[] not null,
 tries smallint not null default 0, finished boolean not null default false, correct boolean not null default false,
 awarded smallint not null default 0, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '10 minutes'
);
create index domashka_attempts_user on domashka_private.card_attempts(user_id,created_at);
create table domashka_private.card_rewards (
 user_id uuid not null references public.domashka_profiles(id) on delete cascade,
 card_key text not null, created_at timestamptz not null default now(), primary key(user_id,card_key)
);
create function domashka_private.normalize_answer(raw text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare result text; number text; parts text[]; whole text; fraction text; scale integer; negative boolean;
begin
 result := regexp_replace(lower(translate(normalize(btrim(raw),NFKC),'Ёё−–,','Ее--.')),'^[[:space:].!?,;:]+|[[:space:].!?,;:]+$','','g');
 result := regexp_replace(result,'[[:space:]]+',' ','g');
 select canonical into number from domashka_private.answer_words where word=result;
 if number is not null then return number; end if;
 if left(result,6)='минус ' then
   select canonical into number from domashka_private.answer_words where word=substr(result,7);
   if number is not null then result := '-'||number; end if;
 end if;
 parts := regexp_match(result,'^(минус )?(.+?) цел(?:ая|ых) (.+?) (десятая|десятых|сотая|сотых|тысячная|тысячных)$');
 if parts is not null then
   select canonical into whole from domashka_private.answer_words where word=parts[2];
   select canonical into fraction from domashka_private.answer_words where word=parts[3];
   if whole is null and parts[2] ~ '^[0-9]+$' then whole:=parts[2]; end if;
   if fraction is null and parts[3] ~ '^[0-9]+$' then fraction:=parts[3]; end if;
   scale := case when parts[4] like 'десят%' then 1 when parts[4] like 'сот%' then 2 else 3 end;
   if whole is not null and fraction is not null and fraction::numeric<power(10,scale) then
     result := case when parts[1] is not null then '-' else '' end || whole || '.' || lpad(fraction,scale,'0');
   end if;
 end if;
 if result ~ '^[+-]?[0-9]+(\.[0-9]+)?$' then
   negative:=left(result,1)='-'; result:=regexp_replace(result,'^[+-]','');
   whole:=regexp_replace(split_part(result,'.',1),'^0+(?=[0-9])','');
   fraction:=rtrim(split_part(result,'.',2),'0');
   return case when negative and (whole<>'0' or fraction<>'') then '-' else '' end || whole || case when fraction<>'' then '.'||fraction else '' end;
 end if;
 return result;
end $$;
create function public.domashka_begin_card(card_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); q domashka_private.card_questions; attempt domashka_private.card_attempts;
begin
 perform pg_advisory_xact_lock(hashtextextended(me.id::text,2));
 delete from domashka_private.card_attempts where user_id=me.id and expires_at<now()-interval '1 day';
 if (select count(*) from domashka_private.card_attempts where user_id=me.id and created_at>now()-interval '1 hour')>=120 then raise exception 'Не более 120 проверок в час. Сделайте перерыв.'; end if;
 select * into q from domashka_private.card_questions c where c.card_key=domashka_begin_card.card_key order by random() limit 1;
 if q.card_key is null then return jsonb_build_object('unavailable',true,'question','Для этой карточки пока нет проверки на сервере. Повторите её без XP или попросите владельца обновить банк заданий.'); end if;
 insert into domashka_private.card_attempts(user_id,card_key,answers) values(me.id,q.card_key,q.answers) returning * into attempt;
 return jsonb_build_object('id',attempt.id,'question',q.question,'kind',q.kind,'remaining',3);
end $$;
create function public.domashka_answer_card(attempt_id uuid,answer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); a domashka_private.card_attempts; inserted integer; normalized text;
begin
 select * into a from domashka_private.card_attempts where id=attempt_id and user_id=me.id for update;
 if a.id is null then raise exception 'Проверка недоступна.' using errcode='42501'; end if;
 if not a.finished then
   if a.expires_at<now() then raise exception 'Проверка истекла. Откройте новое задание.'; end if;
   normalized := domashka_private.normalize_answer(answer);
   if normalized is null or length(normalized) not between 1 and 200 then raise exception 'Введите короткий ответ до 200 символов.'; end if;
   a.tries := a.tries+1;
   a.correct := normalized=any(a.answers);
   a.finished := a.correct or a.tries>=3;
   if a.correct then
     insert into domashka_private.card_rewards(user_id,card_key) values(me.id,a.card_key) on conflict do nothing;
     get diagnostics inserted=row_count;
     if inserted=1 then a.awarded:=4; perform domashka_private.bump_stats(me.id,'quiz_correct',4); end if;
   end if;
   update domashka_private.card_attempts set tries=a.tries,correct=a.correct,finished=a.finished,awarded=a.awarded where id=a.id;
 end if;
 -- An idempotent receipt: retries return the same award; never add it twice.
 return jsonb_build_object('correct',a.correct,'finished',a.finished,'awarded',a.awarded,'remaining',greatest(0,3-a.tries),
   'expected',case when a.finished and not a.correct then a.answers[1] else '' end,'stats',domashka_private.stats_json(me.id));
end $$;
revoke all on all tables in schema domashka_private from public,anon,authenticated;
revoke all on function domashka_private.normalize_answer(text) from public,anon,authenticated;
revoke all on function public.domashka_begin_card(text),public.domashka_answer_card(uuid,text) from public,anon,authenticated;
grant execute on function public.domashka_begin_card(text),public.domashka_answer_card(uuid,text) to authenticated;
commit;
