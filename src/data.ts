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

export interface DataStore {
  upsertGoogleUser(profile: IdentityProfile): Promise<User>;
  getUser(userId: string): Promise<User | null>;
  listArchives(userId: string): Promise<ArchiveMembership[]>;
  getArchive(userId: string, archiveId: string): Promise<ArchiveMembership | null>;
}

export function createPostgresDataStore(pool: Pool): DataStore {
  return {
    async upsertGoogleUser(profile) {
      const result = await pool.query<User & { display_name: string; avatar_url: string | null }>(`
        INSERT INTO users (google_subject, email, display_name, avatar_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (google_subject) DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          updated_at = now()
        RETURNING id, email, display_name, avatar_url
      `, [profile.googleSubject, profile.email, profile.displayName, profile.avatarUrl]);
      const row = result.rows[0]!;
      return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url };
    },

    async getUser(userId) {
      const result = await pool.query<{ id: string; email: string; display_name: string; avatar_url: string | null }>(
        "SELECT id, email, display_name, avatar_url FROM users WHERE id = $1",
        [userId],
      );
      const row = result.rows[0];
      return row ? { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url } : null;
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
