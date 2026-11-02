insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'citoyen-photos',
    'citoyen-photos',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Citizens can view their own photos" on storage.objects;
create policy "Citizens can view their own photos"
on storage.objects for select to authenticated
using (
    bucket_id = 'citoyen-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Citizens can upload their own photos" on storage.objects;
create policy "Citizens can upload their own photos"
on storage.objects for insert to authenticated
with check (
    bucket_id = 'citoyen-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Citizens can delete their own photos" on storage.objects;
create policy "Citizens can delete their own photos"
on storage.objects for delete to authenticated
using (
    bucket_id = 'citoyen-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
);