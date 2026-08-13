-- ============================================================
-- School Management System — Add per-week scheduling support
-- ============================================================

-- Add a week_start (Monday of the week) column so timetables
-- can be scoped to a specific week.
ALTER TABLE public.timetables ADD COLUMN IF NOT EXISTS week_start date;

-- Backfill existing rows to the Monday of the current week so
-- they keep showing under the "current week" view.
UPDATE public.timetables
SET week_start = CURRENT_DATE - (EXTRACT(DOW FROM CURRENT_DATE)::int - 1)
WHERE week_start IS NULL;