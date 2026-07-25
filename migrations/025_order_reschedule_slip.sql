-- Migration 025: track how far an order has SLIPPED from its original plan.
--
-- Problem it solves: every end-of-day the boss reschedules leftover steps to a
-- later date. That reschedule overwrites orders.prod_week / prod_day to wherever
-- the work landed, so the order looks "on schedule" again and the real backlog
-- is invisible. These columns freeze the ORIGINAL planned slot the first time an
-- order is manually rescheduled, and count the pushes — so "X work-days behind ·
-- pushed N×" can be shown and can GROW instead of resetting each night.
--
--   baseline_prod_week / _day : the planned slot at the moment of the FIRST
--                               manual reschedule. Written once, never again.
--   reschedule_count          : how many times leftovers were pushed.
--   last_rescheduled_at       : when the most recent push happened.
--
-- Run once in the Supabase SQL editor (before 026).

alter table public.orders
  add column if not exists baseline_prod_week integer,
  add column if not exists baseline_prod_day  integer,
  add column if not exists reschedule_count   integer not null default 0,
  add column if not exists last_rescheduled_at timestamptz;
