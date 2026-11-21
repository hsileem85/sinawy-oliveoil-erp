import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { execSql, query, getDbMode } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await execSql(sql);
  }

  // Ensure default admin account exists
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@sinawy.net').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'sinawy2026';

  const existing = await query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await query(
      'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)',
      [adminEmail, 'Sinawy Admin', hash, 'admin']
    );
  }

  // Ensure at least one default API key exists
  const keys = await query('SELECT id FROM api_keys LIMIT 1');
  if (keys.rows.length === 0) {
    const defaultKey = process.env.ERP_API_KEY || 'snw_live_sinawy_erp_key_2026';
    await query(
      'INSERT INTO api_keys (name, key_value, active) VALUES ($1, $2, TRUE)',
      ['EasyOrders / sinawy.net Store Sync', defaultKey]
    );
  }

  return getDbMode();
}

// Allow running directly via `npm run migrate`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((mode) => {
      console.log(`Migrations complete (driver: ${mode}).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
