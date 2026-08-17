ALTER TABLE indexed_drive_items ADD COLUMN relative_path text NOT NULL DEFAULT '';
ALTER TABLE indexed_drive_items ADD COLUMN md5_checksum text;

CREATE TABLE legacy_drive_matches (
  indexed_item_id uuid PRIMARY KEY REFERENCES indexed_drive_items(id) ON DELETE CASCADE,
  legacy_file_id integer NOT NULL,
  match_method text NOT NULL CHECK (match_method IN ('exact_path_size', 'unique_name_size')),
  matched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX legacy_drive_matches_legacy_file_idx ON legacy_drive_matches (legacy_file_id);

DO $$
BEGIN
  IF to_regclass('legacy_catalog.files') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS legacy_catalog_files_name_size_idx
      ON legacy_catalog.files (lower(filename), size_bytes);
  END IF;
END $$;
