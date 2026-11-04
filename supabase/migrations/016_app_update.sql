-- "Update app" button on the dashboard: the TV checks for a newer app when this changes.
alter table public.screens add column if not exists update_requested_at timestamptz;
