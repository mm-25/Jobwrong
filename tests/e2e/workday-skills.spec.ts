import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import { formUrls } from './fixtures';

const candidate = { ...emptyProfile(), skills: ['Design Research', 'User Experience'] };

for (const scenario of ['unique', 'duplicate'] as const) {
  test(`Workday Skills verifies the full virtual catalog before using a ${scenario} result`, async ({ page, browserName }) => {
    const url = formUrls.workday + '?skills=' + scenario;
    const html = await readFile(resolve('fixtures/workday-skills.html'), 'utf8');
    await page.route('**/*', route => route.request().url() === url
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      : route.abort());
    await page.goto(url);
    await page.addScriptTag({ path: resolve(process.env.JOBRIGHT_E2E_DIST ?? 'dist', browserName, 'content.js') });

    const input = page.getByLabel('Type to Add Skills', { exact: true });
    const pills = page.locator('[data-automation-id="selectedItem"]');
    const body = page.locator('body');
    const plan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), candidate);
    expect(plan.fields).toContainEqual(expect.objectContaining({ label: 'Type to Add Skills', kind: 'combobox', status: 'ready' }));
    await expect(body).toHaveAttribute('data-searches', '0');

    const result = await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), plan.scanId);
    await expect(body).toHaveAttribute('data-last-position', '26');
    await expect(body).toHaveAttribute('data-searches', '1');
    if (scenario === 'unique') {
      expect(result).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
      await expect(pills).toHaveText(['Design Research', 'User Experience (UX)']);
      await expect(body).toHaveAttribute('data-selections', '1');
      expect(await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), plan.scanId)).toEqual({ restored: 1, skipped: 0 });
    } else {
      expect(result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
      await expect(body).toHaveAttribute('data-selections', '0');
    }
    await expect(pills).toHaveText(['Design Research']);
    await expect(input).toBeEmpty();
    await expect(page.locator('[data-automation-id=activeListContainer]')).toHaveCount(0);
    await expect(body).toHaveAttribute('data-submits', '0');
  });
}
