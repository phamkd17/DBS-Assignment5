-- A short personal tag on each followed station ("JCL", "Ryerson", "Volleyball").
-- It lives on follows, not stations, because it means something only to you.

alter table public.follows
  add column label text check (label is null or char_length(label) between 1 and 24);

-- The page may change only the label, and only on its own rows.
grant update (label) on public.follows to authenticated;

create policy "edit own follows" on public.follows
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
