CREATE TABLE photo_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attached_folder_id uuid NOT NULL REFERENCES attached_drive_folders(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL,
  caption text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attached_folder_id, drive_file_id),
  CHECK (char_length(caption) <= 500),
  CHECK (char_length(notes) <= 50000)
);

CREATE INDEX photo_records_folder_file_idx ON photo_records (attached_folder_id, drive_file_id);
