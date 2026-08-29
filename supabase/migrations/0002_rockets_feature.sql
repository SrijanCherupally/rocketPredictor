-- Create rockets table
create table if not exists public.rockets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, name)
);

-- Create rocket_preferences table (replaces target_altitude from user_preferences)
create table if not exists public.rocket_preferences (
  rocket_id uuid primary key references public.rockets(id) on delete cascade,
  target_altitude double precision not null default 800,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Add rocket_id to launches table
alter table public.launches add column rocket_id uuid;

-- We'll populate rocket_id after setting up the default rockets for existing users
-- For now, make it nullable to avoid breaking existing data

-- Create triggers for updated_at
drop trigger if exists rockets_set_updated_at on public.rockets;
create trigger rockets_set_updated_at before update on public.rockets
for each row execute function public.set_updated_at();

drop trigger if exists rocket_preferences_set_updated_at on public.rocket_preferences;
create trigger rocket_preferences_set_updated_at before update on public.rocket_preferences
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.rockets enable row level security;
alter table public.rocket_preferences enable row level security;

-- RLS policies for rockets table
drop policy if exists "Users read their rockets" on public.rockets;
create policy "Users read their rockets" on public.rockets for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users create their rockets" on public.rockets;
create policy "Users create their rockets" on public.rockets for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Users update their rockets" on public.rockets;
create policy "Users update their rockets" on public.rockets for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users delete their rockets" on public.rockets;
create policy "Users delete their rockets" on public.rockets for delete to authenticated using (user_id = auth.uid());

-- RLS policies for rocket_preferences table (users access through their rockets)
drop policy if exists "Users read rocket preferences" on public.rocket_preferences;
create policy "Users read rocket preferences" on public.rocket_preferences for select to authenticated
using (exists(select 1 from public.rockets where rockets.id = rocket_preferences.rocket_id and rockets.user_id = auth.uid()));

drop policy if exists "Users create rocket preferences" on public.rocket_preferences;
create policy "Users create rocket preferences" on public.rocket_preferences for insert to authenticated
with check (exists(select 1 from public.rockets where rockets.id = rocket_id and rockets.user_id = auth.uid()));

drop policy if exists "Users update rocket preferences" on public.rocket_preferences;
create policy "Users update rocket preferences" on public.rocket_preferences for update to authenticated
using (exists(select 1 from public.rockets where rockets.id = rocket_preferences.rocket_id and rockets.user_id = auth.uid()));

drop policy if exists "Users delete rocket preferences" on public.rocket_preferences;
create policy "Users delete rocket preferences" on public.rocket_preferences for delete to authenticated
using (exists(select 1 from public.rockets where rockets.id = rocket_preferences.rocket_id and rockets.user_id = auth.uid()));

-- Update launches RLS to include rocket_id check
drop policy if exists "Users read their launches" on public.launches;
create policy "Users read their launches" on public.launches for select to authenticated
using (user_id = auth.uid() and (rocket_id is null or exists(select 1 from public.rockets where rockets.id = launches.rocket_id and rockets.user_id = auth.uid())));

drop policy if exists "Users create their launches" on public.launches;
create policy "Users create their launches" on public.launches for insert to authenticated
with check (user_id = auth.uid() and (rocket_id is null or exists(select 1 from public.rockets where rockets.id = rocket_id and rockets.user_id = auth.uid())));

drop policy if exists "Users update their launches" on public.launches;
create policy "Users update their launches" on public.launches for update to authenticated
using (user_id = auth.uid() and (rocket_id is null or exists(select 1 from public.rockets where rockets.id = launches.rocket_id and rockets.user_id = auth.uid())))
with check (user_id = auth.uid() and (rocket_id is null or exists(select 1 from public.rockets where rockets.id = rocket_id and rockets.user_id = auth.uid())));

drop policy if exists "Users delete their launches" on public.launches;
create policy "Users delete their launches" on public.launches for delete to authenticated
using (user_id = auth.uid() and (rocket_id is null or exists(select 1 from public.rockets where rockets.id = launches.rocket_id and rockets.user_id = auth.uid())));

-- Enable replica identity for realtime
alter table public.rockets replica identity full;
alter table public.rocket_preferences replica identity full;

-- Add to realtime publication
do $$
begin
  begin
    alter publication supabase_realtime add table public.rockets;
  exception when duplicate_object then
    null;
  end;
  begin
    alter publication supabase_realtime add table public.rocket_preferences;
  exception when duplicate_object then
    null;
  end;
end;
$$;
