CREATE TYPE activity_event_type AS ENUM (
  'login',
  'photo_viewed',
  'photo_tagged',
  'photo_untagged',
  'photo_notes_updated'
);

CREATE TABLE activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type activity_event_type NOT NULL,
  attached_folder_id uuid REFERENCES attached_drive_folders(id) ON DELETE CASCADE,
  drive_file_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (event_type = 'login' AND attached_folder_id IS NULL AND drive_file_id IS NULL)
    OR
    (event_type <> 'login' AND attached_folder_id IS NOT NULL AND drive_file_id IS NOT NULL)
  )
);

CREATE INDEX activity_events_recent_idx ON activity_events (occurred_at DESC, id DESC);
CREATE INDEX activity_events_user_recent_idx ON activity_events (user_id, occurred_at DESC);
CREATE INDEX activity_events_photo_recent_idx ON activity_events (attached_folder_id, drive_file_id, occurred_at DESC);
