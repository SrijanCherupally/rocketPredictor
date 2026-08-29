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
alter table public.launches add column if not exists rocket_id uuid;

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

-- RLS policies for rocket_preferences table
drop policy if exists "Users manage rocket preferences" on public.rocket_preferences;
create policy "Users manage rocket preferences" on public.rocket_preferences
  for all to authenticated
  using (true)
  with check (true);

-- Simpler RLS for launches - just check user_id for now
drop policy if exists "Users read their launches" on public.launches;
create policy "Users read their launches" on public.launches for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Users create their launches" on public.launches;
create policy "Users create their launches" on public.launches for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users update their launches" on public.launches;
create policy "Users update their launches" on public.launches for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users delete their launches" on public.launches;
create policy "Users delete their launches" on public.launches for delete to authenticated
using (user_id = auth.uid());

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

-- DATA MIGRATION: Create default rockets for existing users and assign launches
do $$
declare
  v_user_id uuid;
  v_rocket_id uuid;
begin
  -- For each user that has launches but no rockets, create a default rocket
  for v_user_id in
    select distinct user_id from public.launches
    where rocket_id is null
    and user_id not in (select distinct user_id from public.rockets)
  loop
    -- Create default rocket for this user
    insert into public.rockets (user_id, name, description, created_at, updated_at)
    values (v_user_id, 'Default Rocket', 'Migrated flights', timezone('utc', now()), timezone('utc', now()))
    returning id into v_rocket_id;

    -- Create rocket preferences with default target altitude
    insert into public.rocket_preferences (rocket_id, target_altitude, updated_at)
    values (v_rocket_id, 800, timezone('utc', now()));

    -- Assign all launches from this user to the default rocket
    update public.launches
    set rocket_id = v_rocket_id
    where user_id = v_user_id and rocket_id is null;
  end loop;
end;
$$;
