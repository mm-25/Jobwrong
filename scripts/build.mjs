import { build } from 'esbuild';
import { mkdir, rm, cp, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const targets = process.argv.slice(2);
if (targets.some(browser => !['chromium', 'firefox'].includes(browser))) throw new Error('Expected chromium or firefox build target.');
for (const browser of targets.length ? [...new Set(targets)] : ['chromium', 'firefox']) {
  const outdir = path.join(root, 'dist', browser);
  await rm(outdir, { recursive:true, force:true }); await mkdir(outdir, { recursive:true });
  await cp(path.join(root, 'public'), outdir, { recursive:true });
  await build({ entryPoints: { content:path.join(root,'src/content.ts'), background:path.join(root,'src/background.ts'), popup:path.join(root,'src/ui/popup.ts'), options:path.join(root,'src/ui/options.ts') }, outdir, bundle:true, format:'iife', target: browser === 'firefox' ? 'firefox140' : 'chrome120', sourcemap:false, minify:false, legalComments:'none', charset:'utf8' });
  const manifest = {
    manifest_version:3, name:'JobRight Local', version:pkg.version,
    description:'Fill job applications from saved facts, with optional AI matching and Claude answers from your Obsidian notes.',
    permissions:['activeTab','scripting','storage'], host_permissions:['http://*/*','https://*/*'], optional_host_permissions:['https://api.openai.com/*','https://api.anthropic.com/*'],
    optional_permissions:['nativeMessaging'],
    background: browser === 'firefox' ? {scripts:['background.js']} : {service_worker:'background.js'},
    content_scripts:[{matches:['http://*/*','https://*/*'],js:['content.js'],all_frames:true,run_at:'document_idle'}],
    action:{ default_popup:'popup.html', default_title:'JobRight Local' },
    options_ui:{ page:'options.html', open_in_tab:true },
    content_security_policy:{ extension_pages:"script-src 'self'; object-src 'none'" },
    ...(browser === 'firefox' ? {browser_specific_settings:{gecko:{id:'jobright-local@personal.extension',strict_min_version:'140.0',data_collection_permissions:{required:['none'],optional:['personallyIdentifyingInfo','websiteContent','authenticationInfo']}}}} : {minimum_chrome_version:'120'}),
  };
  await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  console.log(`Built ${browser}: ${outdir}`);
}
