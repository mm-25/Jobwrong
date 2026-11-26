import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const host = 'com.jobright_local.obsidian';
const firefoxId = 'jobright-local@personal.extension';
const targets = {
  brave: ['BraveSoftware', 'Brave-Browser'],
  chromium: ['Chromium'],
  chrome: ['Google', 'Chrome'],
  firefox: ['Mozilla'],
  zen: ['zen'],
};
const defaults = ['brave', 'chromium', 'firefox', 'zen'];

function json(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function shell(value) {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

async function currentFile(filename) {
  let metadata;
  try {
    metadata = await lstat(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!metadata.isFile() || metadata.size > 16 * 1024) throw new Error('Refusing to replace existing registration at ' + filename);
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.ino !== metadata.ino || stat.dev !== metadata.dev || stat.size > 16 * 1024) {
      throw new Error('Refusing to replace existing registration at ' + filename);
    }
    const data = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(data, 0, data.length, 0);
    if (bytesRead !== stat.size) throw new Error('Existing registration changed at ' + filename);
    return digest(data.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}

async function ensureDirectory(root, components, message) {
  let directory = root;
  for (const component of components) {
    directory = path.join(directory, component);
    await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory) {
      throw new Error(message + directory);
    }
  }
  return directory;
}

export async function prepareNative({ project, home, vaultRoot, chromiumId, browsers = defaults, install = false }) {
  if (!browsers.length || browsers.some((browser) => !Object.hasOwn(targets, browser))) {
    throw new Error('Use --browser brave, chromium, chrome, firefox or zen.');
  }
  const selected = [...new Set(browsers)];
  if (selected.includes('zen') && !selected.includes('firefox')) selected.push('firefox');
  const usesChromium = selected.some((browser) => ['brave', 'chromium', 'chrome'].includes(browser));
  if ((usesChromium || chromiumId !== undefined) && !/^[a-p]{32}$/.test(chromiumId || '')) {
    throw new Error('Supply the installed extension ID using --chromium-id.');
  }
  if (!vaultRoot || !path.isAbsolute(vaultRoot) || !(await lstat(vaultRoot).catch(() => undefined))?.isDirectory()) {
    throw new Error('Supply an existing absolute vault folder using --vault-root.');
  }

  const resolvedProject = await realpath(project);
  const setup = path.join(resolvedProject, '.setup');
  const work = await ensureDirectory(resolvedProject, ['.setup', 'obsidian-native'], 'Refusing a linked project setup directory at ');
  const lockPath = path.join(work, 'install.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
    if (error.code === 'EEXIST') throw new Error('Another native setup is in progress.');
    throw error;
  });

  let staging;
  try {
    staging = await mkdtemp(path.join(work, 'staging-'));
    const launcher = path.join(work, 'launch');
    const node = await realpath(process.execPath);
    const module = path.join(resolvedProject, 'native', 'host.mjs');
    if (!(await lstat(module)).isFile()) throw new Error('The native host module is missing.');
    const config = path.join(setup, 'obsidian-native.json');
    const receiptFile = path.join(work, 'registrations.json');
    const content = '#!/bin/sh\nunset NODE_OPTIONS NODE_PATH\nexec ' + shell(node) + ' ' + shell(module) + '\n';

    const resolvedHome = install ? await realpath(home) : home;
    const registrations = selected.map((browser) => {
      const allowed = ['firefox', 'zen'].includes(browser)
        ? { allowed_extensions: [firefoxId] }
        : { allowed_origins: ['chrome-extension://' + chromiumId + '/'] };
      const manifest = json({ name: host, description: 'JobRight Local read-only vault search', path: launcher, type: 'stdio', ...allowed });
      return {
        browser,
        source: path.join(work, browser, host + '.json'),
        destination: path.join(resolvedHome, 'Library', 'Application Support', ...targets[browser], 'NativeMessagingHosts', host + '.json'),
        manifest,
      };
    });

    const receipt = install ? JSON.parse(await readFile(receiptFile, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    })) : {};
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
      throw new Error('The native registration receipt is invalid.');
    }
    const pending = [];
    if (install) {
      for (const registration of registrations) {
        const { browser, destination, manifest } = registration;
        const components = ['Library', 'Application Support', ...targets[browser], 'NativeMessagingHosts'];
        await ensureDirectory(resolvedHome, components, 'Refusing to install through a linked browser directory at ');
        const previous = await currentFile(destination);
        const next = digest(manifest);
        if (previous && previous !== next && receipt[destination] !== previous) {
          throw new Error('Refusing to replace existing registration at ' + destination);
        }
        pending.push({ ...registration, previous, next });
      }
    }

    async function replaceLocal(name, filename, data, mode = 0o600) {
      const temporary = path.join(staging, name);
      await writeFile(temporary, data, { mode, flag: 'wx' });
      await rename(temporary, filename);
    }

    await replaceLocal('launch', launcher, content, 0o700);
    await replaceLocal('config', config, json({ vaultRoot: await realpath(vaultRoot) }));
    for (const { browser, source, manifest } of registrations) {
      await ensureDirectory(work, [browser], 'Refusing a linked native manifest directory at ');
      await replaceLocal(browser, source, manifest);
    }

    for (const { browser, destination, manifest, previous, next } of pending) {
      if (previous !== next) {
        const temporary = path.join(staging, browser + '.install.json');
        await writeFile(temporary, manifest, { mode: 0o600, flag: 'wx' });
        if (previous) {
          if (await currentFile(destination) !== previous) throw new Error('Existing registration changed at ' + destination);
          await rename(temporary, destination);
        } else {
          await link(temporary, destination);
        }
      }
      receipt[destination] = next;
      await replaceLocal(browser + '.receipt', receiptFile, json(receipt));
    }
    return registrations.map(({ browser, source, destination }) => ({ browser, source, destination }));
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

const usage = 'node scripts/install-native.mjs --vault-root <absolute folder> [--chromium-id <installed extension ID>] [--browser brave|chromium|chrome|firefox|zen ...] [--install]\n'
  + 'Without --install, prepares an executable launcher, configuration and manifests under .setup only.';

async function main(args) {
  if (args.includes('--help')) {
    console.log(usage);
    return;
  }
  const options = { project: fileURLToPath(new URL('..', import.meta.url)), home: homedir(), browsers: [] };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--install') {
      options.install = true;
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(usage);
    if (flag === '--vault-root') options.vaultRoot = value;
    else if (flag === '--chromium-id') options.chromiumId = value;
    else if (flag === '--browser') options.browsers.push(value);
    else throw new Error(usage);
  }
  if (!options.browsers.length) options.browsers = undefined;
  if (options.install && process.platform !== 'darwin') throw new Error('Native registration is supported on macOS.');
  const registrations = await prepareNative(options);
  for (const { browser, source, destination } of registrations) {
    console.log(browser + ' ' + (options.install ? destination : source));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
