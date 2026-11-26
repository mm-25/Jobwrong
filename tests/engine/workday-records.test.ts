import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { AutofillEngine, Employment } from '../../src/shared/types';

afterEach(() => document.body.replaceChildren());

function experienceProfile() {
  const profile = emptyProfile();
  const designer: Employment = {
    company: 'Acme Studio', title: 'Designer', description: 'Built accessible components.',
    location: '', startDate: '', endDate: '', current: false,
  };
  const researcher: Employment = {
    ...designer, title: 'Researcher', description: 'Conducted field interviews.',
  };
  profile.employment = [designer, researcher];
  return profile;
}

function existingRoles() {
  document.body.innerHTML = `<form data-automation-id="myExperiencePage">
    <section data-automation-id="workExperienceSection">
      <fieldset data-automation-id="workExperience-1">
        <legend>Work Experience 1</legend>
        <label>Company <input value="Acme Studio"></label>
        <label>Job Title <input id="title-1" value="Researcher"></label>
        <label>Role Description <textarea id="description-1"></textarea></label>
      </fieldset>
      <fieldset data-automation-id="workExperience-2">
        <legend>Work Experience 2</legend>
        <label>Company <input value="Acme Studio"></label>
        <label>Job Title <input id="title-2" value="Contractor"></label>
        <label>Role Description <textarea id="description-2"></textarea></label>
      </fieldset>
    </section>
  </form>`;
}

test('binds a populated Workday company with two saved positions through the exact existing job title', async () => {
  existingRoles();
  const engine = createEngine(document);
  const scan = await engine.scan(experienceProfile());
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(document.querySelector<HTMLTextAreaElement>('#description-1')?.value).toBe('Conducted field interviews.');
  expect(document.querySelector<HTMLInputElement>('#title-2')?.value).toBe('Contractor');
  expect(document.querySelector<HTMLTextAreaElement>('#description-2')?.value).toBe('');
});

test('checks the title again before writing details selected through a Workday position match', async () => {
  existingRoles();
  const engine = createEngine(document);
  const scan = await engine.scan(experienceProfile());
  expect(scan.fields.find(field => field.label === 'Role Description')?.status).toBe('ready');
  document.querySelector<HTMLInputElement>('#title-1')!.value = 'Applicant-edited title';
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, skipped: 1 });
  expect(document.querySelector<HTMLTextAreaElement>('#description-1')?.value).toBe('');
});

function row(index: number, company = '', title = '') {
  const key = 80 + 17 * index;
  return `<div role="group" aria-labelledby="Work-Experience-${index}-panel">
    <h5 id="Work-Experience-${index}-panel">Work Experience ${index}</h5>
    <label>Company <input id="workExperience-${key}--companyName" name="company-${index}" value="${company}"></label>
    <label>Job Title <input id="workExperience-${key}--jobTitle" name="title-${index}" value="${title}"></label>
  </div>`;
}

function editableExperience(existing: string, onAdd: (rows: HTMLElement, count: number) => void, buttonType?: 'submit') {
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage">
    ${buttonType ? '<form>' : ''}<div role="group" aria-labelledby="Work-Experience-section">
      <h4 id="Work-Experience-section">Work Experience</h4>
      <div id="rows">${existing}</div>
      <button data-automation-id="add-button"${buttonType ? ' type="submit"' : ''}>Add Another</button>
    </div>
    <section data-automation-id="educationSection">
      <button data-automation-id="add-button" type="button">Add Another</button>
    </section><button type="submit">Save and Continue</button>${buttonType ? '</form>' : ''}
  </main>`;
  const rows = document.querySelector<HTMLElement>('#rows')!;
  let clicks = 0;
  const prohibited: string[] = [];
  document.querySelector('main')!.addEventListener('submit', event => {
    event.preventDefault();
    prohibited.push('submit');
  });
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-automation-id="add-button"]');
  buttons[0].addEventListener('click', () => { onAdd(rows, ++clicks); });
  buttons[1].addEventListener('click', () => { prohibited.push('education'); });
  return { rows, clicks: () => clicks, prohibited };
}

test('uses manual blank Workday rows first and creates only the missing employment rows on explicit expansion', async () => {
  const { rows, clicks, prohibited } = editableExperience(
    row(1, 'Acme Studio', 'Researcher') + row(2, 'Local Nonprofit', 'Volunteer') + row(3),
    container => window.setTimeout(() => container.insertAdjacentHTML('beforeend', row(container.children.length + 1)), 30),
  );
  const profile = experienceProfile();
  profile.employment.push({ ...profile.employment[0], company: 'Harbor Design', title: 'Lead Designer' });
  const engine: AutofillEngine = createEngine(document);
  const initial = await engine.scan(profile);
  expect(initial.workdayExperienceGroupId).toBeTruthy();
  expect(clicks()).toBe(0);
  expect(await engine.expandWorkdayExperience?.(initial.scanId, initial.workdayExperienceGroupId!)).toMatchObject({ added: 1, needsRescan: true });
  const read = (name: string) => [...rows.querySelectorAll<HTMLInputElement>(`input[name^="${name}-"]`)].map(input => input.value);
  expect(read('company')).toEqual(['Acme Studio', 'Local Nonprofit', '', '']);

  const after = await engine.scan(profile);
  expect(after.fields.filter(field => field.label === 'Company').map(field => field.section))
    .toEqual(['Employment · 1', 'Employment · 2', 'Employment · 3', 'Employment · 4']);
  expect(await engine.fill(after.scanId)).toMatchObject({ filled: 4, failed: 0 });
  expect(read('company')).toEqual(['Acme Studio', 'Local Nonprofit', 'Acme Studio', 'Harbor Design']);
  expect(read('title')).toEqual(['Researcher', 'Volunteer', 'Designer', 'Lead Designer']);

  const next = await engine.scan(profile);
  expect(await engine.expandWorkdayExperience?.(next.scanId, next.workdayExperienceGroupId!)).toMatchObject({ added: 0, needsRescan: false });
  expect(clicks()).toBe(1);
  expect(prohibited).toEqual([]);

  await engine.undo(after.scanId);
  expect(read('company')).toEqual(['Acme Studio', 'Local Nonprofit', '', '']);
  expect(read('title')).toEqual(['Researcher', 'Volunteer', '', '']);
});

test('will not use an add-looking submit control to create Workday rows', async () => {
  const { clicks, prohibited } = editableExperience('', () => {}, 'submit');
  const engine: AutofillEngine = createEngine(document);
  const scan = await engine.scan(experienceProfile());
  expect(await engine.expandWorkdayExperience?.(scan.scanId, scan.workdayExperienceGroupId!)).toMatchObject({ added: 0, needsRescan: false });
  expect(clicks()).toBe(0);
  expect(prohibited).toEqual([]);
});

test('will not continue creating rows if the Workday group is replaced at the same URL', async () => {
  const profile = experienceProfile();
  const { clicks } = editableExperience('', container => {
    const section = container.parentElement!;
    const replaced = section.cloneNode(true) as HTMLElement;
    replaced.querySelector('#rows')!.innerHTML = row(1);
    section.replaceWith(replaced);
  });
  const engine: AutofillEngine = createEngine(document);
  const original = await engine.scan(profile);
  expect(await engine.expandWorkdayExperience?.(original.scanId, original.workdayExperienceGroupId!)).toMatchObject({ added: 0, needsRescan: true });
  expect(clicks()).toBe(1);
  const replacement = await engine.scan(profile);
  expect(replacement.workdayExperienceGroupId).not.toBe(original.workdayExperienceGroupId);
  expect(await engine.expandWorkdayExperience?.(replacement.scanId, original.workdayExperienceGroupId!)).toMatchObject({ added: 0, needsRescan: false });
});

test('counts committed Workday text when its input remounts and keeps filling the other scanned rows', async () => {
  const { rows } = editableExperience(row(1) + row(2), () => {});
  const before = [...rows.querySelectorAll('input')];
  rows.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    const replacement = input.cloneNode() as HTMLInputElement;
    replacement.value = input.value;
    input.replaceWith(replacement);
  });
  const engine = createEngine(document);
  const scan = await engine.scan(experienceProfile());
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 4, failed: 0, undoAvailable: true });
  expect(before.every(input => !input.isConnected)).toBe(true);
  const read = () => [...rows.querySelectorAll('input')].map(input => input.value);
  expect(read()).toEqual(['Acme Studio', 'Designer', 'Acme Studio', 'Researcher']);

  await expect(engine.undo(scan.scanId)).resolves.toEqual({ restored: 4, skipped: 0 });
  expect(read()).toEqual(['', '', '', '']);
});

test('does not write to an untouched Workday input replaced after the scan', async () => {
  const { rows } = editableExperience(row(1), () => {});
  const engine = createEngine(document);
  const scan = await engine.scan(experienceProfile());
  const title = rows.querySelector<HTMLInputElement>('input[id$="--jobTitle"]')!;
  const replacement = title.cloneNode() as HTMLInputElement;
  title.replaceWith(replacement);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 0, skipped: 2 });
  expect(replacement.value).toBe('');
});

test('does not adopt a Workday replacement that receives its own edit during the write', async () => {
  const { rows } = editableExperience(row(1), () => {});
  const company = rows.querySelector<HTMLInputElement>('input[id$="--companyName"]')!;
  const engine = createEngine(document);
  const scan = await engine.scan(experienceProfile());
  company.addEventListener('input', () => {
    const replacement = company.cloneNode() as HTMLInputElement;
    replacement.value = company.value;
    company.replaceWith(replacement);
    replacement.dispatchEvent(new Event('change', { bubbles: true }));
  }, { once: true });

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, skipped: 1, undoAvailable: false });
  expect(rows.querySelector<HTMLInputElement>('input[id$="--jobTitle"]')?.value).toBe('');
});

test('does not adopt a Workday replacement that loses its native form owner', async () => {
  const { rows } = editableExperience(row(1), () => {}, 'submit');
  const company = rows.querySelector<HTMLInputElement>('input[id$="--companyName"]')!;
  const engine = createEngine(document);
  const scan = await engine.scan(experienceProfile());
  company.addEventListener('input', () => {
    const replacement = company.cloneNode() as HTMLInputElement;
    replacement.setAttribute('form', 'unavailable-owner');
    replacement.value = company.value;
    company.replaceWith(replacement);
  }, { once: true });

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, skipped: 1, undoAvailable: false });
  expect(rows.querySelector<HTMLInputElement>('input[id$="--companyName"]')?.form).toBeNull();
  expect(rows.querySelector<HTMLInputElement>('input[id$="--jobTitle"]')?.value).toBe('');
});
