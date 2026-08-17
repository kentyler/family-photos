import { readFile } from "node:fs/promises";
import pg from "pg";

const envPath = process.argv[2] ?? "D:/photo-app/.env";
const contents = await readFile(envPath, "utf8");
const legacyEnv = Object.fromEntries(contents.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
  const separator = line.indexOf("=");
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
const pool = new pg.Pool({
  host: legacyEnv.DB_HOST,
  port: Number(legacyEnv.DB_PORT ?? 5432),
  user: process.env.LEGACY_DB_USER ?? legacyEnv.DB_USER,
  password: process.env.LEGACY_DB_PASSWORD ?? legacyEnv.DB_PASSWORD,
  database: legacyEnv.DB_NAME,
  ssl: legacyEnv.DB_SSL && !["false", "disable"].includes(legacyEnv.DB_SSL.toLowerCase()) ? { rejectUnauthorized: false } : undefined,
});

try {
  const tables = await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'catalog' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  for (const { table_name: tableName } of tables.rows) {
    const columns = await pool.query<{ column_name: string; data_type: string }>(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'catalog' AND table_name = $1 ORDER BY ordinal_position
    `, [tableName]);
    const count = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM catalog.${pg.escapeIdentifier(tableName)}`);
    console.log(`${tableName} (${count.rows[0]?.count ?? 0}): ${columns.rows.map((column) => `${column.column_name}:${column.data_type}`).join(", ")}`);
  }
} finally {
  await pool.end();
}
