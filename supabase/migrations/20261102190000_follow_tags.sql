-- Several personal tags per followed station ("JCL", "Volleyball"), replacing
-- the single label. Up to 5 tags, each 1-24 characters.

create function public.valid_tags(tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(tags) <= 5
     and coalesce(bool_and(char_length(t) between 1 and 24), true)
  from unnest(tags) as t
$$;

alter table public.follows
  add column tags text[] not null default '{}' check (public.valid_tags(tags));

-- Keep existing single labels as the first tag.
update public.follows set tags = array[label] where label is not null;

-- Dropping the column also drops its column-level update grant.
alter table public.follows drop column label;

-- The page may change only the tags, and only on its own rows (the
-- "edit own follows" policy from the previous migration still applies).
grant update (tags) on public.follows to authenticated;
