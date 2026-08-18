CREATE TABLE family_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_person_id integer UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE family_person_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES family_people(id) ON DELETE CASCADE,
  legacy_alias_id integer UNIQUE,
  alias text NOT NULL CHECK (char_length(alias) BETWEEN 1 AND 200),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, alias),
  UNIQUE (id, person_id)
);

INSERT INTO family_people (legacy_person_id)
SELECT id FROM legacy_catalog.people
ON CONFLICT (legacy_person_id) DO NOTHING;

INSERT INTO family_person_aliases (person_id, legacy_alias_id, alias, is_primary, created_at)
SELECT p.id, a.id, a.alias, COALESCE(a.is_primary, false), COALESCE(a.created_at, now())
FROM legacy_catalog.person_aliases a
JOIN family_people p ON p.legacy_person_id = a.person_id
ON CONFLICT (legacy_alias_id) DO NOTHING;

CREATE TABLE photo_subject_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attached_folder_id uuid NOT NULL REFERENCES attached_drive_folders(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('person', 'thing')),
  person_id uuid REFERENCES family_people(id) ON DELETE RESTRICT,
  alias_id uuid,
  label text CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 200),
  x double precision NOT NULL CHECK (x >= 0 AND x <= 1),
  y double precision NOT NULL CHECK (y >= 0 AND y <= 1),
  width double precision NOT NULL CHECK (width > 0 AND width <= 1),
  height double precision NOT NULL CHECK (height > 0 AND height <= 1),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (alias_id, person_id) REFERENCES family_person_aliases(id, person_id) ON DELETE RESTRICT,
  CHECK ((subject_type = 'person' AND person_id IS NOT NULL AND alias_id IS NOT NULL AND label IS NULL) OR (subject_type = 'thing' AND person_id IS NULL AND alias_id IS NULL AND label IS NOT NULL)),
  CHECK (x + width <= 1.000001),
  CHECK (y + height <= 1.000001)
);

CREATE INDEX family_person_aliases_search_idx ON family_person_aliases (lower(alias));
CREATE INDEX photo_subject_regions_photo_idx ON photo_subject_regions (attached_folder_id, drive_file_id, created_at, id);
