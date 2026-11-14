-- Answer-writing practice log for AMAN OS (Q&A sets). Run once in Supabase → SQL Editor.
create table if not exists public.answer_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  case_no integer not null,
  question_id text not null,
  marks integer not null,
  score numeric(4,1),
  minutes_taken numeric(5,1),
  illegible_words integer,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists answer_attempts_user_idx on public.answer_attempts (user_id, case_no, created_at desc);
alter table public.answer_attempts enable row level security;
drop policy if exists "own answer attempts" on public.answer_attempts;
create policy "own answer attempts" on public.answer_attempts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
do $$ begin
  alter publication supabase_realtime add table public.answer_attempts;
exception when duplicate_object then null; when undefined_object then null; end $$;
