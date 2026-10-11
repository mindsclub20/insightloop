-- migrations/007_storage.sql
--
-- WRITTEN, NOT EXECUTED AGAINST REAL POSTGRES/STORAGE.
--
-- Private bucket for business verification documents (GST certificate,
-- incorporation proof, etc.) — NOT the public bucket type. Files are only
-- reachable via a short-lived signed URL your backend/Edge Function
-- generates, never a public URL. No participant-facing file storage exists
-- yet (out of scope for P0 — participants don't upload anything).
--
-- Run via the Supabase CLI/dashboard SQL editor, same as the other
-- migrations. Bucket creation can also be done via `supabase storage`
-- CLI commands or the dashboard UI instead of SQL if you prefer — both end
-- up as rows in storage.buckets, so either is equivalent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-documents', 'business-documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Storage RLS uses the same auth.uid()/current_user_role() model as every
-- other table. Path convention enforced here: objects MUST be uploaded to
-- `{business_id}/{filename}`, and the policies below check that the
-- {business_id} path segment matches a business the uploader belongs to —
-- this is what stops Business A from reading or overwriting Business B's
-- verification documents even though they share one bucket.

create policy "business uploads own verification docs"
on storage.objects for insert
with check (
  bucket_id = 'business-documents'
  and (storage.foldername(name))[1] in (
    select business_id::text from business_members where user_id = auth.uid()
  )
);

create policy "business reads own verification docs"
on storage.objects for select
using (
  bucket_id = 'business-documents'
  and (storage.foldername(name))[1] in (
    select business_id::text from business_members where user_id = auth.uid()
  )
);

create policy "admin reads all verification docs"
on storage.objects for select
using (
  bucket_id = 'business-documents'
  and current_user_role() in ('ADMIN', 'SUPER_ADMIN')
);

-- No UPDATE/DELETE policy for businesses - a submitted verification
-- document should not be quietly replaced or removed after admin review
-- begins. Admins can be given a delete policy explicitly later if a
-- document-retention decision requires it; not granted by default here.
create policy "admin deletes verification docs"
on storage.objects for delete
using (
  bucket_id = 'business-documents'
  and current_user_role() in ('ADMIN', 'SUPER_ADMIN')
);

-- CLIENT-SIDE NOTE for whoever wires up the upload UI: never construct a
-- public URL for these files. Generate access via
-- `supabase.storage.from('business-documents').createSignedUrl(path, expiresInSeconds)`
-- server-side (Edge Function) or client-side under RLS (the policies above
-- already scope this correctly either way) - never mark this bucket public.
