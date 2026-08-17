import { readFile } from "node:fs/promises";
import pg from "pg";

const contents = await readFile(process.argv[2] ?? "D:/photo-app/.env", "utf8");
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
  ssl: { rejectUnauthorized: false },
});

try {
  const sizes = await pool.query(`SELECT pg_database_size(current_database())::bigint AS database_bytes,
    pg_total_relation_size('catalog.files')::bigint AS files_table_bytes`);
  console.log("storage", sizes.rows[0]);
  const summary = await pool.query(`
    SELECT
      count(*)::int AS files,
      count(*) FILTER (WHERE nullif(btrim(caption), '') IS NOT NULL)::int AS captions,
      count(*) FILTER (WHERE rating IS NOT NULL)::int AS ratings,
      count(*) FILTER (WHERE file_hash IS NOT NULL)::int AS hashed,
      count(DISTINCT file_hash) FILTER (WHERE file_hash IS NOT NULL)::int AS unique_hashes,
      count(*) FILTER (WHERE variant_type IS NULL OR variant_type = 'original')::int AS originals
    FROM catalog.files
  `);
  console.log("files", summary.rows[0]);

  for (const query of [
    ["media types", "SELECT coalesce(media_type, '(none)') AS value, count(*)::int FROM catalog.files GROUP BY 1 ORDER BY 2 DESC"],
    ["variant types", "SELECT coalesce(variant_type, '(none)') AS value, count(*)::int FROM catalog.files GROUP BY 1 ORDER BY 2 DESC"],
    ["accounts", "SELECT a.id, a.name, a.root_path, count(f.id)::int AS files FROM catalog.accounts a LEFT JOIN catalog.files f ON f.account_id=a.id GROUP BY a.id ORDER BY a.id"],
    ["roots", "SELECT id, label, path FROM catalog.roots ORDER BY id"],
  ] as const) {
    console.log(query[0], (await pool.query(query[1])).rows);
  }

  const duplicateCandidates = await pool.query(`
    SELECT count(*)::int AS ambiguous_groups, coalesce(sum(candidates), 0)::int AS records
    FROM (
      SELECT lower(filename), size_bytes, count(*)::int AS candidates
      FROM catalog.files
      WHERE filename IS NOT NULL AND size_bytes IS NOT NULL
      GROUP BY lower(filename), size_bytes HAVING count(*) > 1
    ) duplicates
  `);
  console.log("duplicate filename+size", duplicateCandidates.rows[0]);
} finally {
  await pool.end();
}
