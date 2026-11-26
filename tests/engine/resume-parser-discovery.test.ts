import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

function application() {
  document.body.innerHTML = `<section role="tabpanel">
    <div class="ashby-application-form-autofill-input-root" role="presentation">
      <input type="file" tabindex="-1">
      <h3 class="ashby-application-form-autofill-input-title">Autofill from resume</h3>
      <button type="button">Upload file</button>
    </div>
    <div class="ashby-application-form-field-entry" data-field-path="_systemfield_resume">
      <label for="resume">Resume</label><input id="resume" type="file" required>
    </div>
  </section>`;
}

test('counts the application attachment but not the separate optional résumé-parsing helper', async () => {
  application();
  const plan = await createEngine(document).scan(emptyProfile());
  expect(plan.fields).toHaveLength(1);
  expect(plan.fields[0]).toMatchObject({ label: 'Resume', kind: 'file', required: true });
});

test.each(['required', 'aria-required'] as const)('keeps a parser-shaped upload with an explicit %s obligation visible for review', async attribute => {
  application();
  document.querySelector('input')!.setAttribute(attribute, attribute === 'required' ? '' : 'true');
  const plan = await createEngine(document).scan(emptyProfile());
  expect(plan.fields.filter(field => field.kind === 'file')).toHaveLength(2);
});

test('does not suppress an unidentified upload merely because it shares a parser CSS class', async () => {
  application();
  document.querySelector('h3')!.textContent = 'Upload portfolio work';
  const plan = await createEngine(document).scan(emptyProfile());
  expect(plan.fields.filter(field => field.kind === 'file')).toHaveLength(2);
});

test('keeps the only upload visible when there is no distinct application résumé attachment', async () => {
  application();
  document.querySelector('[data-field-path]')!.remove();
  const plan = await createEngine(document).scan(emptyProfile());
  expect(plan.fields).toHaveLength(1);
});

test.each(['disabled', 'hidden'] as const)('keeps the parser visible when the dedicated attachment is %s', async attribute => {
  application();
  document.querySelector('#resume')!.setAttribute(attribute, '');
  const plan = await createEngine(document).scan(emptyProfile());
  expect(plan.fields).toHaveLength(1);
  expect(plan.fields[0]).toMatchObject({ label: 'Unlabeled field', kind: 'file' });
});

test('keeps a parser whose visible title marks it required', async () => {
  application();
  document.querySelector('h3')!.textContent = 'Autofill from resume *';
  const plan = await createEngine(document).scan(emptyProfile());
  expect(plan.fields.filter(field => field.kind === 'file')).toHaveLength(2);
});
