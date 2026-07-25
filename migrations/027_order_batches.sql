-- Migration 027: split a big-qty order into batches (child orders).
--
-- Splitting keeps the original order as Batch 1 (qty reduced) and creates a new
-- sibling order per additional batch — each with its own qty and start date, so
-- every batch flows through Schedule / Tracking / MES / Dispatch on its own.
-- These columns just tag the siblings so the UI can show "Batch 2 of 4" and keep
-- them grouped:
--   split_group  — shared id across all batches of one original order
--   batch_index  — 1..N (1 = the original)
--   batch_count  — N
--
-- Run once in the Supabase SQL editor.

alter table public.orders
  add column if not exists split_group text,
  add column if not exists batch_index integer,
  add column if not exists batch_count integer;

create index if not exists orders_split_group_idx on public.orders (split_group);
