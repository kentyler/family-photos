CREATE TABLE attached_drive_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_folder_id text NOT NULL,
  name text NOT NULL,
  attached_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, drive_folder_id)
);
