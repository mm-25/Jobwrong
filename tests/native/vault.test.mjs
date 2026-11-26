import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import test from 'node:test';
import { handleRequest } from '../../native/vault.mjs';

const workspace = new URL('../../.setup/tmp/', import.meta.url);
const request = (query) => ({ v: 1, op: 'search', questions: [{ id: 'q', query }] });

async function fixture(t) {
  await mkdir(workspace, { recursive: true });
  const folder = await mkdtemp(fileURLToPath(new URL('vault-test-', workspace)));
  t.after(() => rm(folder, { force: true, recursive: true }));
  const vault = path.join(folder, 'Notes');
  await mkdir(vault);
  const config = path.join(folder, 'config.json');
  await writeFile(config, JSON.stringify({ vaultRoot: vault }));
  return { vault, config, folder };
}

test('search ranks current paragraphs with headings and line numbers across edits, renames and deletes', async (t) => {
  const { vault, config } = await fixture(t);
  const note = path.join(vault, 'Product work.md');
  await writeFile(note, '# Accessibility audit\n\nI led a keyboard accessibility audit with five participants.\nWe fixed keyboard focus on onboarding.\n\nUnrelated weekend plans.\n');
  const result = await handleRequest(request('What was your approach to keyboard accessibility audits?'), config);
  assert.equal(result.ok, true);
  assert.equal(result.files, 1);
  assert.equal(result.hits.length, 1);
  assert.deepEqual({ ...result.hits[0], id: '<opaque>' }, {
    id: '<opaque>', questionId: 'q', path: 'Product work.md', heading: 'Accessibility audit',
    lineStart: 3, lineEnd: 4,
    text: 'I led a keyboard accessibility audit with five participants. We fixed keyboard focus on onboarding.',
  });
  await writeFile(note, '# Accessibility audit\n\nAccessibility findings included a contrast regression.\n');
  const edited = await handleRequest(request('accessibility'), config);
  assert.notEqual(edited.revision, result.revision);
  assert.notEqual(edited.hits[0].id, result.hits[0].id);
  assert.match(edited.hits[0].text, /contrast regression/);
  const moved = path.join(vault, 'Renamed.md');
  await rename(note, moved);
  assert.equal((await handleRequest(request('accessibility'), config)).hits[0].path, 'Renamed.md');
  await rm(moved);
  assert.deepEqual((await handleRequest(request('accessibility'), config)).hits, []);
});

test('excludes hidden, trash, linked, binary, oversized, fenced and credential-bearing text', async (t) => {
  const { vault, config, folder } = await fixture(t);
  const outside = path.join(folder, 'Outside.md');
  await writeFile(outside, 'needle outside');
  await symlink(outside, path.join(vault, 'Linked.md'));
  await symlink(folder, path.join(vault, 'Linked folder'));
  await link(outside, path.join(vault, 'Hard-linked.md'));
  await writeFile(path.join(vault, '.hidden.md'), 'needle hidden');
  await writeFile(path.join(vault, 'API keys.md'), 'needle credentials');
  await writeFile(path.join(vault, 'huge.md'), 'needle '.repeat(50_000));
  await writeFile(path.join(vault, 'binary.md'), Buffer.from([0, 255]));
  await mkdir(path.join(vault, 'Trash'));
  await writeFile(path.join(vault, 'Trash', 'Old.md'), 'needle trash');
  await writeFile(path.join(vault, 'Safe.md'), [
    '---', 'notes: needle metadata', '---', '# Experience', '', 'needle safe.', '',
    '~~~js', 'needle fenced', '~~~', '', 'credentials below', 'password: fake-token', 'needle secret', '',
    'Contact me about needle project.', '', '# prod_token = hidden-credential', '', 'needle hidden header',
    '', '# API keys', '', 'needle key notes',
  ].join('\n'));
  const result = await handleRequest(request('needle'), config);
  assert.deepEqual(result.hits.map(({ text }) => text), ['needle safe.', 'Contact me about needle project.']);
  assert.equal(result.files, 1);
});

test('rejects caller paths, invalid versions, duplicated keys and oversized questions before opening config', async () => {
  for (const invalid of [
    { ...request('query'), path: '../outside' },
    request('x'.repeat(701)),
    { ...request('query'), v: 2 },
    { v: 1, op: 'ping', questions: [] },
    { v: 1, op: 'search', questions: [{ id: 'x', query: 'a' }, { id: 'x', query: 'b' }] },
  ]) {
    assert.deepEqual(await handleRequest(invalid, '/missing'), { v: 1, ok: false, error: 'invalid_request' });
  }
});

function framed(payload) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

function runHost(input, host = fileURLToPath(new URL('../../native/host.mjs', import.meta.url))) {
  const run = spawnSync(process.execPath, [host], { input });
  assert.equal(run.status, 0, run.stderr.toString());
  assert.equal(run.stderr.length, 0);
  const replies = [];
  for (let offset = 0; offset < run.stdout.length;) {
    const size = run.stdout.readUInt32LE(offset);
    assert.ok(size > 0 && size <= 64 * 1024);
    replies.push(JSON.parse(run.stdout.subarray(offset + 4, offset + 4 + size)));
    offset += 4 + size;
  }
  return replies;
}

test('native host frames sanitized errors and rejects invalid UTF-8, truncated, empty and oversized frames', () => {
  const invalid = framed(Buffer.from('{"v":2,"op":"ping"}'));
  assert.deepEqual(runHost(Buffer.concat([invalid, invalid])).map(({ error }) => error), ['invalid_request', 'invalid_request']);
  assert.equal(runHost(framed(Buffer.from([0xff])))[0].error, 'invalid_json');
  assert.equal(runHost(Buffer.from([10, 0, 0, 0, 80]))[0].error, 'invalid_frame');
  assert.equal(runHost(Buffer.alloc(4))[0].error, 'invalid_frame');
  const oversized = Buffer.alloc(4);
  oversized.writeUInt32LE(32 * 1024 + 1);
  assert.equal(runHost(oversized)[0].error, 'invalid_frame');
});

test('ping returns the root label without appending private paths or any snippets', async (t) => {
  const { config } = await fixture(t);
  assert.deepEqual(await handleRequest({ v: 1, op: 'ping' }, config), { v: 1, ok: true, rootLabel: 'Notes' });
});

test('uses matching headings to retrieve the opening paragraph without including subsequent unrelated text', async (t) => {
  const { vault, config } = await fixture(t);
  await writeFile(path.join(vault, 'Project.md'), [
    '# Pricing research', '', 'We interviewed seven subscribers and presented the results.', '',
    'Pick up groceries.', '',
    '%%', 'Unpublished pricing research notes', '%%', '',
    '**Password**: fake-password', 'pricing research secret',
  ].join('\n'));
  const result = await handleRequest(request('Tell me about your pricing research'), config);
  assert.deepEqual(result.hits.map(({ text }) => text), ['We interviewed seven subscribers and presented the results.']);
});

test('serves valid framed requests using the host-relative configuration', async (t) => {
  const { vault, folder } = await fixture(t);
  await cp(new URL('../../native/', import.meta.url), path.join(folder, 'native'), { recursive: true });
  await mkdir(path.join(folder, '.setup'));
  await writeFile(path.join(folder, '.setup', 'obsidian-native.json'), JSON.stringify({ vaultRoot: vault }));
  await writeFile(path.join(vault, 'Project.md'), '# Évaluation\n\nI researched internationalization with seven participants.');
  const host = path.join(folder, 'native', 'host.mjs');
  const messages = [{ v: 1, op: 'ping' }, request('internationalization')];
  const [ping, search] = runHost(Buffer.concat(messages.map((message) => framed(Buffer.from(JSON.stringify(message))))), host);
  assert.equal(ping.rootLabel, 'Notes');
  assert.equal(search.hits[0].heading, 'Évaluation');
  assert.equal(search.hits[0].questionId, 'q');
});

test('caps cumulative note bytes and snippets per question', async (t) => {
  const { vault, config } = await fixture(t);
  const filler = ' '.repeat(254 * 1024);
  for (let index = 0; index < 36; index++) {
    const name = String(index).padStart(2, '0') + '.md';
    await writeFile(path.join(vault, name), 'needle: ' + 'é'.repeat(910) + filler);
  }
  const result = await handleRequest(request('needle'), config);
  assert.equal(result.files, 32);
  assert.deepEqual(result.hits.map(({ path }) => path), ['00.md', '01.md', '02.md']);
  assert.ok(result.hits.every(({ text }) => text.length === 800));
});

test('excludes fenced code in list items and nested block quotes while retaining following prose', async (t) => {
  const { vault, config } = await fixture(t);
  const lines = [
    '- ```text', '  Project illustration uses synthetic confidential material.', '  ```', '',
    '> 1. ~~~md', '>    Project quotation contains synthetic confidential material.', '>    ~~~', '',
    'Project public material.',
  ];
  await writeFile(path.join(vault, 'Project.md'), lines.join('\n'));
  const result = await handleRequest(request('project confidential'), config);
  assert.deepEqual(result.hits.map(({ text, lineStart }) => [text, lineStart]), [['Project public material.', 9]]);
});
