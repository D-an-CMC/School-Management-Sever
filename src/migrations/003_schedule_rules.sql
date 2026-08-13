-- Schedule rules for the auto-scheduler ("Sắp xếp tất cả các lớp").
-- One row per subject describing how many periods per week it must have,
-- which session it must be placed in, and whether it should be a double period.

CREATE TABLE IF NOT EXISTS public.schedule_rules (
    rule_id SERIAL PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES public.subjects(subject_id) ON DELETE CASCADE,
    periods_per_week INTEGER NOT NULL DEFAULT 0,
    session TEXT NOT NULL DEFAULT 'any' CHECK (session IN ('morning', 'afternoon', 'any')),
    double_period INTEGER NOT NULL DEFAULT 1 CHECK (double_period IN (1, 2, 3)),
    teacher_id INTEGER REFERENCES public.teachers(teacher_id) ON DELETE SET NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (subject_id)
);
