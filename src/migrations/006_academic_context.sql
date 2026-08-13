-- Academic context: a single "current" school year that the whole system
-- follows, plus a single "active" semester per school year.

-- 1) Which school year is the current/active one (only one at a time).
ALTER TABLE public.school_years ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT FALSE;

-- 2) Which semester within a school year is the active one (only one at a time).
ALTER TABLE public.semesters ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE;

-- Ensure at most one school year is marked current.
DROP TRIGGER IF EXISTS trg_school_years_single_current ON public.school_years;
DROP FUNCTION IF EXISTS fn_school_years_single_current();

CREATE FUNCTION fn_school_years_single_current() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_current IS TRUE THEN
    UPDATE public.school_years SET is_current = FALSE WHERE school_year_id <> NEW.school_year_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_school_years_single_current
AFTER INSERT OR UPDATE OF is_current ON public.school_years
FOR EACH ROW EXECUTE FUNCTION fn_school_years_single_current();

-- Ensure at most one semester is active within each school year.
DROP TRIGGER IF EXISTS trg_semesters_single_active ON public.semesters;
DROP FUNCTION IF EXISTS fn_semesters_single_active();

CREATE FUNCTION fn_semesters_single_active() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active IS TRUE THEN
    UPDATE public.semesters SET is_active = FALSE
    WHERE school_year_id = NEW.school_year_id AND semester_id <> NEW.semester_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_semesters_single_active
AFTER INSERT OR UPDATE OF is_active ON public.semesters
FOR EACH ROW EXECUTE FUNCTION fn_semesters_single_active();
