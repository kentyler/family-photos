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

export interface DataStore {
  admitGoogleUser(profile: IdentityProfile, bootstrapAdminEmail?: string): Promise<User | null>;
  getUser(userId: string): Promise<User | null>;
  getApplicationRole(userId: string): Promise<ApplicationRole | null>;
  listApplicationMembers(): Promise<ApplicationMembership[]>;
  addApplicationMember(email: string, role: ApplicationRole, invitedBy: string): Promise<ApplicationMembership>;
  listArchives(userId: string): Promise<ArchiveMembership[]>;
  getArchive(userId: string, archiveId: string): Promise<ArchiveMembership | null>;
}

export function createPostgresDataStore(pool: Pool): DataStore {
  return {
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
