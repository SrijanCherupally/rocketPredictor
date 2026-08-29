-- Create launches table
create table public.launches (
  user_id uuid not null references auth.users(id) on delete cascade,
  launch_id text not null,
  date date not null,
  altitude double precision not null,
  flight_time double precision not null,
  descent_time double precision not null,
  parachute_size double precision not null,
  rocket_mass double precision not null,
  wind_speed double precision not null,
  air_pressure double precision not null,
  humidity double precision not null,
  temperature double precision not null,
  notes text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, launch_id)
);

-- Create user_preferences table
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  units text not null default 'imperial' check (units in ('imperial', 'metric')),
  target_altitude double precision not null default 800,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Create function for updating timestamps
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- Create triggers
create trigger launches_set_updated_at before update on public.launches
for each row execute function public.set_updated_at();

create trigger preferences_set_updated_at before update on public.user_preferences
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.launches enable row level security;
alter table public.user_preferences enable row level security;

-- Simple RLS policies
create policy "Users read their launches" on public.launches
  for select to authenticated
  using (user_id = auth.uid());

create policy "Users create their launches" on public.launches
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users update their launches" on public.launches
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users delete their launches" on public.launches
  for delete to authenticated
  using (user_id = auth.uid());

create policy "Users read their preferences" on public.user_preferences
  for select to authenticated
  using (user_id = auth.uid());

create policy "Users create their preferences" on public.user_preferences
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users update their preferences" on public.user_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users delete their preferences" on public.user_preferences
  for delete to authenticated
  using (user_id = auth.uid());

-- Enable realtime
alter table public.launches replica identity full;
alter table public.user_preferences replica identity full;

alter publication supabase_realtime add table public.launches;
alter publication supabase_realtime add table public.user_preferences;
