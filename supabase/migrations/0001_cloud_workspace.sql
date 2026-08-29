create table if not exists public.launches (
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

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  units text not null default 'imperial' check (units in ('imperial', 'metric')),
  target_altitude double precision not null default 800,
  updated_at timestamptz not null default timezone('utc', now())
);

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

drop trigger if exists launches_set_updated_at on public.launches;
create trigger launches_set_updated_at before update on public.launches
for each row execute function public.set_updated_at();

drop trigger if exists preferences_set_updated_at on public.user_preferences;
create trigger preferences_set_updated_at before update on public.user_preferences
for each row execute function public.set_updated_at();

alter table public.launches enable row level security;
alter table public.user_preferences enable row level security;

drop policy if exists "Users read their launches" on public.launches;
create policy "Users read their launches" on public.launches for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users create their launches" on public.launches;
create policy "Users create their launches" on public.launches for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users update their launches" on public.launches;
create policy "Users update their launches" on public.launches for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users delete their launches" on public.launches;
create policy "Users delete their launches" on public.launches for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Users read their preferences" on public.user_preferences;
create policy "Users read their preferences" on public.user_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users create their preferences" on public.user_preferences;
create policy "Users create their preferences" on public.user_preferences for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users update their preferences" on public.user_preferences;
create policy "Users update their preferences" on public.user_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users delete their preferences" on public.user_preferences;
create policy "Users delete their preferences" on public.user_preferences for delete to authenticated using (user_id = auth.uid());

alter table public.launches replica identity full;
alter table public.user_preferences replica identity full;

-- Realtime broadcasts only tables added to this publication.
do $$
begin
  begin
    alter publication supabase_realtime add table public.launches;
  exception when duplicate_object then
    null;
  end;
  begin
    alter publication supabase_realtime add table public.user_preferences;
  exception when duplicate_object then
    null;
  end;
end;
$$;
