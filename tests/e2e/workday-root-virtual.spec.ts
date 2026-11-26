import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import { formUrls } from './fixtures';

const profile = emptyProfile();
profile.education = [{
  school: 'Example Art University', fieldOfStudy: 'Visual Communication', degree: '', startDate: '', endDate: '', gpa: '',
}];

const scenarios = [
  { mode: 'sibling-degree', title: 'retains the education record when a sibling Degree catalog closes on focus', reason: undefined, reachesEnd: true },
  { mode: 'progressive', title: 'verifies progressively measured options despite backward overscan movement', reason: undefined, reachesEnd: true },
  { mode: 'measured', title: 'selects after the 333-row list remeasures its scroll extent', reason: undefined, reachesEnd: true },
  { mode: 'unique', title: 'selects the unique offscreen Field of Study and undoes the selection', reason: undefined, reachesEnd: true },
  { mode: 'alternative', title: 'prefers saved offscreen Product Design over the visible Other fallback', reason: undefined, reachesEnd: true },
  { mode: 'duplicate', title: 'abstains when another matching option is offscreen', reason: /no unique option/i, reachesEnd: true },
  { mode: 'gap', title: 'abstains after reaching the end without seeing every position', reason: /not every option/i, reachesEnd: true },
  { mode: 'reused-id', title: 'rejects a stable-looking ID reused at a different position', reason: /changed or became ambiguous/i, reachesEnd: false },
  { mode: 'count', title: 'rejects conflicting total counts during scrolling', reason: /changed or became ambiguous/i, reachesEnd: false },
  { mode: 'low-count', title: 'rejects an apparently complete first window with an understated count', reason: /changed or became ambiguous/i, reachesEnd: false },
  { mode: 'cancel', title: 'cancels when the applicant edits the search while the menu scrolls', reason: /field changed/i, reachesEnd: false },
  { mode: 'category', title: 'does not treat an unverified category as the root menu', reason: /subset/i, reachesEnd: false },
  { mode: 'filtered', title: 'leaves a preexisting filtered search alone', reason: /clear the Workday search/i, reachesEnd: false },
] as const;

for (const { mode, title, reason, reachesEnd } of scenarios) {
  test(`Workday root virtual menu ${title}`, async ({ page, browserName }) => {
    const url = formUrls.workday + '?fieldOfStudy=' + mode;
    const html = await readFile(resolve('fixtures/workday-virtual.html'), 'utf8');
    await page.route('**/*', route => route.request().url() === url
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      : route.abort());
    await page.goto(url);
    await page.addScriptTag({ path: resolve(process.env.JOBRIGHT_E2E_DIST ?? 'dist', browserName, 'content.js') });

    const hasAlternatives = mode === 'alternative' || mode === 'progressive';
    const candidate = hasAlternatives ? {
      ...profile,
      education: [{
        ...profile.education[0], fieldOfStudy: 'My unavailable discipline', fieldOfStudyAlternatives: ['Product Design', 'Other'],
      }],
    } : mode === 'sibling-degree' ? { ...profile, education: [{ ...profile.education[0], degree: 'Master of Science' }] } : profile;
    const plan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), candidate);
    const field = plan.fields.find(field => field.label === 'Field of Study')!;
    expect(field).toMatchObject({ kind: 'combobox', status: 'ready' });
    const chooser = page.getByLabel('Field of Study', { exact: true });
    const selected = page.locator('[data-automation-id="selectedItem"]');
    const stored = page.locator('input[name="source"]');
    const body = page.locator('body');
    await expect(page.locator('[data-automation-id="activeListContainer"]')).toHaveCount(mode === 'filtered' ? 1 : 0);
    const result = await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), plan.scanId);

    if (mode !== 'filtered') {
      await expect(body).toHaveAttribute('data-mounted-options', '15');
      await expect(body).toHaveAttribute('data-viewport-height', '440');
      await expect(body).toHaveAttribute('data-scroll-height', '10020');
    }
    if (mode === 'measured') await expect(body).toHaveAttribute('data-measured-scroll-height', '10052');
    if (mode === 'category' || mode === 'filtered') await expect(body).toHaveAttribute('data-scroll-events', '0');
    else expect(Number(await body.getAttribute('data-scroll-events'))).toBeGreaterThan(0);

    if (reason) {
      expect(result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
      expect(result.entries).toContainEqual(expect.objectContaining({ id: field.id, status: 'failed', reason: expect.stringMatching(reason) }));
      await expect(body).toHaveAttribute('data-selection-clicks', '0');
    } else {
      const chosen = hasAlternatives ? 'Product Design' : 'Visual Communication';
      expect(result).toMatchObject({ filled: 1, failed: 0, undoAvailable: true, entries: expect.arrayContaining([expect.objectContaining({ id: field.id, status: 'filled' })]) });
      await expect(body).toHaveAttribute('data-selection-clicks', '1');
      await expect(selected).toHaveText(chosen);
      await expect(stored).toHaveValue(chosen);
      expect(await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), plan.scanId)).toEqual({ restored: 1, skipped: 0 });
    }

    if (reachesEnd) await expect(body).toHaveAttribute('data-last-rendered-position', '333');
    if (mode === 'progressive') {
      await expect(body).toHaveAttribute('data-overscan-retraction', /^10\d{3}$/);
      await expect(body).toHaveAttribute('data-progressive-ends', '2');
      await expect(body).toHaveAttribute('data-final-scroll-height', '10656');
    }
    await expect(chooser).toHaveValue(mode === 'cancel' || mode === 'filtered' ? 'My manual search' : '');
    await expect(selected).toHaveCount(0);
    await expect(stored).toBeEmpty();
    await expect(body).toHaveAttribute('data-submit-clicks', '0');
    await expect(body).toHaveAttribute('data-submits', '0');
    await expect(page).toHaveURL(url);
  });
}
