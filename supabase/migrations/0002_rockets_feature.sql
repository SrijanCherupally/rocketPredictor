-- Create rockets table
create table public.rockets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, name)
);

-- Create rocket_preferences table
create table public.rocket_preferences (
  rocket_id uuid primary key references public.rockets(id) on delete cascade,
  target_altitude double precision not null default 800,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Add rocket_id column to launches
alter table public.launches add column rocket_id uuid references public.rockets(id) on delete cascade;

-- Create triggers for updated_at
create trigger rockets_set_updated_at before update on public.rockets
for each row execute function public.set_updated_at();

create trigger rocket_preferences_set_updated_at before update on public.rocket_preferences
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.rockets enable row level security;
alter table public.rocket_preferences enable row level security;

-- RLS policies for rockets
create policy "Users read their rockets" on public.rockets
  for select to authenticated
  using (user_id = auth.uid());

create policy "Users create their rockets" on public.rockets
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users update their rockets" on public.rockets
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users delete their rockets" on public.rockets
  for delete to authenticated
  using (user_id = auth.uid());

-- RLS policies for rocket_preferences
create policy "Users manage rocket preferences" on public.rocket_preferences
  for all to authenticated
  using (true)
  with check (true);

-- Update launches RLS to work with rocket_id
drop policy "Users read their launches" on public.launches;
create policy "Users read their launches" on public.launches
  for select to authenticated
  using (user_id = auth.uid());

drop policy "Users create their launches" on public.launches;
create policy "Users create their launches" on public.launches
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy "Users update their launches" on public.launches;
create policy "Users update their launches" on public.launches
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy "Users delete their launches" on public.launches;
create policy "Users delete their launches" on public.launches
  for delete to authenticated
  using (user_id = auth.uid());

-- Enable realtime for new tables
alter table public.rockets replica identity full;
alter table public.rocket_preferences replica identity full;

alter publication supabase_realtime add table public.rockets;
alter publication supabase_realtime add table public.rocket_preferences;
