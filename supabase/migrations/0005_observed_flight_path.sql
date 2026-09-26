-- Qualitative observations for analysis only; never prediction inputs.
alter table public.launches add column if not exists observed_tilt text
  check (observed_tilt is null or observed_tilt in ('straight', 'slight', 'strong'));
