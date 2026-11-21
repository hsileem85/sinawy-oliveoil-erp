import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let driver = null;
let driverMode = 'uninitialized';

export function getDbMode() {
  return driverMode;
}

export async function initDb() {
  if (driver) return driver;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    const sslRequired =
      databaseUrl.includes('sslmode=require') ||
      databaseUrl.includes('neon.tech') ||
      databaseUrl.includes('supabase.co') ||
      databaseUrl.includes('render.com') ||
      process.env.PGSSL === 'true';

    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: sslRequired ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    await pool.query('SELECT 1');
    driverMode = 'postgres';
    driver = {
      query: (text, params = []) => pool.query(text, params),
      exec: (sql) => pool.query(sql),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({
            query: (text, params = []) => client.query(text, params),
          });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const dataDir =
      process.env.PGLITE_DATA_DIR ||
      path.resolve(__dirname, '..', 'data', 'pgdata');
    if (dataDir !== 'memory://') {
      fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    }
    const pglite =
      dataDir === 'memory://' ? new PGlite() : new PGlite(dataDir);
    await pglite.waitReady;
    driverMode = 'pglite';
    driver = {
      query: (text, params = []) => pglite.query(text, params),
      exec: (sql) => pglite.exec(sql),
      transaction: (fn) => pglite.transaction((tx) => fn(tx)),
      close: () => pglite.close(),
    };
  }

  return driver;
}

export async function query(text, params = []) {
  const db = await initDb();
  return db.query(text, params);
}

export async function execSql(sql) {
  const db = await initDb();
  return db.exec(sql);
}

export async function withTransaction(fn) {
  const db = await initDb();
  return db.transaction(fn);
}

export async function closeDb() {
  if (driver) {
    await driver.close();
    driver = null;
    driverMode = 'uninitialized';
  }
}
