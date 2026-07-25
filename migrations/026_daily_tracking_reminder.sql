-- Migration 026: post a "midday tracking check" message every work day at 12:00.
--
-- This reuses the whole message pipeline you already have: inserting a row into
-- public.messages fires the on_message_created trigger (022) → send-push Edge
-- Function → web-push to every device, and MessagesProvider pops the in-app
-- toast + badges the menu. So the ONLY new thing here is a scheduled INSERT.
--
-- Timing: pg_cron runs in UTC. South Africa is UTC+2 with no DST, so
--   10:00 UTC == 12:00 SAST. '0 10 * * 1-5' = weekdays at noon SAST.
-- Public holidays are skipped by the WHERE guard (weekends by the cron dow).
--
-- Requires the pg_cron extension. On Supabase: Dashboard → Database → Extensions
-- → enable "pg_cron" first if this CREATE EXTENSION line errors on permissions.
-- Run once, after 025.

create extension if not exists pg_cron;

-- Idempotent re-run: clear any previous schedule of the same name first.
select cron.unschedule('daily-tracking-reminder')
where exists (select 1 from cron.job where jobname = 'daily-tracking-reminder');

select cron.schedule(
  'daily-tracking-reminder',
  '0 10 * * 1-5',
  $$
    insert into public.messages (body, author_id, author_name, author_role, author_dept)
    select
      '🕛 Midday tracking check — open Part Tracking and tick off what''s finished so the schedule shows the real backlog.',
      null, 'ProductionFlow', 'System', null
    where current_date not in (select date from public.public_holidays);
  $$
);
