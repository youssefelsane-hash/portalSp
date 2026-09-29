import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// محاكاة معزولة: لا sudo ولا systemd ولا اتصال بقاعدة أو سيرفر حقيقي.
const source = readFileSync(new URL('./deploy-osta-release.sh', import.meta.url), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'osta-deploy-test-'));
const before = '1'.repeat(40);
const target = '2'.repeat(40);
const paths = ['node_modules', 'apps/api/node_modules', 'apps/admin/node_modules', 'apps/customer-web/node_modules', 'packages/shared-types/dist', 'apps/api/dist', 'apps/admin/.next', 'apps/customer-web/.next'];
function file(path, contents, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode });
}
try {
  for (const scenario of ['success', 'build-failure', 'health-failure']) {
    const dir = join(scratch, scenario);
    const root = join(dir, 'srv/app');
    const fixture = join(dir, 'fixture');
    const bin = join(dir, 'bin');
    const log = join(dir, 'events');
    file(log, '');
    file(join(dir, 'head'), before);
    file(join(dir, 'api.env'), 'DATABASE_URL=mock-only\n');
    for (const path of paths) file(join(root, path, 'marker'), 'old');
    for (const app of ['api', 'admin', 'customer-web']) {
      file(join(fixture, 'apps', app, '.keep'), '');
      file(join(root, 'apps', app, '.env.production.local'), 'MOCK_SETTING=preserved\n');
    }
    file(join(fixture, 'packages/shared-types/.keep'), '');
    file(join(fixture, 'scripts/backup-db.sh'), 'mkdir -p "$1"\nprintf backup >> "$DEPLOY_TEST_LOG"\n');
    file(join(fixture, 'scripts/check-migrations.js'), '');
    file(join(fixture, 'infra/migrations/migrate.js'), 'require("fs").appendFileSync(process.env.DEPLOY_TEST_LOG, "migrate\\n");');
    const dispatcher = `#!/usr/bin/env node
const fs = require('node:fs'), p = require('node:path'), cp = require('node:child_process');
const name = p.basename(process.argv[1]), args = process.argv.slice(2), root = process.env.DEPLOY_TEST_ROOT;
const log = (s) => fs.appendFileSync(process.env.DEPLOY_TEST_LOG, s + '\\n');
const make = (x, s) => { fs.mkdirSync(p.dirname(x), {recursive:true}); fs.writeFileSync(x,s); };
if (name === 'runuser') { const r = cp.spawnSync(args[3], args.slice(4), {stdio:'inherit',env:process.env}); process.exit(r.status ?? 1); }
if (name === 'git') {
 const a = args.slice(2);
 if (a[0] === 'rev-parse') process.stdout.write(fs.readFileSync(process.env.DEPLOY_TEST_HEAD));
 if (a[0] === 'archive') cp.execFileSync('/usr/bin/tar',['-cf','-','-C',process.env.DEPLOY_TEST_FIXTURE,'.'],{stdio:['ignore','inherit','inherit']});
 if (a[0] === 'merge') { log('merge'); fs.writeFileSync(process.env.DEPLOY_TEST_HEAD,a[2]); }
} else if (name === 'systemctl') {
 if (args[0] === 'show') {
   const key = args[args.indexOf('-p')+1];
   console.log(key === 'LoadState' ? 'loaded' : key === 'User' ? 'osta' : key === 'WorkingDirectory' ? root : '');
 } else log(args.join(' '));
} else if (name === 'npm') {
 log('npm ' + args.join(' '));
 if (process.env.DEPLOY_TEST_SCENARIO === 'build-failure' && args.includes('--workspace=@baytak/admin')) process.exit(1);
 for (const x of ${JSON.stringify(paths)}) make(p.join(process.cwd(),x,'marker'),'new');
 make(p.join(process.cwd(),'apps/api/dist/main.js'),'new');
 make(p.join(process.cwd(),'apps/admin/.next/BUILD_ID'),'new');
 make(p.join(process.cwd(),'apps/customer-web/.next/BUILD_ID'),'new');
} else if (name === 'curl') {
 if (process.env.DEPLOY_TEST_SCENARIO === 'health-failure') process.exit(22);
 console.log(JSON.stringify({data:{status:'ok',database:'up'}}));
} else if (name === 'df') console.log('test 99999999 1 99999998');
else if (name === 'install') fs.mkdirSync(args[args.length-1],{recursive:true});
`;
    for (const command of ['runuser', 'git', 'systemctl', 'npm', 'curl', 'df', 'install', 'chown', 'flock', 'sleep', 'pg_dump', 'pg_restore', 'sha256sum']) {
      file(join(bin, command), dispatcher, 0o700);
    }
    const isolated = source
      .replace('[[ "$EUID" == 0 ]]', '[[ "isolated-test" == "isolated-test" ]]')
      .replaceAll('/srv/osta', join(dir, 'srv'))
      .replaceAll('/etc/osta/api.env', join(dir, 'api.env'))
      .replace('/run/lock/osta-release.lock', join(dir, 'deploy.lock'));
    assert.ok(!isolated.includes('/srv/osta') && !isolated.includes('/etc/osta'));
    const script = join(dir, 'deploy.sh');
    file(script, isolated);
    const result = spawnSync('/bin/bash', [script, target], {
      encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOY_TEST_ROOT: root, DEPLOY_TEST_HEAD: join(dir, 'head'), DEPLOY_TEST_FIXTURE: fixture, DEPLOY_TEST_LOG: log, DEPLOY_TEST_SCENARIO: scenario },
    });
    assert.equal(result.status, scenario === 'success' ? 0 : 1, `${scenario}: ${result.stdout}\n${result.stderr}`);
    const events = readFileSync(log, 'utf8');
    const stopped = events.indexOf('stop osta-api.service');
    if (scenario === 'build-failure') {
      assert.equal(stopped, -1);
      assert.equal(readFileSync(join(dir, 'head'), 'utf8'), before);
    } else {
      assert.ok(stopped > events.indexOf('npm run build --workspace=customer-web -- --webpack'));
      assert.ok(stopped > events.indexOf('migrate'));
      assert.equal(readFileSync(join(dir, 'head'), 'utf8'), target);
    }
    for (const path of paths) assert.equal(readFileSync(join(root, path, 'marker'), 'utf8'), scenario === 'success' ? 'new' : 'old');
    assert.equal(readFileSync(join(root, 'apps/admin/.env.production.local'), 'utf8'), 'MOCK_SETTING=preserved\n');
    if (scenario === 'health-failure') assert.match(result.stderr, /Previous build\/dependencies restored/);
    console.log(`PASS deployment ${scenario}: staging order, artifacts, env preservation and recovery`);
  }
  execFileSync('/bin/bash', ['-n', fileURLToPath(new URL('./deploy-osta-release.sh', import.meta.url))]);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
