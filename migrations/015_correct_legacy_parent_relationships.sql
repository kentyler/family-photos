-- The legacy relationship type describes related_id from person_id's perspective:
-- "child" means person_id is the parent; "parent"/"father"/"mother" means
-- related_id is the parent. Migration 012 interpreted those directions backward.
DELETE FROM family_relationships
WHERE source = 'legacy' AND relationship_type = 'parent';

INSERT INTO family_relationships (relationship_type, person_id, related_person_id, date_text, source)
SELECT DISTINCT 'parent',
  CASE WHEN r.type = 'child' THEN p.id ELSE related.id END,
  CASE WHEN r.type = 'child' THEN related.id ELSE p.id END,
  NULL, 'legacy'
FROM legacy_catalog.relationships r
JOIN family_people p ON p.legacy_person_id = r.person_id
JOIN family_people related ON related.legacy_person_id = r.related_id
WHERE r.type IN ('parent', 'father', 'mother', 'child')
  AND p.id <> related.id
ON CONFLICT DO NOTHING;
