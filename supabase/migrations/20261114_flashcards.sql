-- Flashcards (spaced repetition) for AMAN OS. Run once in Supabase → SQL Editor.
create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deck text not null check (length(trim(deck)) > 0),
  front text not null check (length(trim(front)) > 0),
  back text not null default '',
  tags text[] not null default '{}',
  confidence text check (confidence in ('green', 'yellow', 'red')),
  ease numeric(4,2) not null default 2.5,
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  lapses integer not null default 0,
  due_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  last_reviewed_at timestamptz,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, deck, front)
);
create index if not exists flashcards_due_idx on public.flashcards (user_id, suspended, due_date);
alter table public.flashcards enable row level security;
drop policy if exists "own flashcards" on public.flashcards;
create policy "own flashcards" on public.flashcards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id uuid not null references public.flashcards(id) on delete cascade,
  grade text not null check (grade in ('again', 'hard', 'good', 'easy')),
  interval_days integer not null,
  reviewed_at timestamptz not null default now()
);
create index if not exists flashcard_reviews_user_idx on public.flashcard_reviews (user_id, reviewed_at desc);
alter table public.flashcard_reviews enable row level security;
drop policy if exists "own flashcard reviews" on public.flashcard_reviews;
create policy "own flashcard reviews" on public.flashcard_reviews
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.flashcards;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.flashcard_reviews;
exception when duplicate_object then null; when undefined_object then null; end $$;
