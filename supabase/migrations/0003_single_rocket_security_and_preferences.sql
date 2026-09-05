-- Retire the incomplete multi-rocket feature without deleting any existing data.
-- The dormant tables remain protected and available for a separately verified cleanup.
do $$
begin
  -- 0002 may have failed partway through on an existing Supabase project. Only
  -- secure its dormant objects when both tables are actually present.
  if to_regclass('public.rockets') is not null and to_regclass('public.rocket_preferences') is not null then
    execute 'drop policy if exists "Users manage rocket preferences" on public.rocket_preferences';
    execute 'drop policy if exists "Owners read rocket preferences" on public.rocket_preferences';
    execute 'drop policy if exists "Owners create rocket preferences" on public.rocket_preferences';
    execute 'drop policy if exists "Owners update rocket preferences" on public.rocket_preferences';
    execute 'drop policy if exists "Owners delete rocket preferences" on public.rocket_preferences';

    execute $policy$create policy "Owners read rocket preferences" on public.rocket_preferences
      for select to authenticated using (exists (
        select 1 from public.rockets where rockets.id = rocket_preferences.rocket_id and rockets.user_id = auth.uid()
      ))$policy$;
    execute $policy$create policy "Owners create rocket preferences" on public.rocket_preferences
      for insert to authenticated with check (exists (
        select 1 from public.rockets where rockets.id = rocket_preferences.rocket_id and rockets.user_id = auth.uid()
      ))$policy$;
    execute $policy$create policy "Owners update rocket preferences" on public.rocket_preferences
      for update to authenticated using (exists (
        select 1 from public.rockets where rockets.id = rocket_preferences.rocket_id and rockets.user_id = auth.uid()
      )) with check (exists (
        select 1 from public.rockets where rockets.id = rocket_preferences.rocket_id and rockets.user_id = auth.uid()
      ))$policy$;
    execute $policy$create policy "Owners delete rocket preferences" on public.rocket_preferences
      for delete to authenticated using (exists (
        select 1 from public.rockets where rockets.id = rocket_preferences.rocket_id and rockets.user_id = auth.uid()
      ))$policy$;
  end if;
end;
$$;

alter table public.user_preferences
  add column if not exists planner_min_mass double precision not null default 500 check (planner_min_mass > 0),
  add column if not exists planner_max_mass double precision not null default 700 check (planner_max_mass > planner_min_mass),
  add column if not exists engine_version text not null default 'current-v2' check (engine_version in ('legacy-v1', 'current-v2'));

-- Version increments are authoritative in the database. A client may submit its
-- expected next version, but cannot make the row move backwards.
create or replace function public.bump_launch_version()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists launches_bump_version on public.launches;
create trigger launches_bump_version before update on public.launches
for each row execute function public.bump_launch_version();
