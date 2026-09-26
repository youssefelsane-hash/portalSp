// Read-only production check. Never print reset codes, hashes, or database credentials.
const { Client } = require('pg');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

async function main() {
  const phone = parsePhoneNumberFromString(process.argv[2] ?? '')?.number;
  if (!phone || !process.env.DATABASE_URL) {
    throw new Error('Usage: DATABASE_URL=... node scripts/diagnose-pin-reset.js +201XXXXXXXXX');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT u.user_type, u.is_active, u.is_blocked,
              (u.pin_hash IS NOT NULL) AS pin_set,
              t.created_at, t.expires_at, t.used_at, t.deleted_at, t.failed_attempts
         FROM users u
         LEFT JOIN LATERAL (
           SELECT created_at, expires_at, used_at, deleted_at, failed_attempts
             FROM pin_reset_tokens
            WHERE user_id = u.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
         ) t ON TRUE
        WHERE u.phone_number = $1`,
      [phone],
    );
    const row = rows[0];
    if (!row) {
      console.log('account=not_found');
      return;
    }

    let codeStatus = 'not_issued';
    if (row.created_at) {
      if (row.deleted_at) codeStatus = 'invalidated_by_new_code';
      else if (row.used_at) codeStatus = 'used';
      else if (new Date(row.expires_at).getTime() <= Date.now()) codeStatus = 'expired';
      else if (row.failed_attempts >= 5) codeStatus = 'attempts_exhausted';
      else codeStatus = 'valid';
    }
    console.log(`account=found role=${row.user_type} active=${row.is_active} blocked=${row.is_blocked} pin_set=${row.pin_set}`);
    console.log(`latest_reset_code=${codeStatus} failed_attempts=${row.failed_attempts ?? 0}`);
    if (row.created_at) {
      console.log(`issued_at=${new Date(row.created_at).toISOString()}`);
      console.log(`expires_at=${new Date(row.expires_at).toISOString()}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`pin-reset-diagnostic-failed: ${error.message}`);
  process.exitCode = 1;
});
