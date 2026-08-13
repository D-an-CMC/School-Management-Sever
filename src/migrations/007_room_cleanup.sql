-- Clean up placeholder rooms that were hardcoded during auto/bulk scheduling.
-- Empty rooms now resolve dynamically to the class's fixed room at read time.
UPDATE public.timetables SET room = NULL WHERE room = 'P.101';
