/* eslint-disable */
// Applies database/schema.sql and seeds a working admin user.
// Usage: DATABASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/migrate.js
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

(async () => {
  // SCHEMA_PATH lets Docker point at a mounted copy; fall back to repo layout for local dev.
  const schemaPath =
    process.env.SCHEMA_PATH || path.resolve(__dirname, '../../database/schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(
      `schema.sql not found at ${schemaPath}. Set SCHEMA_PATH or mount database/schema.sql.`,
    );
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ||
      'postgres://monitor:monitor@localhost:5432/monitoring',
  });
  await client.connect();
  console.log('Applying schema...');
  await client.query(sql);

  // Apply products migration (idempotent — uses IF NOT EXISTS / ON CONFLICT DO NOTHING).
  // Must run after schema.sql since it ALTERs the servers table.
  const productsPath =
    process.env.PRODUCTS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/products_migration.sql');
  if (fs.existsSync(productsPath)) {
    console.log('Applying products migration...');
    await client.query(fs.readFileSync(productsPath, 'utf8'));
  }

  // Apply settings migration (idempotent — uses IF NOT EXISTS / ON CONFLICT DO NOTHING).
  const settingsPath =
    process.env.SETTINGS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/settings_migration.sql');
  if (fs.existsSync(settingsPath)) {
    console.log('Applying settings migration...');
    await client.query(fs.readFileSync(settingsPath, 'utf8'));
  }

  // Apply notifications migration (idempotent — uses IF NOT EXISTS).
  const notifPath =
    process.env.NOTIF_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/notifications_migration.sql');
  if (fs.existsSync(notifPath)) {
    console.log('Applying notifications migration...');
    await client.query(fs.readFileSync(notifPath, 'utf8'));
  }

  // Apply topology migration (idempotent — IF NOT EXISTS). Must run after the
  // products table exists, since topologies references products(id).
  const topologyPath =
    process.env.TOPOLOGY_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/topology_migration.sql');
  if (fs.existsSync(topologyPath)) {
    console.log('Applying topology migration...');
    await client.query(fs.readFileSync(topologyPath, 'utf8'));
  }

  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1,$2,'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email, hash],
  );
  console.log(`Admin ready: ${email} / ${password}`);
  await client.end();
  console.log('Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
