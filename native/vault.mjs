import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('../.setup/obsidian-native.json', import.meta.url));
const fileLimit = 256 * 1024;
const totalLimit = 8 * 1024 * 1024;
const entryLimit = 12_000;
const noteLimit = 2_000;
const pathLimit = 240;
const headingLimit = 160;
const snippetLimit = 800;
const decoder = new TextDecoder('utf-8', { fatal: true });
const stopWords = new Set(
  'a an and are as at be been but by can could describe did do does for from had has have how i if in into is it its like me more my of on or our please some than that the their them then there these they this through to us use was we were what when where which who why will with would you your about experience example tell share provide give specific approach role answer'.split(' '),
);
const privateName = /^(?:\.|(?:trash|recycle bin)(?:\.md)?$|(?:credentials?|secrets?|passwords?|api[ _-]?keys?)\b)/i;
const credentialAssignment = /(?:^|[\s"'|?&({,])(?:[\w-]*[_-])?(?:api[ _-]?key|secret(?:[ _-]?key)?|(?:access[ _-]?)?token|password|passwd|passphrase|authorization|connection[ _-]?string)["']?\s*(?:=|:)/i;
const credentialValue = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b|\bBearer\s+[A-Za-z0-9_.-]{8,}|:\/\/[^\s/:@]+:[^\s/@]+@)/i;
const privateSection = /^(?:credentials?|secrets?|passwords?|api[ _-]?keys?|(?:access[ _-]?)?tokens?)\b/i;

function secret(text) {
  return credentialAssignment.test(text) || credentialAssignment.test(text.replace(/[\x60*]/g, '')) || credentialValue.test(text);
}

export function fail(error) {
  return { v: 1, ok: false, error };
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validRequest(request) {
  if (!request || request.v !== 1) return false;
  if (request.op === 'ping') return exactKeys(request, ['v', 'op']);
  if (request.op !== 'search' || !exactKeys(request, ['v', 'op', 'questions'])
    || !Array.isArray(request.questions) || request.questions.length < 1 || request.questions.length > 8) return false;
  const ids = new Set();
  for (const question of request.questions) {
    if (!exactKeys(question, ['id', 'query'])
      || typeof question.id !== 'string' || !/^[a-z0-9_.:-]{1,128}$/i.test(question.id) || ids.has(question.id)
      || typeof question.query !== 'string' || !question.query.trim() || question.query.length > 700) return false;
    ids.add(question.id);
  }
  return true;
}

function sameEntry(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

async function readBounded(filename, limit, expected) {
  let file;
  try {
    const before = await lstat(filename);
    if (!before.isFile() || before.size > limit || (expected && !sameEntry(expected, before))) return;
    file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await file.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !sameEntry(before, opened) || opened.size > limit || await realpath(filename) !== filename) return;
    const data = Buffer.alloc(opened.size + 1);
    let read = 0;
    while (read < data.length) {
      const { bytesRead } = await file.read(data, read, data.length - read, read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const after = await file.stat();
    if (read !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) return;
    if (data.subarray(0, read).includes(0)) return;
    return { content: decoder.decode(data.subarray(0, read)), bytes: read };
  } catch {
    return;
  } finally {
    await file?.close();
  }
}

async function getRoot(config) {
  const data = await readBounded(config, 4096);
  if (!data) return;
  const parsed = JSON.parse(data.content);
  if (!exactKeys(parsed, ['vaultRoot']) || typeof parsed.vaultRoot !== 'string' || !path.isAbsolute(parsed.vaultRoot)) return;
  const configured = path.resolve(parsed.vaultRoot);
  if (configured === path.parse(configured).root || !(await lstat(configured)).isDirectory()) return;
  return { directory: await realpath(configured), rootLabel: path.basename(configured).slice(0, headingLimit) };
}

function safeName(name) {
  return !privateName.test(name) && !secret(name) && !/[\x00-\x1f\x7f]/.test(name);
}

async function listNotes(root) {
  const pending = [{ full: root, relative: '', depth: 0 }];
  const notes = [];
  let count = 0;
  while (pending.length && count < entryLimit) {
    const { full, relative, depth } = pending.pop();
    if (await realpath(full).catch(() => '') !== full) continue;
    const directory = await opendir(full).catch(() => undefined);
    if (!directory) continue;
    const entries = [];
    try {
      for await (const entry of directory) {
        count++;
        if (count >= entryLimit) break;
        if (!safeName(entry.name) || !(entry.isDirectory() || entry.isFile())) continue;
        entries.push(entry);
      }
    } catch {
      continue;
    }
    entries.sort((a, b) => compare(a.name, b.name));
    for (const entry of entries) {
      const next = { full: path.join(full, entry.name), relative: [relative, entry.name].filter(Boolean).join('/'), depth: depth + 1 };
      if (next.relative.length > pathLimit) continue;
      if (entry.isDirectory() && next.depth <= 24) pending.push(next);
      if (entry.isFile() && /\.md$/i.test(entry.name)) notes.push(next);
    }
  }
  return notes.sort((a, b) => compare(a.relative, b.relative)).slice(0, noteLimit);
}

function compare(a, b) {
  return a < b ? -1 : Number(a > b);
}

function words(text) {
  const tokens = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  return new Set(tokens.filter((word) => !stopWords.has(word)).map((word) => (
    word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word
  )));
}

function fenceMarker(line) {
  const match = /^((?:[ \t]*(?:>|(?:[-+*]|[0-9]{1,9}[.)])(?=[ \t])))*)([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return;
  const [, containers, indent, marker, rest] = match;
  const quoteDepth = (containers.match(/>/g) || []).length;
  const listPrefix = containers.slice(containers.lastIndexOf('>') + 1);
  return {
    quoteDepth,
    hasListMarker: /[-+*0-9]/.test(containers),
    indentation: indent.replaceAll('\t', '    ').length,
    maxClosingIndent: (listPrefix ? listPrefix.length + 1 : 0) + (quoteDepth ? 4 : 3),
    marker,
    rest,
  };
}

function paragraphs(content) {
  const lines = content.split(/\r?\n/);
  const result = [];
  const headings = [];
  let paragraph = [];
  let start = 0;
  let fence;
  let frontMatter = lines[0].trim() === '---';
  let commentEnd;

  function flush() {
    if (!paragraph.length) return;
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    const section = headings.at(-1);
    if (text && !secret(text) && !headings.some(({ hidden }) => hidden)) {
      result.push({
        startsSection: Boolean(section && !section.hasLead),
        hit: {
          text: text.slice(0, snippetLimit),
          heading: (section?.label || '').slice(0, headingLimit),
          lineStart: start,
          lineEnd: start + paragraph.length - 1,
        },
      });
    }
    if (section) section.hasLead = true;
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontMatter) {
      if (i && /^(?:---|\.\.\.)\s*$/.test(line)) frontMatter = false;
      continue;
    }
    const marker = fenceMarker(line);
    if (fence) {
      if (marker && marker.quoteDepth === fence.quoteDepth && !marker.hasListMarker
        && marker.indentation <= fence.maxClosingIndent && marker.marker[0] === fence.marker[0]
        && marker.marker.length >= fence.marker.length && !marker.rest.trim()) fence = undefined;
      continue;
    }
    if (marker) {
      flush();
      fence = marker;
      continue;
    }
    if (commentEnd) {
      if (line.includes(commentEnd)) commentEnd = undefined;
      continue;
    }
    const comment = /<!--|%%/.exec(line);
    if (comment) {
      flush();
      const end = comment[0] === '%%' ? '%%' : '-->';
      if (!line.includes(end, comment.index + comment[0].length)) commentEnd = end;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      while (headings.at(-1)?.level >= level) headings.pop();
      const label = heading[2];
      headings.push({ level, label, hidden: secret(label) || privateSection.test(label) });
      continue;
    }
    if (!line.trim() || /^\s*(?:>\s*)*(?: {4}|\t)\S/.test(line)) {
      flush();
      continue;
    }
    if (!paragraph.length) start = i + 1;
    paragraph.push(line.trim());
  }
  flush();
  return result;
}

function scoreSnippet(terms, body, heading, filename, startsSection) {
  let paragraphMatches = 0;
  let headingMatches = 0;
  let filenameMatches = 0;
  for (const term of terms) {
    if (body.has(term)) paragraphMatches++;
    if (heading.has(term)) headingMatches++;
    if (filename.has(term)) filenameMatches++;
  }
  if (paragraphMatches) return paragraphMatches * 8 + headingMatches * 2 + filenameMatches;
  return startsSection && headingMatches >= Math.min(2, terms.size) ? headingMatches : 0;
}

function hash(...parts) {
  const digest = createHash('sha256');
  for (const part of parts) digest.update(part).update('\0');
  return digest.digest('hex').slice(0, 32);
}

async function search(root, questions) {
  const matches = questions.map(({ id, query }) => ({ id, terms: words(query), ranked: [] }));
  const revision = createHash('sha256');
  let remaining = totalLimit;
  let files = 0;
  for (const { full, relative } of await listNotes(root)) {
    if (remaining <= 0) break;
    const stat = await lstat(full).catch(() => undefined);
    if (!stat?.isFile() || stat.size > remaining) continue;
    const note = await readBounded(full, Math.min(fileLimit, remaining), stat);
    if (!note) continue;
    remaining -= note.bytes;
    files++;
    revision.update(hash(relative, note.content));
    const filename = words(path.basename(relative, path.extname(relative)));
    for (const { hit: snippet, startsSection } of paragraphs(note.content)) {
      const body = words(snippet.text);
      const heading = words(snippet.heading);
      for (const { id, terms, ranked } of matches) {
        const score = scoreSnippet(terms, body, heading, filename, startsSection);
        if (score <= 0 || (ranked.length === 3 && ranked.at(-1).score >= score)) continue;
        const hit = { ...snippet, path: relative, questionId: id, id: hash(id, relative, String(snippet.lineStart), snippet.heading, snippet.text) };
        ranked.push({ score, hit });
        ranked.sort((a, b) => b.score - a.score || compare(a.hit.path, b.hit.path) || a.hit.lineStart - b.hit.lineStart);
        if (ranked.length > 3) ranked.pop();
      }
    }
  }
  return { files, revision: revision.digest('hex').slice(0, 32), hits: matches.flatMap(({ ranked }) => ranked.map(({ hit }) => hit)) };
}

export async function handleRequest(request, config = configPath) {
  if (!validRequest(request)) return fail('invalid_request');
  const root = await getRoot(config).catch(() => undefined);
  if (!root) return fail('vault_unavailable');
  const { directory, rootLabel } = root;
  if (request.op === 'ping') return { v: 1, ok: true, rootLabel };
  try {
    return { v: 1, ok: true, rootLabel, ...await search(directory, request.questions) };
  } catch {
    return fail('vault_unavailable');
  }
}
