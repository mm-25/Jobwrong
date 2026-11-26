import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

function row(index: number, values: { company?: string; title?: string; start?: string } = {}) {
  return `<fieldset data-automation-id="workExperience-${index}">
    <legend>Work Experience ${index}</legend>
    <label>Company<input id="company-${index}" value="${values.company ?? ''}"></label>
    <label>Job Title<input id="title-${index}" value="${values.title ?? ''}"></label>
    <label>From<input type="month" value="${values.start ?? ''}"></label>
    <label>Role Description<textarea id="description-${index}"></textarea></label>
  </fieldset>`;
}

function application(rows: string) {
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage">
    <label>City<input id="city"></label>
    <section data-automation-id="workExperienceSection">${rows}</section>
  </main>`;
  const profile = emptyProfile();
  profile.personal.city = 'Detroit';
  profile.employment = [{ company: 'Acme Studio', title: 'Designer', startDate: '2022-01', endDate: '',
    description: 'Work completed during the second tenure.', current: false, location: '' }];
  return { engine: createEngine(document), profile };
}

function value(id: string): string {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>('#' + id)!.value;
}

test('does not attach saved employment details to the first of two Workday rows with the same company and title', async () => {
  const { engine, profile } = application(
    row(1, { company: 'Acme Studio', title: 'Designer', start: '2016-01' })
    + row(2, { company: 'Acme Studio', title: 'Designer', start: '2022-01' }) + row(3),
  );
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(value('description-1')).toBe('');
  expect(value('description-2')).toBe('');
  expect(value('company-3')).toBe('');
  expect(value('city')).toBe('Detroit');
});

test.each(['existing', 'new'])('leaves a blank Workday row alone when a sibling claims its saved job after preview (%s)', async sibling => {
  const { engine, profile } = application(row(1) + (sibling === 'existing' ? row(2) : ''));
  const scan = await engine.scan(profile);
  expect(scan.fields.find(field => field.label === 'Company')?.status).toBe('ready');
  if (sibling === 'new') {
    document.querySelector('[data-automation-id="workExperienceSection"]')!
      .insertAdjacentHTML('beforeend', row(2, { company: 'Acme Studio', title: 'Designer' }));
  } else {
    for (const [id, text] of [['company-2', 'Acme Studio'], ['title-2', 'Designer']]) {
      const input = document.querySelector<HTMLInputElement>('#' + id)!;
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(value('company-1')).toBe('');
  expect(value('title-1')).toBe('');
  expect(value('company-2')).toBe('Acme Studio');
  expect(value('title-2')).toBe('Designer');
  expect(value('city')).toBe('Detroit');
});
