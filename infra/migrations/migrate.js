#!/usr/bin/env node
// baytak — مُشغّل الـ migrations
// بيقرا كل ملفات .sql في المجلد ده بالترتيب الأبجدي، ويطبّق أي ملف لسه ما اتطبقش، كل واحد جوّه transaction.
// الاستخدام: DATABASE_URL=postgres://... node infra/migrations/migrate.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const MIGRATIONS_DIR = __dirname;

function checksumOf(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

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
    // docs/08 §19 بند 19 — كانت فجوة موثّقة صراحة: الجدول كان بيسجّل اسم الملف بس، فتعديل ملف
    // migration اتطبّق بالفعل من زمان (حصل فعليًا أثناء تطوير المشروع في جلسات سابقة) ما كانش
    // بيتلاقط أبدًا — قاعدة البيانات مالهاش أي فكرة إن الملف اتغيّر. checksum (SHA-256 لمحتوى
    // الملف وقت التطبيق) بيتسجّل من هنا فصاعدًا، وبيتقارن مع محتوى الملف الحالي في كل تشغيلة —
    // اختلاف يعني حد عدّل migration مطبّقة بالفعل، وده ممنوع (قاعدة CLAUDE.md: migration اتعمل
    // commit لازم تفضل زي ما هي، أي تصحيح يبقى ملف جديد برقم تالي).
    await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);`);

    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    let backfilledCount = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const currentChecksum = checksumOf(sql);

      if (applied.has(file)) {
        const storedChecksum = applied.get(file);

        if (storedChecksum === null) {
          // صف قديم من قبل ما عمود checksum يتضاف — مفيش checksum تاريخي نقارن بيه (ما نعرفش لو
          // الملف اتغيّر قبل كده)، فبنسجّل قيمة النهارده كنقطة بداية بس (مش نفشل الإقلاع لأول مرة).
          await client.query('UPDATE schema_migrations SET checksum = $1 WHERE filename = $2', [
            currentChecksum,
            file,
          ]);
          backfilledCount++;
          continue;
        }

        if (storedChecksum !== currentChecksum) {
          console.error(
            `❌ خطأ: ملف migration اتطبّق بالفعل اتغيّر بعد كده: ${file}\n` +
              `   checksum المسجّل وقت التطبيق: ${storedChecksum}\n` +
              `   checksum الملف الحالي:        ${currentChecksum}\n` +
              `   migrations اتعملها commit لازم تفضل ثابتة — أي تصحيح لازم يبقى ملف جديد برقم تالي، مش تعديل الملف ده.`,
          );
          process.exit(1);
        }

        console.log(`⏭  ${file} — متطبق قبل كده (checksum مطابق)`);
        continue;
      }

      console.log(`▶  بيطبّق ${file} ...`);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          file,
          currentChecksum,
        ]);
        await client.query('COMMIT');
        console.log(`✅ ${file} خلص`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ فشل ${file}:`, err.message);
        process.exit(1);
      }
    }

    if (backfilledCount > 0) {
      console.log(`ℹ️  اتسجّل checksum لأول مرة لـ${backfilledCount} migration قديمة (مفيش قيمة تاريخية نقارنها بيها).`);
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
