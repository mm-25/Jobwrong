import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareNative } from '../../scripts/install-native.mjs';

const temporary = fileURLToPath(new URL('../../.setup/tmp/', import.meta.url));
const host = 'com.jobright_local.obsidian';
const chromiumId = 'abcdefghijklmnopabcdefghijklmnop';

async function fixture(t) {
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(path.join(temporary, 'installer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "Project with spaces and apostrophe's");
  const home = path.join(root, 'Home');
  const vaultRoot = path.join(root, 'Synthetic vault');
  await mkdir(path.join(project, 'native'), { recursive: true });
  await mkdir(home);
  await mkdir(vaultRoot);
  await writeFile(path.join(project, 'native', 'host.mjs'), 'process.stdout.write("launcher ran");');
  return { project, home, vaultRoot, chromiumId, browsers: ['brave', 'chromium', 'firefox', 'zen'] };
}

test('dry preparation writes allowlisted manifests and an executable launcher inside the project', async (t) => {
  const options = await fixture(t);
  const registrations = await prepareNative(options);
  assert.equal(registrations.length, 4);
  for (const { source, destination, browser } of registrations) {
    assert.equal(path.basename(destination), host + '.json');
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
    const manifest = JSON.parse(await readFile(source, 'utf8'));
    assert.equal(manifest.name, host);
    assert.equal(manifest.type, 'stdio');
    assert.ok(manifest.path.startsWith(options.project + path.sep));
    assert.equal((await lstat(manifest.path)).mode & 0o111, 0o100);
    if (['brave', 'chromium'].includes(browser)) {
      assert.deepEqual(manifest.allowed_origins, ['chrome-extension://' + chromiumId + '/']);
      assert.equal(manifest.allowed_extensions, undefined);
    } else {
      assert.deepEqual(manifest.allowed_extensions, ['jobright-local@personal.extension']);
      assert.equal(manifest.allowed_origins, undefined);
    }
    const result = spawnSync(manifest.path);
    assert.equal(result.status, 0, result.stderr?.toString());
    assert.equal(result.stdout.toString(), 'launcher ran');
  }
});

test('explicit installation is idempotent and updates owned files only', async (t) => {
  const options = { ...await fixture(t), install: true };
  const installed = await prepareNative(options);
  const brave = installed.find(({ browser }) => browser === 'brave');
  const chromium = installed.find(({ browser }) => browser === 'chromium');
  const first = await lstat(brave.destination);
  await prepareNative(options);
  assert.equal((await lstat(brave.destination)).ino, first.ino);

  const updatedId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await prepareNative({ ...options, chromiumId: updatedId });
  const updated = JSON.parse(await readFile(brave.destination, 'utf8'));
  assert.deepEqual(updated.allowed_origins, ['chrome-extension://' + updatedId + '/']);

  const unrelated = '{"name":"someone.else"}';
  await writeFile(chromium.destination, unrelated);
  await assert.rejects(prepareNative(options), /existing registration/);
  assert.equal(await readFile(chromium.destination, 'utf8'), unrelated);
  assert.deepEqual(JSON.parse(await readFile(brave.destination, 'utf8')), updated);
});

test('rejects absent, malformed or guessed Chromium IDs and supports Firefox-only setup', async (t) => {
  const options = await fixture(t);
  await assert.rejects(prepareNative({ ...options, chromiumId: undefined }), /--chromium-id/);
  await assert.rejects(prepareNative({ ...options, chromiumId: 'z'.repeat(32) }), /--chromium-id/);
  const [registration] = await prepareNative({ ...options, browsers: ['firefox'], chromiumId: undefined });
  assert.match(registration.destination, /Mozilla\/NativeMessagingHosts/);
});

test('refuses a linked browser directory before creating a manifest subdirectory through it', async (t) => {
  const options = await fixture(t);
  const external = path.join(options.project, 'outside registrations');
  await mkdir(external);
  const support = path.join(options.home, 'Library', 'Application Support');
  await mkdir(support, { recursive: true });
  await symlink(external, path.join(support, 'BraveSoftware'));
  await assert.rejects(prepareNative({ ...options, install: true, browsers: ['brave'] }), /linked browser directory/);
  await assert.rejects(lstat(path.join(external, 'Brave-Browser')), { code: 'ENOENT' });
});
