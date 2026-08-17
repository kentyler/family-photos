ALTER TABLE attached_drive_folders ADD COLUMN last_scanned_at timestamptz;

CREATE TABLE indexed_drive_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attached_folder_id uuid NOT NULL REFERENCES attached_drive_folders(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL,
  parent_drive_id text NOT NULL,
  name text NOT NULL,
  mime_type text NOT NULL,
  modified_time timestamptz,
  size_bytes bigint,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attached_folder_id, drive_file_id)
);

CREATE INDEX indexed_drive_items_folder_parent_idx ON indexed_drive_items (attached_folder_id, parent_drive_id);
