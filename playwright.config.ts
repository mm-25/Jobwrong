import { defineConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const tempDirectory = resolve('.cache/tmp');
mkdirSync(tempDirectory, { recursive: true });
process.env.TMPDIR = tempDirectory;
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.cache/ms-playwright');
const domSpecs = [
  '**/forms.spec.ts', '**/live-form.spec.ts', '**/coverage.spec.ts', '**/semantic-defaults.spec.ts',
  '**/followup.spec.ts', '**/hybrid.spec.ts', '**/widget-lifecycle.spec.ts', '**/pressed-choices.spec.ts',
  '**/field-navigation.spec.ts', '**/greenhouse-live.spec.ts', '**/ashby-location.spec.ts', '**/common-fields.spec.ts',
  '**/vault.spec.ts', '**/workday-runtime.spec.ts', '**/workday-remounts.spec.ts', '**/workday-virtual.spec.ts',
  '**/workday-root-virtual.spec.ts', '**/workday-repeat.spec.ts', '**/workday-school.spec.ts', '**/workday-skills.spec.ts',
];

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  workers: 1,
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-dom', testMatch: domSpecs, use: { browserName: 'chromium', channel: 'chromium' } },
    { name: 'firefox-dom', testMatch: domSpecs, use: { browserName: 'firefox' } },
    { name: 'chromium-extension', testMatch: ['**/extension.spec.ts', '**/navigation-start.spec.ts', '**/vault-extension.spec.ts'], use: { browserName: 'chromium', channel: 'chromium' } },
  ],
});
