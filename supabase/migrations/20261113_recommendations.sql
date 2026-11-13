-- Books & Movies list for AMAN OS. Run once in Supabase → SQL Editor.
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('book', 'movie')),
  title text not null check (length(trim(title)) > 0),
  creator text,
  recommended_by text,
  notes text,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recommendations_user_idx on public.recommendations (user_id, done, created_at desc);
alter table public.recommendations enable row level security;
drop policy if exists "own recommendations" on public.recommendations;
create policy "own recommendations" on public.recommendations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
do $$ begin
  alter publication supabase_realtime add table public.recommendations;
exception when duplicate_object then null; when undefined_object then null; end $$;
