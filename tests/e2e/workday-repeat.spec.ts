import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import { formUrls } from './fixtures';

const profile = emptyProfile();
profile.personal.website = 'https://portfolio.example.test';
profile.personal.github = 'https://github.com/example-applicant';
profile.education = [
  { school: 'Example College', degree: 'Bachelor of Science', fieldOfStudy: '', startDate: '', endDate: '', gpa: '' },
  { school: 'Example University', degree: 'Master of Science', fieldOfStudy: '', startDate: '', endDate: '', gpa: '' },
];

function education(index: number, master = false) {
  const id = `education-${229 + index * 13}`;
  return `<div role="group" aria-labelledby="Education-${index}-panel">
    <h5 id="Education-${index}-panel">Education ${index}</h5>
    <div data-automation-id="formField-schoolName">
      <label for="${id}--schoolName">School or University</label>
      <input id="${id}--schoolName" name="schoolName">
    </div>
    <label for="${id}--degree">Degree</label>
    <select id="${id}--degree"><option></option><option>Bachelor of Science</option>
      <option ${master ? 'selected' : ''}>Master of Science</option></select>
  </div>`;
}

function website(index: number) {
  const id = `webAddress-${569 + index * 17}`;
  return `<div role="group" aria-labelledby="Websites-${index}-panel">
    <h5 id="Websites-${index}-panel">Websites ${index}</h5>
    <div data-fkit-id="${id}--null">
      <div data-automation-id="formField-url" data-fkit-id="${id}--url">
        <label for="${id}--url">URL*</label>
        <input type="text" id="${id}--url" name="url" aria-required="true">
      </div>
    </div>
  </div>`;
}

test('Workday fills and undoes added education and Website rows while preserving the selected degree', async ({ page, browserName }) => {
  const html = `<!doctype html><html><body><main data-automation-id="applyFlowPage">
    <div data-automation-id="applyFlowMyExpPage" data-advance-clicks="0" data-url-remounts="0">
      <div role="group" aria-labelledby="Education-section">
        <h4 id="Education-section">Education</h4>
        <div id="degrees">${education(1, true)}</div>
        <button data-automation-id="add-button">Add Another</button>
      </div>
      <div role="group" aria-labelledby="Websites-section">
        <h4 id="Websites-section">Websites</h4>
        <div id="urls"></div>
        <button data-automation-id="add-button">Add</button>
      </div>
      <button id="advance">Save and Continue</button>
    </div></main>
    <script>
      const application = document.querySelector('[data-automation-id="applyFlowMyExpPage"]');
      const degrees = document.getElementById('degrees');
      const urls = document.getElementById('urls');
      const websiteRows = ${JSON.stringify([website(1), website(2)])};
      degrees.nextElementSibling.addEventListener('click', () => {
        setTimeout(() => degrees.insertAdjacentHTML('beforeend', ${JSON.stringify(education(2))}), 40);
      });
      urls.nextElementSibling.addEventListener('click', () => {
        const row = websiteRows[urls.children.length];
        if (!row) return;
        setTimeout(() => {
          urls.insertAdjacentHTML('beforeend', row);
          urls.nextElementSibling.textContent = 'Add Another';
        }, 40);
      });
      urls.addEventListener('input', event => {
        const input = event.target;
        const value = input.value;
        requestAnimationFrame(() => {
          if (!input.isConnected) return;
          const replacement = input.cloneNode();
          replacement.value = value;
          input.replaceWith(replacement);
          application.dataset.urlRemounts++;
        });
      });
      document.getElementById('advance').addEventListener('click', () => application.dataset.advanceClicks++);
    </script></body></html>`;
  await page.route('**/*', route => route.request().url() === formUrls.workday
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
  await page.goto(formUrls.workday);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });

  await page.evaluate(data => window.__jobrightLocal!.scan(data), profile);
  const educationRows = page.locator('#degrees > [role="group"]');
  const websites = page.locator('#urls input');
  await expect(educationRows).toHaveCount(1);
  await expect(websites).toHaveCount(0);

  async function autofill() {
    expect(await page.evaluate(data => window.__jobrightPage!.start(data), profile)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__jobrightPage!.status()), { timeout: 12_000 })
      .toMatchObject({ started: true, running: false, failed: 0 });
  }
  await autofill();
  await expect(educationRows).toHaveCount(2);
  await expect(educationRows.nth(0).getByLabel('School or University')).toHaveValue('Example University');
  await expect(educationRows.nth(0).getByLabel('Degree')).toHaveValue('Master of Science');
  await expect(educationRows.nth(1).getByLabel('School or University')).toHaveValue('Example College');
  await expect(educationRows.nth(1).getByLabel('Degree')).toHaveValue('Bachelor of Science');
  await expect(websites).toHaveCount(2);
  await expect(websites.nth(0)).toHaveValue('https://portfolio.example.test');
  await expect(websites.nth(1)).toHaveValue('https://github.com/example-applicant');
  const application = page.locator('[data-automation-id="applyFlowMyExpPage"]');
  await expect(application).toHaveAttribute('data-url-remounts', '2');

  await autofill();
  await expect(educationRows).toHaveCount(2);
  await expect(websites).toHaveCount(2);
  await page.evaluate(() => window.__jobrightPage!.undo());
  await expect(educationRows.nth(0).getByLabel('School or University')).toHaveValue('');
  await expect(educationRows.nth(0).getByLabel('Degree')).toHaveValue('Master of Science');
  await expect(websites.nth(0)).toHaveValue('');
  await expect(websites.nth(1)).toHaveValue('');
  await expect(application).toHaveAttribute('data-advance-clicks', '0');
  await expect(page).toHaveURL(formUrls.workday);
});
