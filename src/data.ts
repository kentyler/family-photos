import type { Pool } from "pg";

export type User = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

export type ArchiveMembership = {
  id: string;
  name: string;
  role: "owner" | "administrator" | "member";
};

export type IdentityProfile = Omit<User, "id"> & { googleSubject: string };

export type ApplicationRole = "administrator" | "member";

export type ApplicationMembership = {
  id: string;
  email: string;
  role: ApplicationRole;
  joined: boolean;
};

export type AttachedFolder = { id: string; driveFolderId: string; name: string; attachedAt: string };
export type IndexedDriveItem = {
  driveFileId: string;
  parentDriveId: string;
  name: string;
  mimeType: string;
  relativePath: string;
  md5Checksum: string | null;
  modifiedTime: string | null;
  sizeBytes: number | null;
};
export type IndexedDriveFolder = { driveFolderId: string; parentDriveId: string; name: string; relativePath: string; modifiedTime: string | null };
export type DriveScanJob = { id: string; status: "pending" | "running" | "completed" | "failed"; foldersScanned: number; itemsDiscovered: number; matchedItems: number | null; unmatchedItems: number | null; ambiguousItems: number | null; errorMessage: string | null };
export type ReconciliationReviewItem = { name: string; relativePath: string; mimeType: string; sizeBytes: number | null; matchMethod: string | null; legacyPaths: string[] };
export type DriveBrowserItem = { driveFileId: string; name: string; caption: string | null; mimeType: string; modifiedTime: string | null; sizeBytes: number | null; matched: boolean };
export type PhotoText = { caption: string; notes: string; updatedAt: string | null; updatedBy: string | null };
export type PersonAliasChoice = { personId: string; aliasId: string; alias: string; isPrimary: boolean };
export type PhotoSubjectRegion = { id: string; subjectType: "person" | "thing"; personId: string | null; aliasId: string | null; label: string; x: number; y: number; width: number; height: number; createdBy: string; createdAt: string };
export type PersonSearchResult = { id: string; primaryName: string; aliases: string[] };
export type PersonExplorer = { id: string; primaryName: string; aliases: string[]; parents: PersonSearchResult[]; spouses: PersonSearchResult[]; children: PersonSearchResult[]; photos: Array<{ folderId: string; driveFileId: string; parentDriveId: string; name: string; caption: string }> };

export interface DataStore {
  isReady(): Promise<boolean>;
  admitGoogleUser(profile: IdentityProfile, bootstrapAdminEmail?: string): Promise<User | null>;
  getUser(userId: string): Promise<User | null>;
  getApplicationRole(userId: string): Promise<ApplicationRole | null>;
  listApplicationMembers(): Promise<ApplicationMembership[]>;
  addApplicationMember(email: string, role: ApplicationRole, invitedBy: string): Promise<ApplicationMembership>;
  saveDriveConnection(userId: string, encryptedRefreshToken: string, scope: string): Promise<void>;
  hasDriveConnection(userId: string): Promise<boolean>;
  getEncryptedDriveRefreshToken(userId: string): Promise<string | null>;
  attachDriveFolder(userId: string, driveFolderId: string, name: string): Promise<AttachedFolder>;
  listAttachedFolders(userId: string): Promise<AttachedFolder[]>;
  getAttachedFolder(userId: string, folderId: string): Promise<AttachedFolder | null>;
  replaceIndexedDriveItems(userId: string, folderId: string, items: IndexedDriveItem[], folders?: IndexedDriveFolder[]): Promise<number>;
  countIndexedDriveItems(userId: string, folderId: string): Promise<number>;
  countLegacyDriveMatches(userId: string, folderId: string): Promise<number>;
  reconcileLegacyDriveItems(userId: string, folderId: string): Promise<{ matched: number; exactPath: number; uniqueNameSize: number; unmatched: number; ambiguous: number }>;
  createDriveScanJob(userId: string, folderId: string): Promise<DriveScanJob>;
  updateDriveScanJob(jobId: string, update: Partial<Omit<DriveScanJob, "id">>): Promise<void>;
  getLatestDriveScanJob(userId: string, folderId: string): Promise<DriveScanJob | null>;
  getReconciliationReview(userId: string, folderId: string, category: "matched" | "ambiguous" | "unmatched", offset: number, limit: number): Promise<{ total: number; items: ReconciliationReviewItem[] }>;
  getDriveBrowserPage(userId: string, folderId: string, parentDriveId: string, offset: number, limit: number): Promise<{ parentName: string; parentDriveId: string | null; total: number; items: DriveBrowserItem[] } | null>;
  canAccessIndexedDriveFile(userId: string, folderId: string, driveFileId: string): Promise<boolean>;
  getPhotoText(userId: string, folderId: string, driveFileId: string): Promise<PhotoText | null>;
  savePhotoText(userId: string, folderId: string, driveFileId: string, caption: string, notes: string): Promise<PhotoText | null>;
  listPhotoSubjectRegions(userId: string, folderId: string, driveFileId: string): Promise<PhotoSubjectRegion[] | null>;
  listPersonAliasChoices(userId: string): Promise<PersonAliasChoice[]>;
  createPersonWithAlias(userId: string, alias: string): Promise<PersonAliasChoice>;
  addPersonAlias(userId: string, personId: string, alias: string): Promise<PersonAliasChoice | null>;
  createPhotoSubjectRegion(userId: string, folderId: string, driveFileId: string, subjectType: "person" | "thing", label: string | null, personId: string | null, aliasId: string | null, x: number, y: number, width: number, height: number): Promise<PhotoSubjectRegion | null>;
  deletePhotoSubjectRegion(userId: string, folderId: string, driveFileId: string, regionId: string): Promise<boolean>;
  searchPeople(userId: string, query: string, limit: number): Promise<PersonSearchResult[]>;
  getPersonExplorer(userId: string, personId: string): Promise<PersonExplorer | null>;
  listArchives(userId: string): Promise<ArchiveMembership[]>;
  getArchive(userId: string, archiveId: string): Promise<ArchiveMembership | null>;
}

export function createPostgresDataStore(pool: Pool): DataStore {
  return {
    async isReady() {
      const result = await pool.query<{ ready: number }>("SELECT 1 AS ready");
      return result.rows[0]?.ready === 1;
    },

    async admitGoogleUser(profile, bootstrapAdminEmail) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("LOCK TABLE application_memberships IN SHARE ROW EXCLUSIVE MODE");
        const email = profile.email.trim().toLowerCase();
        let membership = await client.query<{ id: string }>(
          "SELECT id FROM application_memberships WHERE lower(email) = $1 FOR UPDATE",
          [email],
        );
        const membershipCount = await client.query<{ count: string }>("SELECT count(*) FROM application_memberships");
        if (!membership.rowCount && membershipCount.rows[0]?.count === "0" && email === bootstrapAdminEmail?.trim().toLowerCase()) {
          membership = await client.query<{ id: string }>(
            "INSERT INTO application_memberships (email, role) VALUES ($1, 'administrator') RETURNING id",
            [email],
          );
        }
        if (!membership.rowCount) {
          await client.query("ROLLBACK");
          return null;
        }
        const result = await client.query<{ id: string; email: string; display_name: string; avatar_url: string | null }>(`
          INSERT INTO users (google_subject, email, display_name, avatar_url)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (google_subject) DO UPDATE SET
            email = EXCLUDED.email,
            display_name = EXCLUDED.display_name,
            avatar_url = EXCLUDED.avatar_url,
            updated_at = now()
          RETURNING id, email, display_name, avatar_url
        `, [profile.googleSubject, email, profile.displayName, profile.avatarUrl]);
        const row = result.rows[0]!;
        await client.query(
          "UPDATE application_memberships SET user_id = $1, joined_at = COALESCE(joined_at, now()) WHERE id = $2",
          [row.id, membership.rows[0]!.id],
        );
        await client.query("COMMIT");
        return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async getUser(userId) {
      const result = await pool.query<{ id: string; email: string; display_name: string; avatar_url: string | null }>(
        "SELECT id, email, display_name, avatar_url FROM users WHERE id = $1",
        [userId],
      );
      const row = result.rows[0];
      return row ? { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url } : null;
    },

    async getApplicationRole(userId) {
      const result = await pool.query<{ role: ApplicationRole }>(
        "SELECT role FROM application_memberships WHERE user_id = $1",
        [userId],
      );
      return result.rows[0]?.role ?? null;
    },

    async listApplicationMembers() {
      const result = await pool.query<{ id: string; email: string; role: ApplicationRole; joined: boolean }>(`
        SELECT id, email, role, (user_id IS NOT NULL) AS joined
        FROM application_memberships ORDER BY email
      `);
      return result.rows;
    },

    async addApplicationMember(email, role, invitedBy) {
      const result = await pool.query<{ id: string; email: string; role: ApplicationRole; joined: boolean }>(`
        INSERT INTO application_memberships (email, role, invited_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (lower(email)) DO UPDATE SET role = EXCLUDED.role
        RETURNING id, email, role, (user_id IS NOT NULL) AS joined
      `, [email.trim().toLowerCase(), role, invitedBy]);
      return result.rows[0]!;
    },

    async saveDriveConnection(userId, encryptedRefreshToken, scope) {
      await pool.query(`
        INSERT INTO drive_connections (user_id, encrypted_refresh_token, granted_scope)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          granted_scope = EXCLUDED.granted_scope,
          updated_at = now()
      `, [userId, encryptedRefreshToken, scope]);
    },

    async hasDriveConnection(userId) {
      const result = await pool.query("SELECT 1 FROM drive_connections WHERE user_id = $1", [userId]);
      return Boolean(result.rowCount);
    },

    async getEncryptedDriveRefreshToken(userId) {
      const result = await pool.query<{ encrypted_refresh_token: string }>(
        "SELECT encrypted_refresh_token FROM drive_connections WHERE user_id = $1",
        [userId],
      );
      return result.rows[0]?.encrypted_refresh_token ?? null;
    },

    async attachDriveFolder(userId, driveFolderId, name) {
      const result = await pool.query<{ id: string; drive_folder_id: string; name: string; attached_at: Date }>(`
        INSERT INTO attached_drive_folders (user_id, drive_folder_id, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, drive_folder_id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, drive_folder_id, name, attached_at
      `, [userId, driveFolderId, name]);
      const row = result.rows[0]!;
      return { id: row.id, driveFolderId: row.drive_folder_id, name: row.name, attachedAt: row.attached_at.toISOString() };
    },

    async listAttachedFolders(userId) {
      const result = await pool.query<{ id: string; drive_folder_id: string; name: string; attached_at: Date }>(`
        SELECT id, drive_folder_id, name, attached_at
        FROM attached_drive_folders WHERE user_id = $1 ORDER BY name, id
      `, [userId]);
      return result.rows.map((row) => ({ id: row.id, driveFolderId: row.drive_folder_id, name: row.name, attachedAt: row.attached_at.toISOString() }));
    },

    async getAttachedFolder(userId, folderId) {
      const result = await pool.query<{ id: string; drive_folder_id: string; name: string; attached_at: Date }>(`
        SELECT id, drive_folder_id, name, attached_at
        FROM attached_drive_folders WHERE id = $1 AND user_id = $2
      `, [folderId, userId]);
      const row = result.rows[0];
      return row ? { id: row.id, driveFolderId: row.drive_folder_id, name: row.name, attachedAt: row.attached_at.toISOString() } : null;
    },

    async replaceIndexedDriveItems(userId, folderId, items, folders = []) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const folder = await client.query("SELECT 1 FROM attached_drive_folders WHERE id = $1 AND user_id = $2 FOR UPDATE", [folderId, userId]);
        if (!folder.rowCount) throw new Error("Attached folder not found");
        await client.query("DELETE FROM indexed_drive_folders WHERE attached_folder_id = $1", [folderId]);
        await client.query("DELETE FROM indexed_drive_items WHERE attached_folder_id = $1", [folderId]);
        for (const indexedFolder of folders) {
          await client.query(`
            INSERT INTO indexed_drive_folders
              (attached_folder_id, drive_folder_id, parent_drive_id, name, relative_path, modified_time)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [folderId, indexedFolder.driveFolderId, indexedFolder.parentDriveId, indexedFolder.name, indexedFolder.relativePath, indexedFolder.modifiedTime]);
        }
        for (const item of items) {
          await client.query(`
            INSERT INTO indexed_drive_items
              (attached_folder_id, drive_file_id, parent_drive_id, name, mime_type, relative_path, md5_checksum, modified_time, size_bytes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [folderId, item.driveFileId, item.parentDriveId, item.name, item.mimeType, item.relativePath, item.md5Checksum, item.modifiedTime, item.sizeBytes]);
        }
        await client.query(`
          INSERT INTO photo_records (attached_folder_id, drive_file_id, caption, notes, created_by, updated_by)
          SELECT i.attached_folder_id, i.drive_file_id, i.name, '', $2, $2
          FROM indexed_drive_items i
          WHERE i.attached_folder_id=$1 AND i.mime_type LIKE 'image/%'
          ON CONFLICT (attached_folder_id, drive_file_id) DO NOTHING
        `, [folderId, userId]);
        await client.query("UPDATE attached_drive_folders SET last_scanned_at = now() WHERE id = $1", [folderId]);
        await client.query("COMMIT");
        return items.length;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async countIndexedDriveItems(userId, folderId) {
      const result = await pool.query<{ count: string }>(`
        SELECT count(*)
        FROM indexed_drive_items i
        JOIN attached_drive_folders f ON f.id = i.attached_folder_id
        WHERE f.user_id = $1 AND f.id = $2
      `, [userId, folderId]);
      return Number(result.rows[0]?.count ?? 0);
    },

    async countLegacyDriveMatches(userId, folderId) {
      const result = await pool.query<{ count: string }>(`
        SELECT count(*) FROM legacy_drive_matches m
        JOIN indexed_drive_items i ON i.id=m.indexed_item_id
        JOIN attached_drive_folders f ON f.id=i.attached_folder_id
        WHERE f.user_id=$1 AND f.id=$2
      `, [userId, folderId]);
      return Number(result.rows[0]?.count ?? 0);
    },

    async reconcileLegacyDriveItems(userId, folderId) {
      const indexed = await pool.query<{ id: string; name: string; relative_path: string; size_bytes: string | null }>(`
        SELECT i.id, i.name, i.relative_path, i.size_bytes
        FROM indexed_drive_items i JOIN attached_drive_folders f ON f.id=i.attached_folder_id
        WHERE f.user_id=$1 AND f.id=$2 ORDER BY i.id
      `, [userId, folderId]);
      const client = await pool.connect();
      let exactPath = 0, uniqueNameSize = 0, unmatched = 0, ambiguous = 0;
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM legacy_drive_matches WHERE indexed_item_id IN (SELECT id FROM indexed_drive_items WHERE attached_folder_id=$1)", [folderId]);
        for (const item of indexed.rows) {
          const candidates = await client.query<{ id: number; original_path: string | null }>(`
            SELECT id, original_path FROM legacy_catalog.files
            WHERE lower(filename)=lower($1) AND size_bytes IS NOT DISTINCT FROM $2::bigint
          `, [item.name, item.size_bytes]);
          const normalizedRelative = item.relative_path.replaceAll("\\", "/").toLowerCase();
          const exact = candidates.rows.filter((candidate) => {
            const legacyPath = candidate.original_path?.replaceAll("\\", "/").toLowerCase();
            return legacyPath === normalizedRelative || legacyPath?.endsWith(`/${normalizedRelative}`);
          });
          let match: { id: number } | undefined;
          let method: "exact_path_size" | "unique_name_size" | undefined;
          if (exact.length === 1) { match = exact[0]; method = "exact_path_size"; exactPath += 1; }
          else if (exact.length > 1) ambiguous += 1;
          else if (candidates.rows.length === 1) { match = candidates.rows[0]; method = "unique_name_size"; uniqueNameSize += 1; }
          else if (candidates.rows.length > 1) ambiguous += 1;
          else unmatched += 1;
          if (match && method) await client.query(
            "INSERT INTO legacy_drive_matches (indexed_item_id, legacy_file_id, match_method) VALUES ($1,$2,$3)",
            [item.id, match.id, method],
          );
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      return { matched: exactPath + uniqueNameSize, exactPath, uniqueNameSize, unmatched, ambiguous };
    },

    async createDriveScanJob(userId, folderId) {
      await pool.query("UPDATE drive_scan_jobs SET status='failed', error_message='Superseded by a new scan', completed_at=now() WHERE attached_folder_id=$1 AND status='pending'", [folderId]);
      const result = await pool.query(`
        INSERT INTO drive_scan_jobs (user_id, attached_folder_id) VALUES ($1,$2)
        RETURNING id, status, folders_scanned, items_discovered, matched_items, unmatched_items, ambiguous_items, error_message
      `, [userId, folderId]);
      return mapScanJob(result.rows[0]!);
    },

    async updateDriveScanJob(jobId, update) {
      const fields: string[] = [];
      const values: unknown[] = [];
      const mapping: Record<string, string> = { status: "status", foldersScanned: "folders_scanned", itemsDiscovered: "items_discovered", matchedItems: "matched_items", unmatchedItems: "unmatched_items", ambiguousItems: "ambiguous_items", errorMessage: "error_message" };
      for (const [key, column] of Object.entries(mapping)) {
        if (key in update) { values.push(update[key as keyof typeof update]); fields.push(`${column}=$${values.length}`); }
      }
      if (update.status === "running") fields.push("started_at=now()");
      if (update.status === "completed" || update.status === "failed") fields.push("completed_at=now()");
      if (!fields.length) return;
      values.push(jobId);
      await pool.query(`UPDATE drive_scan_jobs SET ${fields.join(",")} WHERE id=$${values.length}`, values);
    },

    async getLatestDriveScanJob(userId, folderId) {
      const result = await pool.query(`
        SELECT j.id, j.status, j.folders_scanned, j.items_discovered, j.matched_items, j.unmatched_items, j.ambiguous_items, j.error_message
        FROM drive_scan_jobs j JOIN attached_drive_folders f ON f.id=j.attached_folder_id
        WHERE f.user_id=$1 AND f.id=$2 ORDER BY j.created_at DESC LIMIT 1
      `, [userId, folderId]);
      return result.rows[0] ? mapScanJob(result.rows[0]) : null;
    },

    async getReconciliationReview(userId, folderId, category, offset, limit) {
      if (category === "matched") {
        const totalResult = await pool.query<{ count: string }>(`
          SELECT count(*) FROM legacy_drive_matches m
          JOIN indexed_drive_items i ON i.id=m.indexed_item_id
          JOIN attached_drive_folders f ON f.id=i.attached_folder_id
          WHERE f.user_id=$1 AND f.id=$2
        `, [userId, folderId]);
        const result = await pool.query<{ name: string; relative_path: string; mime_type: string; size_bytes: string | null; match_method: string; legacy_paths: string[] }>(`
          SELECT i.name, i.relative_path, i.mime_type, i.size_bytes, m.match_method,
                 ARRAY[COALESCE(l.original_path, l.filename)] AS legacy_paths
          FROM legacy_drive_matches m
          JOIN indexed_drive_items i ON i.id=m.indexed_item_id
          JOIN attached_drive_folders f ON f.id=i.attached_folder_id
          JOIN legacy_catalog.files l ON l.id=m.legacy_file_id
          WHERE f.user_id=$1 AND f.id=$2
          ORDER BY random() LIMIT $3
        `, [userId, folderId, limit]);
        return { total: Number(totalResult.rows[0]?.count ?? 0), items: result.rows.map(mapReviewItem) };
      }
      const result = await pool.query<{ total_count: string; name: string; relative_path: string; mime_type: string; size_bytes: string | null; legacy_paths: string[] }>(`
        WITH review AS (
          SELECT i.id, i.name, i.relative_path, i.mime_type, i.size_bytes,
                 count(l.id)::int AS candidate_count,
                 COALESCE(array_agg(COALESCE(l.original_path, l.filename) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), ARRAY[]::text[]) AS legacy_paths
          FROM indexed_drive_items i
          JOIN attached_drive_folders f ON f.id=i.attached_folder_id
          LEFT JOIN legacy_drive_matches m ON m.indexed_item_id=i.id
          LEFT JOIN legacy_catalog.files l ON lower(l.filename)=lower(i.name) AND l.size_bytes IS NOT DISTINCT FROM i.size_bytes
          WHERE f.user_id=$1 AND f.id=$2 AND m.indexed_item_id IS NULL
          GROUP BY i.id
        )
        SELECT count(*) OVER () AS total_count, name, relative_path, mime_type, size_bytes, legacy_paths
        FROM review WHERE ($3='ambiguous' AND candidate_count > 1) OR ($3='unmatched' AND candidate_count <= 1)
        ORDER BY relative_path, name OFFSET $4 LIMIT $5
      `, [userId, folderId, category, offset, limit]);
      return { total: Number(result.rows[0]?.total_count ?? 0), items: result.rows.map((row) => mapReviewItem({ ...row, match_method: null })) };
    },

    async getDriveBrowserPage(userId, folderId, parentDriveId, offset, limit) {
      const folder = await pool.query<{ drive_folder_id: string; name: string }>("SELECT drive_folder_id, name FROM attached_drive_folders WHERE id=$1 AND user_id=$2", [folderId, userId]);
      if (!folder.rows[0]) return null;
      let parentName = folder.rows[0].name;
      let parentParentId: string | null = null;
      if (parentDriveId !== folder.rows[0].drive_folder_id) {
        const parent = await pool.query<{ name: string; parent_drive_id: string }>("SELECT name, parent_drive_id FROM indexed_drive_folders WHERE attached_folder_id=$1 AND drive_folder_id=$2", [folderId, parentDriveId]);
        if (!parent.rows[0]) return null;
        parentName = parent.rows[0].name;
        parentParentId = parent.rows[0].parent_drive_id;
      }
      const result = await pool.query<{ total_count: string; drive_file_id: string; name: string; caption: string | null; mime_type: string; modified_time: Date | null; size_bytes: string | null; matched: boolean }>(`
        WITH children AS (
          SELECT drive_folder_id AS drive_file_id, name, 'application/vnd.google-apps.folder'::text AS mime_type,
                 modified_time, NULL::bigint AS size_bytes, false AS matched, NULL::text AS caption
          FROM indexed_drive_folders WHERE attached_folder_id=$1 AND parent_drive_id=$2
          UNION ALL
          SELECT i.drive_file_id, i.name, i.mime_type, i.modified_time, i.size_bytes,
                 (m.indexed_item_id IS NOT NULL) AS matched, COALESCE(p.caption, i.name) AS caption
          FROM indexed_drive_items i
          LEFT JOIN legacy_drive_matches m ON m.indexed_item_id=i.id
          LEFT JOIN photo_records p ON p.attached_folder_id=i.attached_folder_id AND p.drive_file_id=i.drive_file_id
          WHERE i.attached_folder_id=$1 AND i.parent_drive_id=$2
        )
        SELECT count(*) OVER () AS total_count, * FROM children
        ORDER BY (mime_type='application/vnd.google-apps.folder') DESC, lower(name), drive_file_id
        OFFSET $3 LIMIT $4
      `, [folderId, parentDriveId, offset, limit]);
      return { parentName, parentDriveId: parentParentId, total: Number(result.rows[0]?.total_count ?? 0), items: result.rows.map((row) => ({ driveFileId: row.drive_file_id, name: row.name, caption: row.caption, mimeType: row.mime_type, modifiedTime: row.modified_time?.toISOString() ?? null, sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes), matched: row.matched })) };
    },

    async canAccessIndexedDriveFile(userId, folderId, driveFileId) {
      const result = await pool.query(`SELECT 1 FROM indexed_drive_items i JOIN attached_drive_folders f ON f.id=i.attached_folder_id WHERE f.user_id=$1 AND f.id=$2 AND i.drive_file_id=$3`, [userId, folderId, driveFileId]);
      return Boolean(result.rowCount);
    },

    async getPhotoText(userId, folderId, driveFileId) {
      const access = await pool.query("SELECT 1 FROM indexed_drive_items i JOIN attached_drive_folders f ON f.id=i.attached_folder_id WHERE f.user_id=$1 AND f.id=$2 AND i.drive_file_id=$3 AND i.mime_type LIKE 'image/%'", [userId, folderId, driveFileId]);
      if (!access.rowCount) return null;
      const result = await pool.query<{ caption: string; notes: string; updated_at: Date | null; updated_by_name: string | null }>(`
        SELECT COALESCE(p.caption, i.name) AS caption, COALESCE(p.notes, '') AS notes,
               p.updated_at, u.display_name AS updated_by_name
        FROM indexed_drive_items i
        LEFT JOIN photo_records p ON p.attached_folder_id=i.attached_folder_id AND p.drive_file_id=i.drive_file_id
        LEFT JOIN users u ON u.id=p.updated_by
        WHERE i.attached_folder_id=$1 AND i.drive_file_id=$2
      `, [folderId, driveFileId]);
      const row = result.rows[0];
      return row ? { caption: row.caption, notes: row.notes, updatedAt: row.updated_at?.toISOString() ?? null, updatedBy: row.updated_by_name } : null;
    },

    async savePhotoText(userId, folderId, driveFileId, caption, notes) {
      const access = await pool.query("SELECT 1 FROM indexed_drive_items i JOIN attached_drive_folders f ON f.id=i.attached_folder_id WHERE f.user_id=$1 AND f.id=$2 AND i.drive_file_id=$3 AND i.mime_type LIKE 'image/%'", [userId, folderId, driveFileId]);
      if (!access.rowCount) return null;
      const result = await pool.query<{ caption: string; notes: string; updated_at: Date }>(`
        INSERT INTO photo_records (attached_folder_id, drive_file_id, caption, notes, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (attached_folder_id, drive_file_id) DO UPDATE SET
          caption=EXCLUDED.caption, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=now()
        RETURNING caption, notes, updated_at
      `, [folderId, driveFileId, caption, notes, userId]);
      const user = await pool.query<{ display_name: string }>("SELECT display_name FROM users WHERE id=$1", [userId]);
      const row = result.rows[0]!;
      return { caption: row.caption, notes: row.notes, updatedAt: row.updated_at.toISOString(), updatedBy: user.rows[0]?.display_name ?? null };
    },

    async listPhotoSubjectRegions(userId, folderId, driveFileId) {
      const access = await pool.query("SELECT 1 FROM indexed_drive_items i JOIN attached_drive_folders f ON f.id=i.attached_folder_id WHERE f.user_id=$1 AND f.id=$2 AND i.drive_file_id=$3 AND i.mime_type LIKE 'image/%'", [userId, folderId, driveFileId]);
      if (!access.rowCount) return null;
      const result = await pool.query(`
        SELECT r.id, r.subject_type, r.person_id, r.alias_id, COALESCE(a.alias, r.label) AS display_label, r.x, r.y, r.width, r.height,
               u.display_name AS created_by_name, r.created_at
        FROM photo_subject_regions r JOIN users u ON u.id=r.created_by
        LEFT JOIN family_person_aliases a ON a.id=r.alias_id
        WHERE r.attached_folder_id=$1 AND r.drive_file_id=$2
        ORDER BY r.created_at, r.id
      `, [folderId, driveFileId]);
      return result.rows.map(mapPhotoSubjectRegion);
    },

    async listPersonAliasChoices(userId) {
      if (!await this.getApplicationRole(userId)) return [];
      const result = await pool.query(`SELECT person_id, id AS alias_id, alias, is_primary FROM family_person_aliases ORDER BY lower(alias), id`);
      return result.rows.map((row) => ({ personId: row.person_id, aliasId: row.alias_id, alias: row.alias, isPrimary: row.is_primary }));
    },

    async createPersonWithAlias(userId, alias) {
      if (!await this.getApplicationRole(userId)) throw new Error("Membership required");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const person = await client.query<{ id: string }>("INSERT INTO family_people DEFAULT VALUES RETURNING id");
        const created = await client.query("INSERT INTO family_person_aliases (person_id, alias, is_primary) VALUES ($1,$2,true) RETURNING id, person_id, alias, is_primary", [person.rows[0]!.id, alias]);
        await client.query("COMMIT");
        const row = created.rows[0];
        return { personId: row.person_id, aliasId: row.id, alias: row.alias, isPrimary: row.is_primary };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },

    async addPersonAlias(userId, personId, alias) {
      if (!await this.getApplicationRole(userId)) return null;
      const result = await pool.query(`
        INSERT INTO family_person_aliases (person_id, alias)
        SELECT id, $2 FROM family_people WHERE id=$1
        ON CONFLICT (person_id, alias) DO UPDATE SET alias=EXCLUDED.alias
        RETURNING id, person_id, alias, is_primary
      `, [personId, alias]);
      const row = result.rows[0];
      return row ? { personId: row.person_id, aliasId: row.id, alias: row.alias, isPrimary: row.is_primary } : null;
    },

    async createPhotoSubjectRegion(userId, folderId, driveFileId, subjectType, label, personId, aliasId, x, y, width, height) {
      const access = await pool.query("SELECT 1 FROM indexed_drive_items i JOIN attached_drive_folders f ON f.id=i.attached_folder_id WHERE f.user_id=$1 AND f.id=$2 AND i.drive_file_id=$3 AND i.mime_type LIKE 'image/%'", [userId, folderId, driveFileId]);
      if (!access.rowCount) return null;
      const result = await pool.query(`
        INSERT INTO photo_subject_regions
          (attached_folder_id, drive_file_id, subject_type, label, person_id, alias_id, x, y, width, height, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id, subject_type, person_id, alias_id, x, y, width, height, created_at
      `, [folderId, driveFileId, subjectType, label, personId, aliasId, x, y, width, height, userId]);
      const user = await pool.query<{ display_name: string }>("SELECT display_name FROM users WHERE id=$1", [userId]);
      const alias = aliasId ? await pool.query<{ alias: string }>("SELECT alias FROM family_person_aliases WHERE id=$1 AND person_id=$2", [aliasId, personId]) : null;
      return mapPhotoSubjectRegion({ ...result.rows[0], display_label: label ?? alias?.rows[0]?.alias, created_by_name: user.rows[0]?.display_name ?? "Family member" });
    },

    async deletePhotoSubjectRegion(userId, folderId, driveFileId, regionId) {
      const result = await pool.query(`
        DELETE FROM photo_subject_regions r
        USING attached_drive_folders f
        WHERE r.id=$1 AND r.attached_folder_id=$2 AND r.drive_file_id=$3
          AND f.id=r.attached_folder_id AND f.user_id=$4
      `, [regionId, folderId, driveFileId, userId]);
      return Boolean(result.rowCount);
    },

    async searchPeople(userId, query, limit) {
      if (!await this.getApplicationRole(userId)) return [];
      const result = await pool.query(`
        SELECT p.id, COALESCE(max(a.alias) FILTER (WHERE a.is_primary), min(a.alias)) AS primary_name,
               array_agg(a.alias ORDER BY a.is_primary DESC, lower(a.alias)) AS aliases
        FROM family_people p JOIN family_person_aliases a ON a.person_id=p.id
        WHERE lower(a.alias) LIKE '%' || lower($1) || '%'
        GROUP BY p.id ORDER BY lower(COALESCE(max(a.alias) FILTER (WHERE a.is_primary), min(a.alias))) LIMIT $2
      `, [query, limit]);
      return result.rows.map(mapPersonSearchResult);
    },

    async getPersonExplorer(userId, personId) {
      if (!await this.getApplicationRole(userId)) return null;
      const people = await pool.query(`
        SELECT p.id, p.legacy_person_id, COALESCE(max(a.alias) FILTER (WHERE a.is_primary), min(a.alias)) AS primary_name,
               array_agg(a.alias ORDER BY a.is_primary DESC, lower(a.alias)) AS aliases
        FROM family_people p JOIN family_person_aliases a ON a.person_id=p.id
        WHERE p.id=$1 GROUP BY p.id
      `, [personId]);
      const person = people.rows[0];
      if (!person) return null;
      const relationships = person.legacy_person_id ? await pool.query(`
        SELECT r.type, related.id, COALESCE(max(a.alias) FILTER (WHERE a.is_primary), min(a.alias)) AS primary_name,
               array_agg(a.alias ORDER BY a.is_primary DESC, lower(a.alias)) AS aliases
        FROM legacy_catalog.relationships r
        JOIN family_people related ON related.legacy_person_id=r.related_id
        JOIN family_person_aliases a ON a.person_id=related.id
        WHERE r.person_id=$1 AND r.type IN ('parent','father','mother','spouse','child')
        GROUP BY r.type, related.id ORDER BY r.type, lower(COALESCE(max(a.alias) FILTER (WHERE a.is_primary), min(a.alias)))
      `, [person.legacy_person_id]) : { rows: [] };
      const photos = await pool.query(`
        WITH identified AS (
          SELECT r.attached_folder_id, r.drive_file_id FROM photo_subject_regions r WHERE r.person_id=$1
          UNION
          SELECT i.attached_folder_id, i.drive_file_id
          FROM family_people p
          JOIN legacy_catalog.photo_people pp ON pp.person_id=p.legacy_person_id
          JOIN legacy_drive_matches m ON m.legacy_file_id=pp.photo_id
          JOIN indexed_drive_items i ON i.id=m.indexed_item_id
          WHERE p.id=$1
        )
        SELECT i.attached_folder_id AS folder_id, i.drive_file_id, i.parent_drive_id, i.name, COALESCE(pr.caption,i.name) AS caption
        FROM identified x JOIN indexed_drive_items i ON i.attached_folder_id=x.attached_folder_id AND i.drive_file_id=x.drive_file_id
        JOIN attached_drive_folders f ON f.id=i.attached_folder_id
        LEFT JOIN photo_records pr ON pr.attached_folder_id=i.attached_folder_id AND pr.drive_file_id=i.drive_file_id
        WHERE f.user_id=$2 ORDER BY lower(COALESCE(pr.caption,i.name)), i.drive_file_id
      `, [personId, userId]);
      const related = relationships.rows.map(mapPersonSearchResult);
      return { id: person.id, primaryName: person.primary_name, aliases: person.aliases, parents: related.filter((row: any) => row.type === "child"), spouses: related.filter((row: any) => row.type === "spouse"), children: related.filter((row: any) => row.type === "parent" || row.type === "father" || row.type === "mother"), photos: photos.rows.map((row) => ({ folderId: row.folder_id, driveFileId: row.drive_file_id, parentDriveId: row.parent_drive_id, name: row.name, caption: row.caption })) };
    },

    async listArchives(userId) {
      const result = await pool.query<{ id: string; name: string; role: ArchiveMembership["role"] }>(`
        SELECT a.id, a.name, m.role
        FROM archive_memberships m
        JOIN archives a ON a.id = m.archive_id
        WHERE m.user_id = $1
        ORDER BY a.name, a.id
      `, [userId]);
      return result.rows;
    },

    async getArchive(userId, archiveId) {
      const result = await pool.query<ArchiveMembership>(`
        SELECT a.id, a.name, m.role
        FROM archive_memberships m
        JOIN archives a ON a.id = m.archive_id
        WHERE m.user_id = $1 AND m.archive_id = $2
      `, [userId, archiveId]);
      return result.rows[0] ?? null;
    },
  };
}

function mapScanJob(row: any): DriveScanJob {
  return { id: row.id, status: row.status, foldersScanned: row.folders_scanned, itemsDiscovered: row.items_discovered, matchedItems: row.matched_items, unmatchedItems: row.unmatched_items, ambiguousItems: row.ambiguous_items, errorMessage: row.error_message };
}

function mapReviewItem(row: { name: string; relative_path: string; mime_type: string; size_bytes: string | null; match_method: string | null; legacy_paths: string[] }): ReconciliationReviewItem {
  return { name: row.name, relativePath: row.relative_path, mimeType: row.mime_type, sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes), matchMethod: row.match_method, legacyPaths: row.legacy_paths };
}

function mapPhotoSubjectRegion(row: any): PhotoSubjectRegion {
  return { id: row.id, subjectType: row.subject_type, personId: row.person_id ?? null, aliasId: row.alias_id ?? null, label: row.display_label, x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height), createdBy: row.created_by_name, createdAt: new Date(row.created_at).toISOString() };
}

function mapPersonSearchResult(row: any): PersonSearchResult & { type?: string } {
  return { id: row.id, primaryName: row.primary_name, aliases: row.aliases, ...(row.type ? { type: row.type } : {}) };
}
