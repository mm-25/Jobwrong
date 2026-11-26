import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import { formUrls } from './fixtures';

const profile = emptyProfile();
const education = { fieldOfStudy: '', startDate: '', endDate: '', gpa: '' };
profile.education = [
  { ...education, school: 'Sample Institute of Technology', degree: 'Bachelor of Engineering' },
  { ...education, school: 'University of Michigan', campus: 'Ann Arbor', degree: "Master's Degree" },
];

for (const manual of [false, true]) {
  test(`Workday school search ${manual ? 'preserves an applicant edit during lookup' : 'commits only a verified campus and undoes the pill'}`, async ({ page, browserName }) => {
    const url = formUrls.workday + '?school' + (manual ? '&manual' : '');
    const html = await readFile(resolve('fixtures/workday-school.html'), 'utf8');
    await page.route('**/*', route => route.request().url() === url
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      : route.abort());
    await page.goto(url);
    await page.addScriptTag({ path: resolve(process.env.JOBRIGHT_E2E_DIST ?? 'dist', browserName, 'content.js') });

    const plan = await page.evaluate(candidate => window.__jobrightLocal!.scan(candidate), profile);
    const school = plan.fields.find(field => field.label === 'School or University')!;
    expect(school).toMatchObject({ kind: 'combobox', status: 'ready', value: 'University of Michigan - Ann Arbor' });
    expect(plan.fields.find(field => field.label === 'Degree')).toMatchObject({ status: 'preserved' });

    const body = page.locator('body');
    const input = page.locator('#education-5--school');
    const pill = page.locator('[data-automation-id="selectedItem"]');
    await expect(body).toHaveAttribute('data-search', '0');
    await expect(page.locator('[data-automation-id="activeListContainer"]')).toHaveCount(0);
    const result = await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), plan.scanId);
    await expect(body).toHaveAttribute('data-search', '1');
    await expect(body).toHaveAttribute('data-query', 'Ann Arbor');
    await expect(body).toHaveAttribute('data-submits', '0');
    await expect(page.locator('#education-5--degree')).toHaveText('Master of Science');

    if (manual) {
      expect(result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
      await expect(body).toHaveAttribute('data-commits', '0');
      await expect(input).toHaveValue('Applicant typed this');
    } else {
      expect(result).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
      await expect(body).toHaveAttribute('data-commits', '1');
      await expect(input).toBeEmpty();
      await expect(pill).toHaveText('University of Michigan - Ann Arbor');
      expect(await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), plan.scanId)).toEqual({ restored: 1, skipped: 0 });
      await expect(input).toBeEmpty();
    }
    await expect(pill).toHaveCount(0);
    await expect(page.locator('#education-5--degree')).toHaveText('Master of Science');
    await expect(page).toHaveURL(url);
  });
}
