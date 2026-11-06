begin;
-- Private immutable photos; never public buckets or long-lived signed links.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('domashka-photos','domashka-photos',false,2000000,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=2000000,allowed_mime_types=excluded.allowed_mime_types;
create function domashka_private.photo_permission(path text,writing boolean default false,uploader text default null) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := domashka_private.active_user(); parts text[]; owner uuid; child uuid;
begin
 if me is null or path !~ '^[a-f0-9-]{36}/(private|family)/' then return false; end if;
 parts:=string_to_array(path,'/');
 begin owner:=parts[1]::uuid; exception when invalid_text_representation then return false; end;
 if parts[2]='private' then
   if array_length(parts,1)<>3 or parts[3] !~ '^[a-f0-9]{64}\.(jpeg|png|webp)$' then return false; end if;
   return owner=me or (domashka_private.is_parent(me,owner) and (writing or uploader=me::text));
 end if;
 if array_length(parts,1)<>4 or parts[4] !~ '^[a-f0-9]{64}\.(jpeg|png|webp)$' then return false; end if;
 begin child:=parts[3]::uuid; exception when invalid_text_representation then return false; end;
 if writing then return owner=me and (child=me or domashka_private.is_parent(me,child)); end if;
 -- Family attachments can be read only in their assigned child's family.
 return child=me or domashka_private.is_parent(me,child);
end $$;
revoke all on function domashka_private.photo_permission(text,boolean,text) from public,anon,authenticated;
grant execute on function domashka_private.photo_permission(text,boolean,text) to authenticated;
create policy domashka_photos_read on storage.objects for select to authenticated
 using(bucket_id='domashka-photos' and domashka_private.photo_permission(name,false,owner_id));
create policy domashka_photos_insert on storage.objects for insert to authenticated
 with check(bucket_id='domashka-photos' and domashka_private.photo_permission(name,true));
-- No client UPDATE/DELETE policies: immutable content hashes cannot overwrite a
-- photo used by another device/homework. Owner cleanup is documented separately.

-- Explicit one-time parent-approved legacy import. Never imports auth, roles,
-- API keys, sessions or verified-card claims. Existing documents are not replaced.
create function public.domashka_import_workspace(target uuid,documents jsonb,legacy_stats jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); item jsonb; added integer := 0; skipped integer := 0; count_now integer; bytes bigint; s public.domashka_stats;
begin
 if target<>me.id then perform domashka_private.require_parent(target); end if;
 if jsonb_typeof(documents)<>'array' or jsonb_array_length(documents)>200 then raise exception 'Импорт: до 200 записей за один пакет.'; end if;
 if legacy_stats is not null then perform domashka_private.require_parent(case when target<>me.id then target else null end); end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 for item in select value from jsonb_array_elements(documents) loop
   if item->>'key' is null or item->'value' is null or item->'value'='null'::jsonb then raise exception 'Invalid import item'; end if;
   perform domashka_private.validate_document(item->>'key',item->'value');
   if exists(select 1 from public.domashka_documents where user_id=target and key=item->>'key') then skipped:=skipped+1;
   else
     insert into public.domashka_documents(user_id,key,value,mutation_id) values(target,item->>'key',item->'value',gen_random_uuid()); added:=added+1;
   end if;
 end loop;
 select count(*),coalesce(sum(octet_length(coalesce(value::text,''))),0) into count_now,bytes from public.domashka_documents where user_id=target;
 if count_now>5000 or bytes>10000000 then raise exception 'Превышен лимит личной тетради. Импорт пакета отменён, оригинал не изменён.'; end if;
 if legacy_stats is not null then
   select * into s from public.domashka_stats where user_id=target for update;
   if s.legacy_imported then raise exception 'Старая статистика уже перенесена. Повторное начисление запрещено.'; end if;
   if coalesce((legacy_stats->>'xp')::bigint,0) not between 0 and 10000000 then raise exception 'Некорректная старая статистика.'; end if;
   update public.domashka_stats set imported_xp=coalesce((legacy_stats->>'xp')::bigint,0),legacy_imported=true,version=version+1,
     solved_count=solved_count+least(100000,greatest(0,coalesce((legacy_stats->>'solvedCount')::integer,0))),
     checked_count=checked_count+least(100000,greatest(0,coalesce((legacy_stats->>'checkedCount')::integer,0))),
     quiz_correct=quiz_correct+least(100000,greatest(0,coalesce((legacy_stats->>'quizCorrect')::integer,0))) where user_id=target;
 end if;
 return jsonb_build_object('added',added,'skipped',skipped,'stats',domashka_private.stats_json(target));
end $$;
revoke all on function public.domashka_import_workspace(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.domashka_import_workspace(uuid,jsonb,jsonb) to authenticated;
commit;
