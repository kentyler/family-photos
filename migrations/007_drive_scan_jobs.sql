CREATE TABLE drive_scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attached_folder_id uuid NOT NULL REFERENCES attached_drive_folders(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
  folders_scanned integer NOT NULL DEFAULT 0,
  items_discovered integer NOT NULL DEFAULT 0,
  matched_items integer,
  unmatched_items integer,
  ambiguous_items integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX drive_scan_jobs_folder_created_idx ON drive_scan_jobs (attached_folder_id, created_at DESC);
