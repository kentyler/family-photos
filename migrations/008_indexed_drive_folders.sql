CREATE TABLE indexed_drive_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attached_folder_id uuid NOT NULL REFERENCES attached_drive_folders(id) ON DELETE CASCADE,
  drive_folder_id text NOT NULL,
  parent_drive_id text NOT NULL,
  name text NOT NULL,
  relative_path text NOT NULL,
  modified_time timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attached_folder_id, drive_folder_id)
);

CREATE INDEX indexed_drive_folders_parent_idx ON indexed_drive_folders (attached_folder_id, parent_drive_id);
