import { expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';

function setup(html: string) {
  document.body.innerHTML = html;
  const profile = emptyProfile();
  profile.personal.firstName = 'Lin';
  profile.personal.lastName = 'Rivera';
  const engine = createEngine(document);
  const controller = createPageController(document, engine, () => {});
  return { engine, controller, profile };
}

const firstNameField = '<label>First name<input autocomplete="given-name"></label>';
const lastNameField = '<label>Last name<input autocomplete="family-name"></label>';
const field = (autocomplete: string) => document.querySelector<HTMLInputElement>(`[autocomplete=${autocomplete}]`)!;
const finish = (controller: ReturnType<typeof createPageController>) =>
  vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 2500 });

test('keeps mixed policy manual when a separate legal notice follows the privacy label', async () => {
  const { engine, profile } = setup(`
    <form><div class="field">
      <label for="privacy">I accept the applicant privacy notice</label>
      <input type="checkbox" id="privacy">
      <p class="legal">I also agree to the Terms and Conditions and provide my signature.</p>
    </div></form>`);
  profile.applicationDefaults = { acceptApplicationPrivacy: true };

  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'unsupported', sensitive: true, aiEligible: false });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(document.querySelector<HTMLInputElement>('#privacy')!.checked).toBe(false);
});

test('stops before filling a replacement application form at the same URL', async () => {
  const { controller, profile } = setup(`<form id="original-application">${firstNameField}</form>`);
  const original = document.querySelector<HTMLFormElement>('#original-application')!;
  const replacement = document.createElement('form');
  replacement.innerHTML = lastNameField;
  const initialUrl = document.URL;
  field('given-name').addEventListener('input', () => {
    window.setTimeout(() => original.replaceWith(replacement), 60);
  });

  controller.start(profile);
  await vi.waitFor(() => expect(replacement.isConnected).toBe(true));
  await finish(controller);

  expect(document.URL).toBe(initialUrl);
  expect(field('family-name').value).toBe('');
  expect(controller.status().filled).toBe(1);
});

test('keeps prerequisites for a newly revealed field the applicant filled during the job', async () => {
  const { controller, profile } = setup(`
    <form>${firstNameField}<div id="dependent" hidden>${lastNameField}</div></form>`);
  const first = field('given-name');
  const last = field('family-name');
  const dependent = document.querySelector<HTMLElement>('#dependent')!;
  first.addEventListener('input', () => {
    if (!first.value) {
      dependent.hidden = true;
      last.value = '';
      return;
    }
    window.setTimeout(() => {
      dependent.hidden = false;
      last.value = 'Applicant edit';
      last.dispatchEvent(new Event('input', { bubbles: true }));
    }, 60);
  });

  controller.start(profile);
  await finish(controller);
  expect(last.value).toBe('Applicant edit');
  expect(controller.status().filled).toBe(1);

  await controller.undo();

  expect(first.value).toBe('Lin');
  expect(last.value).toBe('Applicant edit');
  expect(dependent.hidden).toBe(false);
});

test('does not retry a failed answer when the same question is remounted', async () => {
  const { controller, profile } = setup(`<form>${firstNameField}${lastNameField}</form>`);
  const form = document.querySelector('form')!;
  let attempts = 0;
  form.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    if (input.autocomplete !== 'family-name') return;
    attempts++;
    const replacement = input.cloneNode() as HTMLInputElement;
    replacement.value = '';
    input.replaceWith(replacement);
  });

  controller.start(profile);
  await finish(controller);

  expect(field('given-name').value).toBe('Lin');
  expect(field('family-name').value).toBe('');
  expect(attempts).toBe(1);
});

test('keeps prerequisites when undo cannot clear a dependent combobox', async () => {
  const { controller, profile } = setup(`
    <form>${firstNameField}
      <div id="dependent" hidden>
        <button type="button" role="combobox" aria-label="Office choice" aria-controls="offices" aria-expanded="false">Select One</button>
        <div id="offices" role="listbox" hidden><div role="option">Detroit</div></div>
      </div>
    </form>`);
  const first = field('given-name');
  const dependent = document.querySelector<HTMLElement>('#dependent')!;
  const button = dependent.querySelector('button')!;
  const choices = document.querySelector<HTMLElement>('#offices')!;
  profile.answers = [{ question: 'Office choice', answer: 'Detroit' }];
  first.addEventListener('input', () => { dependent.hidden = !first.value; });
  button.addEventListener('click', () => {
    choices.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  });
  choices.firstElementChild!.addEventListener('click', () => {
    button.textContent = 'Detroit';
    button.setAttribute('aria-expanded', 'false');
    choices.hidden = true;
  });

  controller.start(profile);
  await finish(controller);
  expect(button.textContent).toBe('Detroit');
  expect(controller.status().filled).toBe(2);

  await controller.undo();

  expect(button.textContent).toBe('Detroit');
  expect(first.value).toBe('Lin');
  expect(dependent.hidden).toBe(false);
});
