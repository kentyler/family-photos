import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(join(process.cwd(), "migrations")))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const applied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename],
    );
    if (applied.rowCount) continue;
    await client.query(await readFile(join(process.cwd(), "migrations", filename), "utf8"));
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
    console.log(`Applied ${filename}`);
  }

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
