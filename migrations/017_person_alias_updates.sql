ALTER TABLE activity_events DROP CONSTRAINT activity_events_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_type_check CHECK (event_type IN (
  'login', 'photo_viewed', 'photo_tagged', 'photo_untagged', 'photo_notes_updated',
  'family_person_created', 'family_alias_added', 'family_alias_updated',
  'family_relationship_added', 'family_relationship_removed'
));
