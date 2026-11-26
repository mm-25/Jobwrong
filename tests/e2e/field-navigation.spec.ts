import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { JobRequest, JobState } from '../../src/shared/jobs';
import { emptyProfile } from '../../src/shared/profile';

const applicationUrl = 'https://application.example.test/jobs/field-navigation';
const frameWarning = 'Some embedded frames could not be filled. Open the embedded application directly if fields are missing.';
const profile = emptyProfile();
profile.personal.firstName = 'Morgan';

const html = `<!doctype html><title>Field navigation fixture</title>
  <style>
    #scroller { height: 180px; width: 420px; overflow: auto; scroll-behavior: smooth; }
    .spacer { height: 520px; }
    .clipped { position: absolute; width: 1px; height: 1px; clip: rect(0, 0, 0, 0); }
  </style>
  <form id="application">
    <label>First name<input id="first-name" autocomplete="given-name"></label>
    <label>Location<input id="location-top"></label>
    <div id="scroller">
      <div class="spacer"></div>
      <label>Location<input id="location-bottom" style="outline: 1px dashed red;"></label>
      <div class="spacer"></div>
      <label for="resume">Resume/CV</label><input id="resume" type="file" class="clipped">
      <div class="spacer"></div>
    </div>
    <button type="submit">Submit application</button>
  </form>`;

interface FixtureOptions {
  delayStatus?: boolean;
  delayFocus?: boolean;
  embeddedField?: boolean;
  frameWarning?: boolean;
}

async function loadFixture(page: Page, browserName: string, options: FixtureOptions = {}) {
  await page.route('**/*', route => route.request().url() === applicationUrl
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.addInitScript(({ profile, options, frameWarning }) => {
    const requests: JobRequest[] = [];
    const changes: string[] = [];
    Reflect.set(window, 'fixtureRequests', requests);
    Reflect.set(window, 'fixtureChanges', changes);
    const initialStatus = new Promise<void>(resolve => Reflect.set(window, 'releaseFixtureStatus', resolve));
    const pendingFocus = new Promise<void>(resolve => Reflect.set(window, 'releaseFixtureFocus', resolve));
    for (const name of ['click', 'change', 'input', 'submit']) {
      document.addEventListener(name, event => {
        if (!event.composedPath().some(node => node instanceof HTMLElement && node.id === 'application')) return;
        changes.push(event.type);
        if (event.type === 'submit') event.preventDefault();
      });
    }
    Reflect.set(window, 'browser', {
      runtime: {
        id: 'synthetic-extension',
        async sendMessage(request: JobRequest) {
          requests.push(request);
          const controller = window.__jobrightPage!;
          if (request.command === 'status' && options.delayStatus) await initialStatus;
          if (request.command === 'start') controller.start(profile);
          const status = controller.status();
          const states: JobState[] = [{ ...status, frameId: 0 }];
          if (options.embeddedField && status.started && !status.running) {
            states.push({ ...status, filled: 0, undoAvailable: false, frameId: 4, documentId: 'fixture-embedded-document',
              url: new URL('/jobs/embedded', request.url).href,
              remaining: [{ id: 'fixture-embedded-field', label: 'Embedded screening question', required: true, status: 'unanswered' }] });
          }
          if (request.command === 'focus') {
            const focus = controller.focus!(request.focus!.fieldId);
            if (options.delayFocus) await pendingFocus;
            return { focus };
          }
          return { states, ...(options.frameWarning ? { warning: frameWarning } : {}) };
        },
      },
    });
  }, { profile, options, frameWarning });
  await page.goto(applicationUrl);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });
}

function fixtureRequests(page: Page): Promise<JobRequest[]> {
  return page.evaluate(() => Reflect.get(window, 'fixtureRequests'));
}

function openPanel(page: Page) {
  return page.getByRole('button', { name: 'Open JobRight Local' }).click();
}

async function revealRemainingFields(page: Page, browserName: string, options: FixtureOptions) {
  await loadFixture(page, browserName, options);
  const panel = page.getByRole('region', { name: 'JobRight Local autofill' });
  await openPanel(page);
  await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('1 filled');
  await panel.getByText('Fields that need attention', { exact: true }).click();
  return panel;
}

test.use({ reducedMotion: 'reduce' });

test('jump to the scanned duplicate centers the correct input, preserves edits, and clears its outline', async ({ page, browserName }) => {
  await loadFixture(page, browserName);
  const scan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), profile);
  const duplicates = scan.fields.filter(field => field.label === 'Location');
  expect(duplicates).toHaveLength(2);
  const target = page.locator('#location-bottom');
  await page.evaluate(() => { document.querySelector<HTMLInputElement>('#location-bottom')!.value = 'Applicant edit'; });
  expect(await page.evaluate(id => window.__jobrightLocal!.focus!(id), duplicates[1].id)).toEqual({ focused: true });
  await expect(target).toBeFocused();
  await expect(target).toHaveValue('Applicant edit');
  await expect(page.locator('#location-top')).toBeEmpty();
  expect(await target.evaluate(element => {
    const field = element.getBoundingClientRect();
    const scroller = document.querySelector('#scroller')!.getBoundingClientRect();
    return Math.abs(field.top + field.height / 2 - scroller.top - scroller.height / 2);
  })).toBeLessThan(3);
  expect(await target.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('3px');
  await expect.poll(() => target.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('1px');
  await expect(target).toHaveAttribute('style', 'outline: 1px dashed red;');
  expect(await page.evaluate(() => Reflect.get(window, 'fixtureChanges'))).toEqual([]);
});

test('jump to a clipped file input focuses its label without notifying the form or opening a chooser', async ({ page, browserName }) => {
  await loadFixture(page, browserName);
  const scan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), profile);
  const field = scan.fields.find(field => field.kind === 'file')!;
  let chooserOpened = false;
  page.on('filechooser', () => { chooserOpened = true; });

  expect(await page.evaluate(id => window.__jobrightLocal!.focus!(id), field.id)).toEqual({ focused: true });
  const label = page.locator('label[for=resume]');
  await expect(label).toBeFocused();
  await expect(label).toBeInViewport();
  await expect(page.locator('#resume')).toBeEmpty();
  expect(chooserOpened).toBe(false);
  expect(await page.evaluate(() => Reflect.get(window, 'fixtureChanges'))).toEqual([]);
  await page.locator('#first-name').focus();
  await expect(label).not.toHaveAttribute('tabindex');
});

test('a replaced control reports that the original field changed', async ({ page, browserName }) => {
  await loadFixture(page, browserName);
  const scan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), profile);
  const field = scan.fields.filter(field => field.label === 'Location')[1];
  await page.locator('#location-bottom').evaluate(element => element.replaceWith(element.cloneNode()));
  expect(await page.evaluate(id => window.__jobrightLocal!.focus!(id), field.id))
    .toMatchObject({ focused: false, reason: expect.stringMatching(/field changed.*refresh/i) });
  await expect(page.locator('#location-bottom')).not.toBeFocused();
});

test('a remaining-field button sends the exact field ID and jumps without writing an answer', async ({ page, browserName }) => {
  await loadFixture(page, browserName);
  const panel = page.getByRole('region', { name: 'JobRight Local autofill' });
  await openPanel(page);
  await expect.poll(async () => (await fixtureRequests(page)).map(request => request.command)).toContain('status');
  await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('1 filled');
  await panel.getByText('Fields that need attention', { exact: true }).click();
  const fields = panel.getByRole('button', { name: /Location/ });
  await expect(fields).toHaveCount(2, { timeout: 3000 });
  await fields.nth(1).click();
  await expect(page.locator('#location-bottom')).toBeFocused();
  await expect(page.locator('#location-bottom')).toBeEmpty();
  await expect(page.locator('#location-top')).not.toBeFocused();
  const jump = (await fixtureRequests(page)).find(request => request.command === 'focus');
  expect(jump?.focus).toMatchObject({ frameId: 0, frameUrl: applicationUrl, fieldId: expect.any(String) });
});

for (const navigate of [false, true]) test(
  navigate ? 'a queued Autofill click is discarded when the application URL changes'
    : 'Autofill clicked during the first status request starts once at the original URL',
  async ({ page, browserName }) => {
    await loadFixture(page, browserName, { delayStatus: true });
    const panel = page.getByRole('region', { name: 'JobRight Local autofill' });
    await openPanel(page);
    await expect.poll(async () => (await fixtureRequests(page)).map(request => request.command)).toEqual(['status']);
    await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
    expect((await fixtureRequests(page)).filter(request => request.command === 'start')).toEqual([]);
    await expect(page.locator('#first-name')).toBeEmpty();
    if (navigate) await page.evaluate(() => history.replaceState({}, '', '/jobs/replacement'));
    await page.evaluate(() => Reflect.get(window, 'releaseFixtureStatus')());

    if (navigate) {
      await expect(panel.getByRole('status')).toContainText(/(?:application|page) changed/i, { timeout: 3000 });
      await expect(page.locator('#first-name')).toBeEmpty();
      expect((await fixtureRequests(page)).filter(request => request.command === 'start')).toEqual([]);
    } else {
      await expect(page.locator('#first-name')).toHaveValue('Morgan', { timeout: 3000 });
      expect((await fixtureRequests(page)).filter(request => request.command === 'start'))
        .toMatchObject([{ url: applicationUrl }]);
    }
  },
);

test('a displayed iframe field stays bound to the top application that listed it', async ({ page, browserName }) => {
  const panel = await revealRemainingFields(page, browserName, { embeddedField: true });
  const embedded = panel.getByRole('button', { name: 'Show field: Embedded screening question' });
  await expect(embedded).toBeVisible();

  await page.evaluate(() => history.replaceState({}, '', '/jobs/replacement'));
  await embedded.click();

  expect((await fixtureRequests(page)).filter(request => request.command === 'focus')).toEqual([]);
  await expect(panel.getByRole('status')).toContainText(/application changed/i);
  await expect(embedded).toHaveCount(0);
});

test('a focus reply received after top-page navigation cannot restore stale results', async ({ page, browserName }) => {
  const panel = await revealRemainingFields(page, browserName, { delayFocus: true });
  const locationFields = panel.getByRole('button', { name: 'Show field: Location', exact: true });
  await locationFields.nth(1).click();
  await expect(page.locator('#location-bottom')).toBeFocused();

  await page.evaluate(() => {
    history.replaceState({}, '', '/jobs/replacement');
    Reflect.get(window, 'releaseFixtureFocus')();
  });

  await expect(panel.getByRole('status')).toContainText(/application changed/i);
  await expect(locationFields).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Autofill', exact: true })).toBeEnabled();
});

test('Autofill, Undo, and the remaining field buttons are disabled while a jump is pending', async ({ page, browserName }) => {
  const panel = await revealRemainingFields(page, browserName, { delayFocus: true });
  const autofill = panel.getByRole('button', { name: 'Autofill', exact: true });
  const undo = panel.getByRole('button', { name: 'Undo last fill' });
  const locationFields = panel.getByRole('button', { name: 'Show field: Location', exact: true });
  await expect(undo).toBeEnabled();

  await locationFields.nth(1).click();
  await expect.poll(async () => (await fixtureRequests(page)).filter(request => request.command === 'focus')).toHaveLength(1);
  await expect(autofill).toBeDisabled();
  await expect(undo).toBeDisabled();
  await expect(locationFields.first()).toBeDisabled();

  await page.evaluate(() => Reflect.get(window, 'releaseFixtureFocus')());

  await expect(panel.getByRole('status')).toContainText('Field highlighted');
  await expect(autofill).toBeEnabled();
  await expect(undo).toBeEnabled();
  await expect(locationFields.first()).toBeEnabled();
  await expect(page.locator('#location-bottom')).toBeFocused();
});

test('an embedded-frame warning remains visible beside the Autofill totals', async ({ page, browserName }) => {
  const panel = await revealRemainingFields(page, browserName, { frameWarning: true });
  const warning = panel.getByText(frameWarning, { exact: true });

  await expect(panel.getByRole('status')).toContainText('1 filled · 3 need attention');
  await expect(warning).toBeVisible();
  await panel.getByRole('button', { name: 'Show field: Location', exact: true }).first().click();
  await expect(panel.getByRole('status')).toContainText('Field highlighted');
  await expect(warning).toBeVisible();
});
