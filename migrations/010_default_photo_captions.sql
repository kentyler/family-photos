INSERT INTO photo_records (attached_folder_id, drive_file_id, caption, notes, created_by, updated_by)
SELECT i.attached_folder_id, i.drive_file_id, i.name, '', f.user_id, f.user_id
FROM indexed_drive_items i
JOIN attached_drive_folders f ON f.id = i.attached_folder_id
WHERE i.mime_type LIKE 'image/%'
ON CONFLICT (attached_folder_id, drive_file_id) DO NOTHING;
