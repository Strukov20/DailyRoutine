-- Phase 8: "Show task titles in notifications" preference (Section 10).
-- notification_preferences already grants select/insert/update directly to
-- authenticated under an owner-only RLS policy (Phase 6) — this is a plain
-- additive column on the same table, no RPC needed, same as
-- assignment_notifications_enabled.
--
-- Defaults to false (disabled): a lock-screen reminder shows only
-- "FamilyFlow" / "Task reminder" until the caller explicitly opts in to
-- seeing task titles there. Never silently enabled.

alter table public.notification_preferences
  add column reminder_titles_enabled boolean not null default false;

comment on column public.notification_preferences.reminder_titles_enabled is
  'Defaults to false. When false, a local task-reminder notification (Phase 8) never includes '
  'the task title, description, category, or any other private content — only the static '
  '"FamilyFlow" / "Task reminder" strings. See src/lib/reminders/reminderReconciliation.ts.';
