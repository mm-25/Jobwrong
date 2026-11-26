import { afterEach, expect, test } from 'vitest';
import { displayValue } from '../../src/engine/controls';
import { discover } from '../../src/engine/discovery';
import * as records from '../../src/engine/workday-records';
import { workdayTextFieldInput, workdayTextFieldLocation } from '../../src/engine/workday-text-fields';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

function eduRow(index: number, school = '', degree = '') {
  return `<div role="group" aria-labelledby="Education-${index}-panel">
    <h5 id="Education-${index}-panel">Education ${index}</h5>
    <label>School or University <input id="education-${100 + index}--schoolName" value="${school}"></label>
    <label>Degree <input id="education-${100 + index}--degree" value="${degree}"></label>
  </div>`;
}

function urlRow(index: number, url = '') {
  return `<div role="group" aria-labelledby="Websites-${index}-panel">
    <h5 id="Websites-${index}-panel">Websites ${index}</h5>
    <div data-fkit-id="webAddress-${200 + index}--null">
      <div data-automation-id="formField-url" data-fkit-id="webAddress-${200 + index}--url">
        <label for="webAddress-${200 + index}--url">URL*</label>
        <input type="text" id="webAddress-${200 + index}--url" name="url" aria-required="true" value="${url}">
      </div>
    </div>
  </div>`;
}

function section(name: string, existing: string, append: (rows: HTMLElement) => void) {
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="${name}-section">
      <h4 id="${name}-section">${name}</h4>
      <div id="rows">${existing}</div>
      <button data-automation-id="add-button">${existing ? 'Add Another' : 'Add'}</button>
    </div>
    <button type="button" id="unrelated" data-automation-id="add-button">Add</button>
  </main>`;
  const rows = document.querySelector<HTMLElement>('#rows')!;
  const button = rows.nextElementSibling as HTMLButtonElement;
  const clicks: string[] = [];
  button.addEventListener('click', () => { clicks.push(name); append(rows); });
  document.querySelector('#unrelated')!.addEventListener('click', () => { clicks.push('unrelated'); });
  return { rows, clicks, button };
}

const educationProfile = () => ({
  ...emptyProfile(),
  education: ['First University', 'Second University'].map(school => ({
    school, degree: '', fieldOfStudy: '', startDate: '', endDate: '', gpa: '',
  })),
});

const websitesProfile = () => {
  const profile = emptyProfile();
  profile.personal.website = 'https://portfolio.example.test';
  profile.personal.github = 'https://github.com/example-person';
  return profile;
};

test('adds exactly one education row for a second saved school while preserving a populated row', async () => {
  const { rows, clicks } = section('Education', eduRow(1, 'First University'),
    container => container.insertAdjacentHTML('beforeend', eduRow(2)));
  const group = records.workdayRepeatGroup(document, 'education');
  expect(clicks).toEqual([]);
  expect(group).toBeDefined();
  await expect(records.addWorkdayRepeatRows(group!, educationProfile(), () => true))
    .resolves.toMatchObject({ added: 1, needsRescan: true });
  expect(clicks).toEqual(['Education']);
  expect([...rows.querySelectorAll<HTMLInputElement>('input[id$="--schoolName"]')].map(input => input.value))
    .toEqual(['First University', '']);
});

test('uses a blank Website row before adding capacity and omits existing saved links from assignments', async () => {
  const { clicks } = section('Websites', urlRow(1, 'https://portfolio.example.test/') + urlRow(2), () => {});
  const group = records.workdayRepeatGroup(document, 'websites');
  expect(group).toBeDefined();
  await expect(records.addWorkdayRepeatRows(group!, websitesProfile(), () => true))
    .resolves.toMatchObject({ added: 0, needsRescan: false });
  expect(clicks).toEqual([]);
  expect([...records.workdayWebsiteAnswers(discover(document), websitesProfile(), displayValue)]
    .map(([field, url]) => [field.element.id, url]))
    .toEqual([['webAddress-202--url', 'https://github.com/example-person']]);
});

test('creates one Website row at a time and retains both URL assignments in order', async () => {
  const { clicks } = section('Websites', '', rows => rows.insertAdjacentHTML('beforeend', urlRow(rows.children.length + 1)));
  const group = records.workdayRepeatGroup(document, 'websites');
  expect(group).toBeDefined();
  await expect(records.addWorkdayRepeatRows(group!, websitesProfile(), () => true))
    .resolves.toMatchObject({ added: 2, needsRescan: true });
  expect(clicks).toEqual(['Websites', 'Websites']);
  expect([...records.workdayWebsiteAnswers(discover(document), websitesProfile(), displayValue).values()])
    .toEqual(['https://portfolio.example.test', 'https://github.com/example-person']);
});

test('stops Website expansion when the first Add inserts more than one row', async () => {
  const { clicks } = section('Websites', '', rows => rows.insertAdjacentHTML('beforeend', urlRow(1) + urlRow(2)));
  const group = records.workdayRepeatGroup(document, 'websites');
  expect(group).toBeDefined();
  await expect(records.addWorkdayRepeatRows(group!, websitesProfile(), () => true))
    .resolves.toMatchObject({ added: 0, needsRescan: true, aborted: true });
  expect(clicks).toEqual(['Websites']);
});

test('refuses an education Add control that can submit the form', async () => {
  const { button, clicks } = section('Education', '', () => {});
  const form = document.createElement('form');
  button.closest('main')!.before(form);
  form.append(button.closest('main')!);
  const group = records.workdayRepeatGroup(document, 'education');
  expect(group).toBeDefined();
  await expect(records.addWorkdayRepeatRows(group!, educationProfile(), () => true))
    .resolves.toMatchObject({ added: 0, needsRescan: false });
  expect(clicks).toEqual([]);
});

test('recognizes a remounted Website input in the original field container', () => {
  const { rows } = section('Websites', urlRow(1), () => {});
  const input = rows.querySelector<HTMLInputElement>('input')!;
  const location = workdayTextFieldLocation(input);
  expect(location).toBeDefined();
  const replacement = input.cloneNode() as HTMLInputElement;
  input.replaceWith(replacement);
  expect(workdayTextFieldInput(location!)).toBe(replacement);
});

test.each(['field container', 'record container', 'row', 'section'])('rejects a Website input when the %s is replaced', part => {
  const { rows } = section('Websites', urlRow(1), () => {});
  const input = rows.querySelector<HTMLInputElement>('input')!;
  const location = workdayTextFieldLocation(input);
  expect(location).toBeDefined();
  const selectors: Record<string, string> = {
    'field container': '[data-automation-id="formField-url"]',
    'record container': '[data-fkit-id$="--null"]',
    row: '[aria-labelledby="Websites-1-panel"]',
    section: '[aria-labelledby="Websites-section"]',
  };
  const container = input.closest(selectors[part])!;
  container.replaceWith(container.cloneNode(true));
  expect(workdayTextFieldInput(location!)).toBeUndefined();
});

test('retains the current partial education record and adds only the unmatched saved record', async () => {
  const profile = educationProfile();
  profile.education[0].degree = 'Bachelor of Science';
  profile.education[1].degree = 'Master of Science';
  const { rows, clicks } = section('Education', eduRow(1, '', 'Master of Science'), container => {
    container.insertAdjacentHTML('beforeend', eduRow(container.children.length + 1));
  });
  const group = records.workdayRepeatGroup(document, 'education')!;
  await expect(records.addWorkdayRepeatRows(group, profile, () => true))
    .resolves.toMatchObject({ added: 1, needsRescan: true });
  expect(clicks).toEqual(['Education']);
  expect([...rows.querySelectorAll<HTMLInputElement>('input[id$="--degree"]')].map(input => input.value))
    .toEqual(['Master of Science', '']);
});
