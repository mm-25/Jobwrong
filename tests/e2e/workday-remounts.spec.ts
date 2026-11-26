import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import { formUrls } from './fixtures';

const profile = emptyProfile();
Object.assign(profile.personal, { firstName: 'Robin', lastName: 'Example', city: 'Ann Arbor', phone: '3135550100', linkedin: 'https://linkedin.com/in/robin-example' });
profile.education = [{ school: 'Example University', degree: 'Master of Science', fieldOfStudy: '', startDate: '', endDate: '', gpa: '' }];

function field(id: string, name: string, label: string) {
  return `<div data-automation-id="formField-${name}"><label for="${id}">${label}</label><input id="${id}" name="${name}"></div>`;
}

const steps = {
  information: `<div data-automation-id="applyFlowMyInfoPage">
    <div role="group" aria-labelledby="Legal-Name-section"><h4 id="Legal-Name-section">Legal Name</h4>
      ${field('name--legalName--firstName', 'legalName--firstName', 'First Name')}
      ${field('name--legalName--lastName', 'legalName--lastName', 'Last Name')}
    </div>
    <div role="group" aria-labelledby="Address-section"><h4 id="Address-section">Address</h4>${field('address--city', 'city', 'City')}</div>
    <div role="group" aria-labelledby="Phone-section"><h4 id="Phone-section">Phone</h4>${field('phoneNumber--phoneNumber', 'phoneNumber', 'Phone Number')}</div>
  </div>`,
  experience: `<div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Education-section"><h4 id="Education-section">Education</h4>
      <div role="group" aria-labelledby="Education-1-panel"><h5 id="Education-1-panel">Education 1</h5>
        ${field('education-5--schoolName', 'schoolName', 'School or University')}
        <label>Degree <select><option></option><option>Master of Science</option></select></label>
      </div>
    </div>
    <div role="group" aria-labelledby="Social-Network-URLs-section"><h4 id="Social-Network-URLs-section">Social Network URLs</h4>
      ${field('socialNetworkAccounts--linkedInAccount', 'linkedInAccount', 'LinkedIn')}
    </div>
  </div>`,
};

for (const step of ['information', 'experience'] as const) {
  test(`Workday ${step} verifies asynchronously remounted controls and keeps Undo`, async ({ page, browserName }) => {
    const html = `<html><body><main data-automation-id="applyFlowPage"><form data-submits="0" data-remounts="0">
      ${steps[step]}<button type="submit">Submit application</button></form></main>
      <script>
        const form = document.querySelector('form');
        form.addEventListener('submit', event => { event.preventDefault(); form.dataset.submits++; });
        form.addEventListener('input', event => {
          const input = event.target;
          if (input.tagName !== 'INPUT') return;
          const value = input.value;
          requestAnimationFrame(() => {
            if (!input.isConnected) return;
            const replacement = input.cloneNode();
            replacement.value = value;
            input.replaceWith(replacement);
            form.dataset.remounts++;
          });
        });
      </script></body></html>`;
    await page.route('**/*', route => route.request().url() === formUrls.workday
      ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    await page.goto(formUrls.workday);
    await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });
    const scan = await page.evaluate(data => window.__jobrightLocal!.scan(data), profile);
    const result = await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), scan.scanId);
    expect(result).toMatchObject({ filled: step === 'information' ? 4 : 3, failed: 0, undoAvailable: true });
    const values = step === 'information' ? ['Robin', 'Example', 'Ann Arbor', '3135550100'] : ['Example University', 'https://linkedin.com/in/robin-example'];
    expect(await page.locator('form input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(values);
    if (step === 'experience') await expect(page.getByLabel('Degree')).toHaveValue('Master of Science');
    await expect(page.locator('form')).toHaveAttribute('data-remounts', step === 'information' ? '4' : '2');
    expect(await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), scan.scanId))
      .toEqual({ restored: step === 'information' ? 4 : 3, skipped: 0 });
    expect(await page.locator('form input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(values.map(() => ''));
    await expect(page.locator('form')).toHaveAttribute('data-submits', '0');
  });
}
