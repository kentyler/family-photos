import { readFile } from "node:fs/promises";
import pg from "pg";

const sourceEnvContents = await readFile(process.argv[2] ?? "D:/photo-app/.env", "utf8");
const sourceEnv = Object.fromEntries(sourceEnvContents.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
  const separator = line.indexOf("=");
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
if (!process.env.LEGACY_DB_PASSWORD || !process.env.TARGET_DATABASE_URL) {
  throw new Error("LEGACY_DB_PASSWORD and TARGET_DATABASE_URL are required");
}

const source = new pg.Pool({
  host: sourceEnv.DB_HOST,
  port: Number(sourceEnv.DB_PORT ?? 5432),
  user: process.env.LEGACY_DB_USER ?? sourceEnv.DB_USER,
  password: process.env.LEGACY_DB_PASSWORD,
  database: sourceEnv.DB_NAME,
  ssl: { rejectUnauthorized: false },
  max: 2,
});
const target = new pg.Pool({ connectionString: process.env.TARGET_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const quote = pg.escapeIdentifier;

type Column = { name: string; sqlType: string; nullable: boolean };

try {
  const existing = await target.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'legacy_catalog') AS exists");
  if (existing.rows[0]?.exists) throw new Error("legacy_catalog already exists; refusing to overwrite preserved data");

  const sourceSize = await source.query<{ bytes: string }>("SELECT pg_database_size(current_database())::bigint AS bytes");
  await target.query("CREATE SCHEMA legacy_catalog");
  await target.query(`
    CREATE TABLE legacy_catalog.import_manifest (
      source_schema text NOT NULL,
      source_database_bytes bigint NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT now(),
      table_counts jsonb NOT NULL
    )
  `);

  const tableResult = await source.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'catalog' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const verifiedCounts: Record<string, number> = {};

  for (const { table_name: tableName } of tableResult.rows) {
    const columnResult = await source.query<{ name: string; sql_type: string; nullable: boolean }>(`
      SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS sql_type,
        NOT a.attnotnull AS nullable
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'catalog' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `, [tableName]);
    const columns: Column[] = columnResult.rows.map((column) => ({ name: column.name, sqlType: column.sql_type, nullable: column.nullable }));
    const columnDefinition = columns.map((column) => `${quote(column.name)} ${column.sqlType}${column.nullable ? "" : " NOT NULL"}`).join(", ");
    await target.query(`CREATE TABLE legacy_catalog.${quote(tableName)} (${columnDefinition})`);

    const sourceCount = Number((await source.query<{ count: string }>(`SELECT count(*) AS count FROM catalog.${quote(tableName)}`)).rows[0]?.count ?? 0);
    const batchSize = Math.max(1, Math.min(500, Math.floor(60000 / columns.length)));
    for (let offset = 0; offset < sourceCount; offset += batchSize) {
      const rows = (await source.query(`SELECT * FROM catalog.${quote(tableName)} ORDER BY ctid LIMIT $1 OFFSET $2`, [batchSize, offset])).rows;
      if (!rows.length) break;
      const values: unknown[] = [];
      const tuples = rows.map((row) => `(${columns.map((column) => { values.push(row[column.name]); return `$${values.length}`; }).join(",")})`);
      await target.query(`INSERT INTO legacy_catalog.${quote(tableName)} (${columns.map((column) => quote(column.name)).join(",")}) VALUES ${tuples.join(",")}`, values);
      if (sourceCount > 5000 && (offset + rows.length === sourceCount || offset % 25000 === 0)) {
        console.log(`${tableName}: ${offset + rows.length}/${sourceCount}`);
      }
    }

    const targetCount = Number((await target.query<{ count: string }>(`SELECT count(*) AS count FROM legacy_catalog.${quote(tableName)}`)).rows[0]?.count ?? 0);
    if (targetCount !== sourceCount) throw new Error(`${tableName} verification failed: source ${sourceCount}, target ${targetCount}`);
    verifiedCounts[tableName] = targetCount;
    console.log(`${tableName}: verified ${targetCount}`);
  }

  await target.query(
    "INSERT INTO legacy_catalog.import_manifest (source_schema, source_database_bytes, table_counts) VALUES ('catalog', $1, $2)",
    [sourceSize.rows[0]!.bytes, JSON.stringify(verifiedCounts)],
  );
  console.log(`Complete: ${Object.keys(verifiedCounts).length} tables, ${Object.values(verifiedCounts).reduce((sum, count) => sum + count, 0)} rows verified`);
} finally {
  await source.end();
  await target.end();
}
