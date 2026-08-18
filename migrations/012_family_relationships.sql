CREATE TABLE family_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_type text NOT NULL CHECK (relationship_type IN ('spouse', 'parent')),
  person_id uuid NOT NULL REFERENCES family_people(id) ON DELETE RESTRICT,
  related_person_id uuid NOT NULL REFERENCES family_people(id) ON DELETE RESTRICT,
  date_text text CHECK (date_text IS NULL OR char_length(date_text) <= 100),
  source text NOT NULL CHECK (source IN ('legacy', 'application')) DEFAULT 'application',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (person_id <> related_person_id)
);

CREATE UNIQUE INDEX family_relationships_parent_unique
  ON family_relationships (person_id, related_person_id)
  WHERE relationship_type = 'parent';

CREATE UNIQUE INDEX family_relationships_spouse_unique
  ON family_relationships (LEAST(person_id, related_person_id), GREATEST(person_id, related_person_id))
  WHERE relationship_type = 'spouse';

CREATE INDEX family_relationships_related_idx ON family_relationships (related_person_id, relationship_type);

INSERT INTO family_relationships (relationship_type, person_id, related_person_id, date_text, source)
SELECT DISTINCT 'spouse', LEAST(p.id, related.id), GREATEST(p.id, related.id), NULLIF(r.start_date, ''), 'legacy'
FROM legacy_catalog.relationships r
JOIN family_people p ON p.legacy_person_id=r.person_id
JOIN family_people related ON related.legacy_person_id=r.related_id
WHERE r.type='spouse' AND p.id <> related.id
ON CONFLICT DO NOTHING;

INSERT INTO family_relationships (relationship_type, person_id, related_person_id, date_text, source)
SELECT DISTINCT 'parent',
  CASE WHEN r.type IN ('parent','father','mother') THEN p.id ELSE related.id END,
  CASE WHEN r.type IN ('parent','father','mother') THEN related.id ELSE p.id END,
  NULL, 'legacy'
FROM legacy_catalog.relationships r
JOIN family_people p ON p.legacy_person_id=r.person_id
JOIN family_people related ON related.legacy_person_id=r.related_id
WHERE r.type IN ('parent','father','mother','child') AND p.id <> related.id
ON CONFLICT DO NOTHING;
