import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { JobRequest } from '../../src/shared/jobs';
import { emptyProfile } from '../../src/shared/profile';

const applicationUrl = 'https://application.example.test/jobs/hydration-fixture';
const profile = emptyProfile();
profile.personal.firstName = 'Morgan';
profile.personal.lastName = 'Lee';
profile.personal.email = 'morgan.lee@example.test';

test('keeps one usable Autofill panel and Undo through formless application hydration', async ({ page, browserName }) => {
  const html = `<!doctype html><title>Hydration fixture</title><body><section id="application">
    <label>First name<input autocomplete="given-name"></label>
    <label>Last name<input autocomplete="family-name"></label>
    <label>Email<input autocomplete="email"></label>
  </section></body>`;
  await page.route('**/*', route => route.request().url() === applicationUrl
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.addInitScript(savedProfile => {
    // Use the real page controller behind a synthetic background-message boundary.
    const actions: string[] = [];
    Reflect.set(window, 'fixtureActions', actions);
    Reflect.set(window, 'browser', {
      runtime: {
        id: 'synthetic-extension',
        async sendMessage(request: JobRequest) {
          const controller = window.__jobrightPage!;
          if (request.command === 'start') {
            actions.push('start');
            controller.start(savedProfile);
          } else if (request.command === 'undo') {
            actions.push('undo');
            await controller.undo();
          }
          return { states: [controller.status()] };
        },
      },
    });
  }, profile);

  await page.goto(applicationUrl);
  const contentScript = resolve('dist', browserName, 'content.js');
  await page.addScriptTag({ path: contentScript });
  const launcher = page.getByRole('button', { name: 'Open JobRight Local' });
  const panel = page.getByRole('region', { name: 'JobRight Local autofill' });
  const firstName = page.getByLabel('First name');
  await expect(launcher).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.replaceChildren(document.head, document.body);
  });
  await expect(launcher).toBeVisible();
  await expect(firstName).toBeEmpty();
  await launcher.click();
  await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
  await expect(firstName).toHaveValue('Morgan');

  // Replace the document's root and body while keeping the same form instance.
  await page.evaluate(() => {
    const root = document.documentElement;
    const replacement = document.createElement('html');
    const body = document.createElement('body');
    body.append(document.querySelector('#application')!);
    replacement.append(document.head, body);
    root.replaceWith(replacement);
  });
  await page.addScriptTag({ path: contentScript });
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-jobright-local-ui]')).toHaveCount(1);
  const undo = panel.getByRole('button', { name: 'Undo last fill' });
  await expect(undo).toBeEnabled();

  // A direct host detach also recovers with the same completed run.
  await page.evaluate(() => document.querySelector('[data-jobright-local-ui]')!.remove());
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(firstName).toBeEmpty();
  await expect(undo).toBeDisabled();
  expect(await page.evaluate(() => Reflect.get(window, 'fixtureActions'))).toEqual(['start', 'undo']);
});

test('retires the orphaned widget on extension reload and keeps the application draft', async ({ page, browserName }) => {
  const html = `<!doctype html><title>Reload fixture</title><body><form>
    <label>First name<input autocomplete="given-name"></label>
    <label>Last name<input autocomplete="family-name"></label>
    <label>Email<input autocomplete="email"></label>
    <label>Cover letter<textarea></textarea></label>
  </form></body>`;
  await page.route('**/*', route => route.request().url() === applicationUrl
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.clock.install();
  await page.goto(applicationUrl);

  const installContext = (generation: string) => page.evaluate(({ generation, savedProfile }) => {
    Reflect.deleteProperty(window, '__jobrightLocal');
    Reflect.deleteProperty(window, '__jobrightPage');
    const actions: string[] = Reflect.get(window, 'reloadActions') ?? [];
    Reflect.set(window, 'reloadActions', actions);
    Reflect.set(window, 'browser', {
      runtime: {
        id: 'synthetic-extension',
        async sendMessage(request: JobRequest) {
          const controller = window.__jobrightPage!;
          if (generation === 'previous' && request.command === 'status') {
            actions.push('previous-status');
            return { states: [{ ...controller.status(), running: true }] };
          }
          if (request.command === 'start') {
            actions.push(generation);
            controller.start(savedProfile);
          }
          return { states: [controller.status()] };
        },
      },
    });
  }, { generation, savedProfile: profile });

  const contentScript = resolve('dist', browserName, 'content.js');
  await installContext('previous');
  await page.addScriptTag({ path: contentScript });
  const launcher = page.getByRole('button', { name: 'Open JobRight Local' });
  const panel = page.getByRole('region', { name: 'JobRight Local autofill' });
  const draft = page.getByLabel('Cover letter');
  await draft.fill('Applicant’s saved draft');
  await launcher.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('status')).toContainText('Filling your application');

  await installContext('current');
  await page.addScriptTag({ path: contentScript });
  const hosts = page.locator('[data-jobright-local-ui="true"]');
  await expect(hosts).toHaveCount(2);
  const orphan = hosts.and(page.locator('[inert][aria-hidden="true"]'));
  await expect(orphan).toHaveCount(1);
  await expect(orphan).toBeHidden();
  await expect(launcher).toHaveCount(1);
  await expect(panel).toHaveCount(0);
  await expect(draft).toHaveValue('Applicant’s saved draft');
  await page.clock.fastForward(1000);
  expect(await page.evaluate(() => Reflect.get(window, 'reloadActions'))).toEqual(['previous-status']);

  await launcher.click();
  await expect(panel).toHaveCount(1);
  await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
  await expect(page.getByLabel('First name')).toHaveValue('Morgan');
  await expect(draft).toHaveValue('Applicant’s saved draft');
  expect(await page.evaluate(() => Reflect.get(window, 'reloadActions'))).toEqual(['previous-status', 'current']);
});
