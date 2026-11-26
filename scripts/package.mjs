import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const targets = process.argv.slice(2);
if (targets.some(browser => !['chromium', 'firefox'].includes(browser))) throw new Error('Expected chromium or firefox package target.');
await mkdir(path.join(root,'artifacts'),{recursive:true});
for (const browser of targets.length ? [...new Set(targets)] : ['chromium','firefox']) {
  const archive = path.join(root,'artifacts',`jobright-local-${version}-${browser}.zip`);
  await rm(archive,{force:true});
  const result = spawnSync('zip',['-q','-r',archive,'.'],{cwd:path.join(root,'dist',browser),stdio:'inherit'});
  if (result.status !== 0) throw new Error(`Failed to package ${browser}`);
  console.log(archive);
}
