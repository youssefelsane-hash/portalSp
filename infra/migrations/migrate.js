#!/usr/bin/env node
// baytak — مُشغّل الـ migrations
// بيقرا كل ملفات .sql في المجلد ده بالترتيب الأبجدي، ويطبّق أي ملف لسه ما اتطبقش، كل واحد جوّه transaction.
// الاستخدام: DATABASE_URL=postgres://... node infra/migrations/migrate.js

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = __dirname;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('خطأ: لازم تحدد DATABASE_URL.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    VARCHAR(255) PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`⏭  ${file} — متطبق قبل كده`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`▶  بيطبّق ${file} ...`);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✅ ${file} خلص`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ فشل ${file}:`, err.message);
        process.exit(1);
      }
    }

    console.log('كل الـ migrations متطبقة.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
