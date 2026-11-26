import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { degreeRecordCompatible } from '../../src/engine/answer-formats';

import { emptyProfile } from '../../src/shared/profile';

const alconDegrees = [
  'Vocational Degree', 'High School', 'General Equivalency Diploma (GED)', 'Technical Degree', 'Diploma',
  'Associate of Arts', "Associate's", 'Bachelor of Science', 'Bachelor of Arts', "Bachelor's",
  'Bachelor of Business Administration (BBA)', 'Master of Science', 'Master of Business Administration (MBA)',
  'Master of Arts', "Master's", 'Post Doctorate (Fellow)', 'Doctor of Philosophy (PhD)', 'Doctorate',
  'Doctor of Optometry (OD)', 'Medical Doctor (MD)', 'Doctor of Veterinary Medicine (DVM)',
  'Doctor of Pharmacy (PharmD)', 'Juris Doctor (JD)',
];

afterEach(() => document.body.replaceChildren());

function educationProfile(degree: string, exact?: string) {
  const profile = emptyProfile();
  profile.education = [{ school: 'Example University', degree, fieldOfStudy: '', startDate: '', endDate: '', gpa: '' }];
  if (exact) profile.answers = [{ question: 'Degree', answer: exact }];
  return profile;
}

function workdayDegree(
  options = alconDegrees, question = 'Degree', help?: string, conflictingMedicalCaption = false,
  values: Record<string, string> = {},
) {
  document.body.innerHTML = `<main data-automation-id="applyFlowPage"><div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Education-section"><h4 id="Education-section">Education</h4>
      <div role="group" aria-labelledby="Education-1-panel"><h5 id="Education-1-panel">Education 1</h5>
        <div data-automation-id="formField-schoolName">
          <label for="education-5--schoolName">School or University</label>
          <input id="education-5--schoolName" value="Example University">
        </div>
        <div data-automation-id="formField-degree">
          <label for="education-5--degree">${question}<abbr aria-hidden="true">*</abbr></label>
          <button id="education-5--degree" name="degree" type="button" aria-haspopup="listbox" value=""
            aria-label="${question} Select One Required" ${help ? 'aria-describedby="education-degree-help"' : ''}>Select One</button>
          ${help ? `<p id="education-degree-help">${help}</p>` : ''}
        </div>
      </div>
    </div></div></main>`;
  const button = document.querySelector('button')!;
  let selections = 0;
  button.addEventListener('click', () => {
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', 'degree-options');
    const menu = document.createElement('ul');
    menu.id = 'degree-options';
    menu.tabIndex = -1;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-activedescendant', 'select-one');
    menu.setAttribute('aria-required', 'true');
    menu.innerHTML = '<li id="select-one" data-value="" role="option" aria-disabled="true" aria-selected="true"><div>Select One</div></li>';
    for (const [index, caption] of options.entries()) {
      const option = document.createElement('li');
      option.id = `degree-${index}`;
      option.dataset.value = values[caption] ?? option.id;
      option.setAttribute('role', 'option');
      const text = document.createElement('div');
      if (conflictingMedicalCaption && caption === 'Medical Doctor (MD)') {
        option.setAttribute('aria-label', caption);
        text.textContent = 'Report medical conditions';
      } else text.textContent = caption;
      option.append(text);
      option.addEventListener('click', () => {
        selections++;
        button.textContent = caption;
        button.setAttribute('aria-label', `${question} ${caption} Required`);
        button.value = option.dataset.value!;
        button.removeAttribute('aria-expanded');
        button.removeAttribute('aria-controls');
        menu.parentElement!.remove();
      });
      menu.append(option);
    }
    const popup = document.createElement('div');
    popup.setAttribute('visibility', 'opened');
    popup.append(menu);
    document.body.append(popup);
  });
  return { engine: createEngine(document), button, selections: () => selections };
}

test.each([
  ["Master's Degree", "Master's"],
  ["Master's Degree in Information", "Master's"],
  ['Master of Information', "Master's"],
  ['Master of Science in Information (MSI)', 'Master of Science'],
])('a lazy Workday Degree menu selects the most specific verified caption for %s', async (saved, expected) => {
  const { engine, button, selections } = workdayDegree();
  const scan = await engine.scan(educationProfile(saved));
  const field = scan.fields.find(field => field.label === 'Degree')!;
  expect(field).toMatchObject({ status: 'ready' });
  expect(button.hasAttribute('aria-expanded')).toBe(false);
  expect(button.hasAttribute('aria-controls')).toBe(false);
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 1, failed: 0 });
  expect(button.textContent).toBe(expected);
  expect(selections()).toBe(1);
});

test.each([
  ['M.S. in Information', 'Master of Science'],
  ['MEng', 'Master of Engineering (M.Eng.)'],
  ['Bachelor of Engineering in Computer Engineering (B.E.)', 'B.Eng.'],
  ['BEng', "Bachelor's"],
  ["Bachelor's Degree", "Bachelor's"],
])('uses only the degree awarded or a generic level for %s', async (saved, expected) => {
  const { engine, button } = workdayDegree([...alconDegrees, 'Master of Engineering (M.Eng.)',
    ...(expected === "Bachelor's" && saved === 'BEng' ? [] : ['B.Eng.'])]);
  const scan = await engine.scan(educationProfile(saved));
  const field = scan.fields.find(field => field.label === 'Degree')!;
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 1, failed: 0 });
  expect(button.textContent).toBe(expected);
});

test.each([
  ["Master's Degree", ['Master of Science', 'Master of Arts']],
  ["Bachelor's Degree", ['Bachelor of Engineering', 'Bachelor of Science']],
  ['M.S. in Information (MBA)', ['Master of Science', "Master's"]],
  ['BSc in Engineering (BEng)', ['Bachelor of Engineering', 'Bachelor of Science', "Bachelor's"]],
])('keeps %s unfilled when the offered awards are more specific or the saved details conflict', async (saved, options) => {
  const { engine, selections } = workdayDegree(options);
  const scan = await engine.scan(educationProfile(saved));
  const field = scan.fields.find(field => field.label === 'Degree')!;
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 0 });
  expect(selections()).toBe(0);
});

test('an already open Workday Degree menu remains eligible for its saved academic award', async () => {
  const { engine, button } = workdayDegree();
  button.click();
  const scan = await engine.scan(educationProfile("Master's Degree"));
  const field = scan.fields.find(field => field.label === 'Degree')!;
  expect(field).toMatchObject({ status: 'ready', value: "Master's" });
  expect(field.sensitive).toBeUndefined();
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 1, failed: 0 });
});

test.each([
  ['Degree', 'Report your medical conditions.', alconDegrees],
  ['Degree', undefined, [...alconDegrees, 'Medical condition']],
  ['Status', undefined, alconDegrees],
] as const)('continues to protect sensitive content in the %s field and its options', async (label, help, options) => {
  const { engine, button, selections } = workdayDegree([...options], label, help);
  button.click();
  const scan = await engine.scan(educationProfile("Master's Degree"));
  const field = scan.fields.find(field => field.label === label)!;
  expect(field).toMatchObject({ status: 'unanswered', sensitive: true });
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 0 });
  expect(selections()).toBe(0);
});

test('uses a visible equivalent of an exact saved Degree answer ahead of the education record', async () => {
  const { engine, button } = workdayDegree();
  const scan = await engine.scan(educationProfile('Master of Science', 'Master’s Degree'));
  const field = scan.fields.find(field => field.label === 'Degree')!;
  expect(field).toMatchObject({ status: 'ready', value: 'Master’s Degree' });
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 1, failed: 0 });
  expect(button.textContent).toBe("Master's");
});

test('uses an exact saved Workday Degree option value ahead of a visible alias', async () => {
  const caption = 'M.S. in Information';
  const { engine, button } = workdayDegree([...alconDegrees, caption], 'Degree', undefined, false, { [caption]: 'ms' });
  const scan = await engine.scan(educationProfile('Master of Arts', 'ms'));
  const field = scan.fields.find(field => field.label === 'Degree')!;
  expect(field.status).toBe('ready');
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 1, failed: 0 });
  expect(button.value).toBe('ms');
  expect(button.textContent).toBe(caption);
});

test.each([false, true])('preserves native Degree option-value precedence (exact collision: %s)', async collision => {
  const { engine, button } = workdayDegree();
  const select = document.createElement('select');
  select.id = button.id;
  select.innerHTML = `<option value="">Select One</option>
    <option value="ms">M.S. in Information</option><option value="msc">Master of Science</option>
    <option value="md">Medical Doctor (MD)</option>
    ${collision ? '<option value="other">MS</option>' : ''}`;
  button.replaceWith(select);
  const scan = await engine.scan(educationProfile('Master of Arts', 'ms'));
  const field = scan.fields.find(field => field.label === 'Degree')!;
  expect(field.status).toBe(collision ? 'unanswered' : 'ready');
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: collision ? 0 : 1 });
  expect(select.value).toBe(collision ? '' : 'ms');
});

test('keeps an ambiguous exact saved Degree answer unresolved rather than applying the education record', async () => {
  const { engine, button, selections } = workdayDegree([...alconDegrees, 'Masters']);
  button.click();
  const scan = await engine.scan(educationProfile('Master of Science', 'Master’s Degree'));
  const field = scan.fields.find(field => field.label === 'Degree')!;
  expect(field.status).toBe('unanswered');
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 0 });
  expect(selections()).toBe(0);
});

test.each([false, true])('protects a medical option with conflicting accessible and displayed captions (open: %s)', async opened => {
  const { engine, button, selections } = workdayDegree(alconDegrees, 'Degree', undefined, true);
  if (opened) button.click();
  const scan = await engine.scan(educationProfile("Master's Degree"));
  const field = scan.fields.find(field => field.label === 'Degree')!;
  expect(field.status).toBe(opened ? 'unanswered' : 'ready');
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 0 });
  expect(selections()).toBe(0);
});

test('corroborates a partial education row without replacing its manually selected award', () => {
  expect(degreeRecordCompatible('Master of Science', "Master's Degree")).toBe(true);
  expect(degreeRecordCompatible('MS', 'Master of Science in Information (MSI)')).toBe(true);
  expect(degreeRecordCompatible("Bachelor's", 'Bachelor of Engineering')).toBe(true);
  expect(degreeRecordCompatible('Master of Science', 'Master of Arts')).toBe(false);
  expect(degreeRecordCompatible('Master of Science', 'Master of Information')).toBe(false);
  expect(degreeRecordCompatible('Master of Science', "Bachelor's")).toBe(false);
  expect(degreeRecordCompatible('BEng', 'Bachelor of Science')).toBe(false);
  expect(degreeRecordCompatible('', '')).toBe(false);
});
