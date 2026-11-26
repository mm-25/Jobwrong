import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import { formUrls } from './fixtures';

for (const primaryAvailable of [true, false]) {
  test(`Workday lazy Degree catalog uses ${primaryAvailable ? 'the primary B.Tech award' : 'an explicitly configured alternative'}`, async ({ page, browserName }) => {
    const url = formUrls.workday + '?degree-preference=' + primaryAvailable;
    const html = (await readFile(resolve('fixtures/workday-school.html'), 'utf8'))
      .replace('aria-label="Degree Master of Science Required"', 'aria-label="Degree Select One Required"')
      .replace('name="degree" value="MS">Master of Science', 'name="degree" value="">Select One');
    await page.route('**/*', route => route.request().url() === url
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
    await page.goto(url);
    await page.evaluate(available => {
      const button = document.getElementById('education-5--degree') as HTMLButtonElement;
      button.addEventListener('click', () => {
        const menu = document.createElement('ul');
        menu.id = 'degree-options';
        menu.setAttribute('role', 'listbox');
        button.setAttribute('aria-controls', menu.id);
        button.setAttribute('aria-expanded', 'true');
        const labels = ['Bachelor of Science', 'Bachelor of Engineering', ...(available ? ['B.Tech.'] : [])];
        for (const label of labels) {
          const option = document.createElement('li');
          option.setAttribute('role', 'option');
          option.textContent = label;
          option.addEventListener('click', () => {
            button.value = label;
            button.textContent = label;
            button.setAttribute('aria-label', `Degree ${label} Required`);
            button.removeAttribute('aria-expanded');
            button.removeAttribute('aria-controls');
            menu.remove();
          });
          menu.append(option);
        }
        document.body.append(menu);
      });
    }, primaryAvailable);
    await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });
    const candidate = { ...emptyProfile(), education: [{ school: 'Example Institute', degree: 'Bachelor of Technology',
      degreeAlternatives: ['Bachelor of Engineering', 'Bachelor of Science'], fieldOfStudy: '', startDate: '', endDate: '', gpa: '' }] };
    const plan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), candidate);
    const degree = plan.fields.find(field => field.label === 'Degree')!;
    expect(degree.status).toBe('ready');
    const result = await page.evaluate(({ scanId, id }) => window.__jobrightLocal!.fill(scanId, [id]), { scanId: plan.scanId, id: degree.id });
    expect(result).toMatchObject({ filled: 1, failed: 0 });
    await expect(page.locator('#education-5--degree')).toHaveText(primaryAvailable ? 'B.Tech.' : 'Bachelor of Engineering');
    await expect(page.locator('body')).toHaveAttribute('data-submits', '0');
    await expect(page).toHaveURL(url);
  });
}
