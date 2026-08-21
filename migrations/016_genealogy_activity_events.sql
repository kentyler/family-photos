ALTER TABLE activity_events DROP CONSTRAINT activity_events_check;
ALTER TABLE activity_events ALTER COLUMN event_type TYPE text USING event_type::text;
DROP TYPE activity_event_type;

ALTER TABLE activity_events
  ADD COLUMN person_id uuid REFERENCES family_people(id) ON DELETE SET NULL;

ALTER TABLE activity_events
  ADD CONSTRAINT activity_events_type_check CHECK (event_type IN (
    'login', 'photo_viewed', 'photo_tagged', 'photo_untagged', 'photo_notes_updated',
    'family_person_created', 'family_alias_added', 'family_relationship_added', 'family_relationship_removed'
  )),
  ADD CONSTRAINT activity_events_subject_check CHECK (
    (event_type = 'login' AND attached_folder_id IS NULL AND drive_file_id IS NULL AND person_id IS NULL)
    OR
    (event_type LIKE 'photo_%' AND attached_folder_id IS NOT NULL AND drive_file_id IS NOT NULL AND person_id IS NULL)
    OR
    (event_type LIKE 'family_%' AND attached_folder_id IS NULL AND drive_file_id IS NULL AND person_id IS NOT NULL)
  );

CREATE INDEX activity_events_person_recent_idx ON activity_events (person_id, occurred_at DESC);
