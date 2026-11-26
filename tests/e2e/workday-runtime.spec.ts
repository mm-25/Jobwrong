import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Profile } from '../../src/shared/types';
import { formUrls, profile, resumeText } from './fixtures';

const candidate: Profile = {
  ...profile,
  education: [],
  answers: [],
  employment: [profile.employment[0], { ...profile.employment[1], endDate: '2024-01' }, {
    company: 'Harbor Design', title: 'Design Researcher', location: 'Ann Arbor',
    startDate: '2017-09', endDate: '2019-12', current: false, description: '',
  }],
};

async function runAutofill(page: Page) {
  expect(await page.evaluate(data => window.__jobrightPage!.start(data), candidate)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__jobrightPage!.status()), { timeout: 12_000 })
    .toMatchObject({ started: true, running: false, failed: 0 });
}

function date(row: Locator, direction: 'startDate' | 'endDate', part: 'Month' | 'Year') {
  return row.locator(`[data-automation-id="formField-${direction}"]`).getByRole('spinbutton', { name: part, exact: true });
}

async function expectMonth(row: Locator, direction: 'startDate' | 'endDate', native: string, rendered: string) {
  const input = date(row, direction, 'Month');
  await expect(input).toHaveValue(native);
  await expect(input).toHaveAttribute('aria-valuetext', native);
  await expect(input).toHaveAttribute('aria-valuenow', native);
  await expect(row.locator(`[data-automation-id="formField-${direction}"] [data-automation-id="dateSectionMonth-display"]`))
    .toHaveText(rendered);
}

test('one Workday Autofill run adds the missing jobs, commits dates, and uploads the resume once', async ({ page, browserName }) => {
  const html = await readFile(resolve('fixtures/workday-runtime.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === formUrls.workday
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.goto(formUrls.workday);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });

  const application = page.locator('[data-automation-id="applyFlowMyExpPage"]');
  await application.getByRole('button', { name: 'Add', exact: true }).click();
  const first = application.getByRole('group', { name: 'Work Experience 1', exact: true });
  const second = application.getByRole('group', { name: 'Work Experience 2', exact: true });
  const third = application.getByRole('group', { name: 'Work Experience 3', exact: true });
  await first.getByLabel('Company', { exact: true }).fill('Cedar Studio');
  await first.getByLabel('Location', { exact: true }).fill('Applicant-entered location');
  await expect(application).toHaveAttribute('data-commit-remounts', '2');

  const preview = await page.evaluate(data => window.__jobrightLocal!.scan(data), candidate);
  expect(preview.platform).toBe('Workday');
  expect(preview.fields).toContainEqual(expect.objectContaining({ label: 'Resume/CV', kind: 'file', status: 'ready' }));
  await expect(application).toHaveAttribute('data-add-clicks', '1');
  await expect(application).toHaveAttribute('data-upload-changes', '0');
  await expect(second).toHaveCount(0);

  await runAutofill(page);
  await expect(application.locator('#experience-rows > [role="group"]')).toHaveCount(3);
  await expect(application).toHaveAttribute('data-add-clicks', '3');
  await expect(application).toHaveAttribute('data-adds-before-upload', '0');
  await expect(application).toHaveAttribute('data-parser-remounts', '1');
  await expect(application).toHaveAttribute('data-commit-remounts', '19');
  await expect(first.getByLabel('Company', { exact: true })).toHaveValue('Cedar Studio');
  await expect(first.getByLabel('Job Title', { exact: true })).toHaveAttribute('data-committed-value', 'Product Designer');
  await expect(first.getByLabel('Location', { exact: true })).toHaveValue('Applicant-entered location');
  await expectMonth(first, 'startDate', '4', '04');
  await expect(date(first, 'startDate', 'Year')).toHaveValue('2020');
  await expectMonth(first, 'endDate', '5', '05');
  await expect(date(first, 'endDate', 'Year')).toHaveValue('2023');

  await expect(second.getByLabel('Company', { exact: true })).toHaveAttribute('data-committed-value', 'Maple Co.');
  await expect(second.getByLabel('Job Title', { exact: true })).toHaveValue('Senior Designer');
  await expect(second.getByLabel('Location', { exact: true })).toHaveValue('Chicago');
  await expectMonth(second, 'startDate', '6', '06');
  await expect(date(second, 'startDate', 'Year')).toHaveValue('2023');
  await expect(second.getByRole('checkbox', { name: 'I currently work here' })).toBeChecked();
  const formerEndDate = second.locator('[data-automation-id="formField-endDate"]');
  await expect(formerEndDate).toBeHidden();
  await expect(formerEndDate.locator('input[aria-label="Year"]')).toHaveValue('');

  await expect(third.getByLabel('Company', { exact: true })).toHaveValue('Harbor Design');
  await expect(third.getByLabel('Job Title', { exact: true })).toHaveValue('Design Researcher');
  await expect(third.getByLabel('Location', { exact: true })).toHaveValue('Ann Arbor');
  await expectMonth(third, 'startDate', '9', '09');
  await expect(date(third, 'startDate', 'Year')).toHaveValue('2017');
  await expectMonth(third, 'endDate', '12', '12');
  await expect(date(third, 'endDate', 'Year')).toHaveValue('2019');

  const resume = application.getByRole('group', { name: 'Resume/CV', exact: true });
  await expect(resume.getByText(candidate.resume!.name, { exact: true })).toBeVisible();
  await expect(resume.getByRole('button', { name: 'Delete attachment' })).toBeEnabled();
  await expect(resume.locator('[data-automation-id="attachments-FileUpload"]'))
    .toHaveAttribute('data-received-bytes', [...Buffer.from(resumeText)].join(','));

  await runAutofill(page);
  await expect(application.locator('#experience-rows > [role="group"]')).toHaveCount(3);
  await expect(application).toHaveAttribute('data-add-clicks', '3');
  await expect(application).toHaveAttribute('data-upload-changes', '1');
  await expect(application).toHaveAttribute('data-next-clicks', '0');
  await expect(page.locator('form')).toHaveAttribute('data-submit-events', '0');
  await expect(page).toHaveURL(formUrls.workday);
});


async function segmentedWorkdayRow(page: Page, browserName: string): Promise<Locator> {
  const url = formUrls.workday + '?keyboardDates=1';
  const html = await readFile(resolve('fixtures/workday-runtime.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.goto(url);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });

  const application = page.locator('[data-automation-id="applyFlowMyExpPage"]');
  await application.getByRole('button', { name: 'Add', exact: true }).click();
  const row = application.getByRole('group', { name: 'Work Experience 1', exact: true });
  await row.getByLabel('Company', { exact: true }).fill(candidate.employment[0].company);
  await expect(application).toHaveAttribute('data-commit-remounts', '1');
  return row;
}

test('Workday commits both date segments together and undoes them', async ({ page, browserName }) => {
  const row = await segmentedWorkdayRow(page, browserName);
  const data = { ...candidate, employment: [{ ...candidate.employment[0], startDate: '2021-10', endDate: '2024-01' }] };
  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), data);
  const dateFields = plan.fields.filter(field => /^(?:From|To) (?:Month|Year)$/.test(field.label));
  expect(dateFields.map(field => field.status)).toEqual(['ready', 'ready', 'ready', 'ready']);
  const result = await page.evaluate(({ scanId, ids }) => window.__jobrightLocal!.fill(scanId, ids), {
    scanId: plan.scanId, ids: dateFields.map(field => field.id),
  });
  expect(result, JSON.stringify(result.entries)).toMatchObject({ filled: 4, failed: 0, undoAvailable: true });
  await expectMonth(row, 'startDate', '10', '10');
  await expect(date(row, 'startDate', 'Year')).toHaveValue('2021');
  await expectMonth(row, 'endDate', '1', '01');
  await expect(date(row, 'endDate', 'Year')).toHaveValue('2024');
  const dateGroups = row.locator('[data-automation-id="dateInputWrapper"]');
  await expect(dateGroups.nth(0)).toHaveAttribute('data-committed-date', '10/2021');
  await expect(dateGroups.nth(1)).toHaveAttribute('data-committed-date', '1/2024');
  expect(await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), plan.scanId)).toEqual({ restored: 4, skipped: 0 });
  for (const direction of ['startDate', 'endDate'] as const) {
    await expect(date(row, direction, 'Month')).toBeEmpty();
    await expect(date(row, direction, 'Year')).toBeEmpty();
  }
});

test('Workday recommits a required date without editing its retained year', async ({ page, browserName }) => {
  const row = await segmentedWorkdayRow(page, browserName);
  const company = row.getByLabel('Company', { exact: true });
  const from = row.locator('[data-automation-id="formField-startDate"]');
  await from.locator('[data-automation-id="dateSectionMonth-display"]').click();
  await page.keyboard.type('92021');
  await company.click();
  const dateGroup = from.locator('[data-automation-id="dateInputWrapper"]');
  await expect(dateGroup).toHaveAttribute('data-committed-date', '9/2021');
  await dateGroup.evaluate(group => {
    group.removeAttribute('data-committed-date');
    group.nextElementSibling!.insertAdjacentHTML('afterend',
      `<div data-automation-id="inputAlert" id="error1-${group.id}">Error: The field From is required and must have a value.</div>`);
    const year = group.querySelector('input[aria-label="Year"]')!;
    year.addEventListener('input', () => year.setAttribute('data-unexpected-edit', 'true'));
  });

  const data = { ...candidate, employment: [{ ...candidate.employment[0], startDate: '2021-09' }] };
  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), data);
  const repair = plan.fields.find(field => field.label === 'From Month')!;
  expect(repair.status).toBe('ready');
  const result = await page.evaluate(({ scanId, id }) => window.__jobrightLocal!.fill(scanId, [id]), { scanId: plan.scanId, id: repair.id });
  expect(result, JSON.stringify(result.entries)).toMatchObject({ filled: 1, failed: 0, undoAvailable: false });
  await expect(dateGroup).toHaveAttribute('data-committed-date', '9/2021');
  await expect(from.locator('[data-automation-id="inputAlert"]')).toHaveCount(0);
  const year = date(row, 'startDate', 'Year');
  await expect(year).toHaveValue('2021');
  await expect(year).not.toHaveAttribute('data-unexpected-edit', 'true');
});

test('Workday rolls back its draft month if the year section does not activate', async ({ page, browserName }) => {
  const row = await segmentedWorkdayRow(page, browserName);
  const month = date(row, 'startDate', 'Month');
  const year = date(row, 'startDate', 'Year');
  await year.evaluate(input => {
    input.parentElement!.addEventListener('click', event => event.stopImmediatePropagation(), { capture: true });
  });
  await month.evaluate(input => {
    if (!(input instanceof HTMLInputElement)) return;
    input.addEventListener('input', () => {
      const history = input.getAttribute('data-edit-history');
      input.setAttribute('data-edit-history', history === null ? input.value : history + '/' + input.value);
    });
  });

  const data = { ...candidate, employment: [{ ...candidate.employment[0], startDate: '2021-01' }] };
  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), data);
  const dateFields = plan.fields.filter(field => /^From (?:Month|Year)$/.test(field.label));
  const result = await page.evaluate(({ scanId, ids }) => window.__jobrightLocal!.fill(scanId, ids), {
    scanId: plan.scanId, ids: dateFields.map(field => field.id),
  });
  expect(result, JSON.stringify(result.entries)).toMatchObject({ filled: 0, failed: 2, undoAvailable: false });
  await expect(month).toHaveAttribute('data-edit-history', '1/');
  await expect(month).toBeEmpty();
  await expect(year).toBeEmpty();
});
