import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import { formUrls } from './fixtures';

const profile = emptyProfile();
profile.applicationDefaults = { referralSource: 'linkedin' };

for (const { name, search, duplicate, measurement, delayedTail, replay, replayFailure, replacedRoot } of [
  { name: 'selects and undoes a unique offscreen LinkedIn option', search: '', duplicate: false },
  { name: 'leaves two offscreen LinkedIn options unselected', search: '?duplicate=yes', duplicate: true },
  { name: 'selects and undoes LinkedIn after its grid measures more rows', search: '?measurement=variable', measurement: 'variable' },
  { name: 'leaves duplicate LinkedIn options unselected after row measurement', search: '?measurement=variable&duplicate=yes', measurement: 'variable', duplicate: true },
  { name: 'does not select a visible LinkedIn when the understated grid tail renders late', search: '?tail=delayed', delayedTail: true },
  { name: 'selects and undoes LinkedIn after all five categories remount the owned portal', search: '?replay=remount', replay: true },
  { name: 'selects and undoes LinkedIn through two owned category remounts', search: '?replay=nested', replay: true },
  { name: 'rejects a changed offscreen option after the owned branch reopens', search: '?replay=changed', replay: true, replayFailure: 'The Workday menu options changed.' },
  { name: 'rejects an unsolicited portal remount during the reopened branch census', search: '?replay=mid-census', replay: true, replayFailure: 'The Workday menu changed while reading its options.' },
  { name: 'rejects an unsolicited root replacement before replay', search: '?replay=root-replaced', replay: true, replayFailure: 'The associated menu changed.', replacedRoot: true },
  { name: 'rejects root menu moved to a new portal before replay', search: '?replay=root-moved', replay: true, replayFailure: 'The associated menu changed.', replacedRoot: true },
  { name: 'preserves an invalid count error even when the grid cannot be restored', search: '?measurement=invalid', measurement: 'invalid' },
]) {
  test('Workday ' + name, async ({ page, browserName }) => {
    const url = formUrls.workday + search;
    const html = await readFile(resolve('fixtures/workday-virtual.html'), 'utf8');
    await page.route('**/*', route => route.request().url() === url
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      : route.abort());
    await page.goto(url);
    await page.addScriptTag({ path: resolve(process.env.JOBRIGHT_E2E_DIST ?? 'dist', browserName, 'content.js') });

    const plan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), profile);
    expect(plan.fields).toEqual([expect.objectContaining({ label: 'Where did you hear about us?', kind: 'combobox', status: 'ready' })]);
    await expect(page.locator('[data-automation-id="responsiveMonikerPrompt"]')).toHaveCount(0);

    const result = await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), plan.scanId);
    const body = page.locator('body');
    const selected = page.locator('[data-automation-id="selectedItem"]');
    const stored = page.locator('input[name="source"]');
    await expect(body).toHaveAttribute('data-mounted-options', delayedTail ? '4' : replay ? '13' : '11');
    await expect(body).toHaveAttribute('data-viewport-height', delayedTail ? '96' : replay ? '368' : measurement ? '268' : '320');
    await expect(body).toHaveAttribute('data-scroll-height', delayedTail ? '120' : replay ? '1346' : measurement ? '1342' : '1408');
    if (measurement) await expect(body).toHaveAttribute('data-measured-scroll-height', '1366');
    if (replay) {
      await expect(body).toHaveAttribute('data-measured-scroll-height', '1388');
      if (!replacedRoot) {
        await expect(body).toHaveAttribute('data-entered-branches', 'Alcon|Conference/Career Fair|Job Board|Other|Social Media|Job Board');
      }
    }
    expect(Number(await body.getAttribute('data-scroll-events'))).toBeGreaterThan(0);

    if (duplicate || delayedTail || measurement === 'invalid' || replayFailure) {
      expect(result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
      if (delayedTail || measurement === 'invalid' || replayFailure) {
        expect(result.entries).toEqual([
          expect.objectContaining({ status: 'failed', reason: replayFailure ?? 'The Workday virtual options changed or became ambiguous.' }),
        ]);
      }
      await expect(body).toHaveAttribute('data-job-board-visits', replayFailure && !replacedRoot ? '2' : '1');
      await expect(body).toHaveAttribute('data-selection-clicks', '0');
      await expect(selected).toHaveCount(0);
      await expect(stored).toBeEmpty();
    } else {
      expect(result).toMatchObject({ filled: 1, failed: 0, undoAvailable: true, entries: [expect.objectContaining({ status: 'filled' })] });
      await expect(body).toHaveAttribute('data-job-board-visits', '2');
      if (measurement) await expect(body).toHaveAttribute('data-reopened-mounted-options', '20');
      await expect(body).toHaveAttribute('data-selection-clicks', '1');
      await expect(selected).toHaveText('LinkedIn');
      await expect(stored).toHaveValue('linkedin');
      expect(await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), plan.scanId))
        .toEqual({ restored: 1, skipped: 0 });
      await expect(selected).toHaveCount(0);
      await expect(stored).toBeEmpty();
    }

    if (replay) {
      const replacedMidCensus = search.includes('mid-census');
      const nested = search.includes('nested');
      if (nested) await expect(body).toHaveAttribute('data-job-listings-entries', '2');
      await expect(body).toHaveAttribute('data-portal-mounts', nested ? '15' : replacedMidCensus ? '13' : '12');
      await expect(body).toHaveAttribute('data-job-board-ends', replacedMidCensus || replacedRoot ? '1' : '2');
    }
    if (measurement !== 'invalid') await expect(body).toHaveAttribute('data-last-rendered-position', delayedTail ? '5' : '44');
    if (measurement === 'variable') await expect(body).toHaveAttribute('data-settled-scroll-height', '1354');
    await expect(body).toHaveAttribute('data-submit-clicks', '0');
    await expect(body).toHaveAttribute('data-submits', '0');
    await expect(page).toHaveURL(url);
  });
}
