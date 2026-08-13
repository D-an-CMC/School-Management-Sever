-- Rooms catalog + per-class room assignment for the timetable.

CREATE TABLE IF NOT EXISTS public.rooms (
    room_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    room_name text NOT NULL,
    room_type text,
    PRIMARY KEY (room_id)
);

-- Fixed (homeroom) room shown in the student timetable.
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS fixed_room_id bigint REFERENCES public.rooms(room_id);

-- Rooms assignable to a class (loaded in the admin timetable for that class).
CREATE TABLE IF NOT EXISTS public.class_rooms (
    class_id bigint NOT NULL REFERENCES public.classes(class_id) ON DELETE CASCADE,
    room_id bigint NOT NULL REFERENCES public.rooms(room_id) ON DELETE CASCADE,
    PRIMARY KEY (class_id, room_id)
);

-- Seed a few default rooms if the catalog is empty.
INSERT INTO public.rooms (room_name, room_type)
SELECT v.room_name, v.room_type
FROM (VALUES
    ('P.101', 'Phòng học'),
    ('P.102', 'Phòng học'),
    ('P.201', 'Phòng học'),
    ('Lab IT', 'Phòng máy'),
    ('Lab 02', 'Phòng thực hành'),
    ('Sân trường', 'Ngoài trời')
) AS v(room_name, room_type)
WHERE NOT EXISTS (SELECT 1 FROM public.rooms);
