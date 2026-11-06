begin;
-- Cheap polling metadata: do not download every chat/photo/avatar every 15s.
create function public.domashka_sync_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.domashka_profiles := domashka_private.actor(); family_hash text; homework_hash text; links_hash text; summary_hash text; documents_hash text; stats_hash text;
begin
 select md5(coalesce(string_agg(p.id::text||':'||p.version::text,',' order by p.id),'')) into family_hash
 from public.domashka_profiles p where p.id=me.id or domashka_private.is_parent(me.id,p.id) or p.id in
 (select l.parent_id from public.domashka_family_links l where l.child_id=me.id or domashka_private.is_parent(me.id,l.child_id));
 select md5(coalesce(string_agg(l.parent_id::text||':'||l.child_id::text,',' order by l.parent_id,l.child_id),'')) into links_hash
 from public.domashka_family_links l where l.child_id=me.id or domashka_private.is_parent(me.id,l.child_id);
 select md5(coalesce(string_agg(d.user_id::text||':'||d.key||':'||d.version::text,',' order by d.user_id,d.key),'')) into summary_hash
 from public.domashka_documents d where domashka_private.is_parent(me.id,d.user_id) and d.key in ('pref/domashka_diary_tasks_v21','pref/domashka_subject_grades_v22');
 select md5(coalesce(string_agg(h.id::text||':'||h.version::text,',' order by h.id),'')) into homework_hash
 from public.domashka_homework h where h.child_id=me.id or domashka_private.is_parent(me.id,h.child_id);
 select md5(coalesce(string_agg(d.key||':'||d.version::text,',' order by d.key),'')) into documents_hash from public.domashka_documents d where d.user_id=me.id;
 select md5(coalesce(string_agg(s.user_id::text||':'||s.version::text,',' order by s.user_id),'')) into stats_hash from public.domashka_stats s where domashka_private.is_parent(me.id,s.user_id);
 return jsonb_build_object('apiVersion',1,'documentRevision',documents_hash,'familyRevision',family_hash||links_hash,'summaryRevision',summary_hash||stats_hash,
   'homeworkRevision',homework_hash,'stats',domashka_private.stats_json(me.id));
end $$;
create function public.domashka_child_summary(child uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 perform domashka_private.require_parent(child);
 return jsonb_build_object('stats',domashka_private.stats_json(child),
   'tasks',coalesce((select (d.value #>> '{}')::jsonb from public.domashka_documents d where d.user_id=child and d.key='pref/domashka_diary_tasks_v21' and not d.deleted),'[]'::jsonb),
   'grades',coalesce((select (d.value #>> '{}')::jsonb from public.domashka_documents d where d.user_id=child and d.key='pref/domashka_subject_grades_v22' and not d.deleted),'{}'::jsonb));
end $$;
revoke all on function public.domashka_sync_status(),public.domashka_child_summary(uuid) from public,anon,authenticated;
grant execute on function public.domashka_sync_status(),public.domashka_child_summary(uuid) to authenticated;
commit;
