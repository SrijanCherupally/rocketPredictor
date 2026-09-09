-- Default new workspace preferences to the preserved Legacy v1 engine.
-- Existing explicit preferences are left unchanged.
alter table public.user_preferences
  alter column engine_version set default 'legacy-v1';
