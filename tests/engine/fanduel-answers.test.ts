import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const profile = emptyProfile();
Object.assign(profile.personal, { firstName: 'Jordan', middleName: 'Quinn', lastName: 'Lee' });
profile.applicationDefaults = { relocation: 'yes' };
profile.workAuthorizations = [{ country: 'United States', authorized: true, fullTimeAuthorized: true }];

const radiusQuestion = 'If you are not located within 120 miles of this location, are you willing to relocate for this opportunity upon hire?';
const nearbyChoice = 'I am located within 120 miles';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

test.each([
  'Please list legal first and last name',
  'Enter your legal first name and last name.',
  'Legal given and family names',
  'Please provide your first & last names',
  'What are your legal first and last names?',
])('fills just the two requested name parts for %s', async label => {
  document.body.innerHTML = `<label for="legal-first-and-last-name">${label}</label><input id="legal-first-and-last-name">`;
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Jordan Lee' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector('input')!.value).toBe('Jordan Lee');
});

test('leaves the combined name empty when a requested part is missing', async () => {
  document.body.innerHTML = '<label>Please list legal first and last name<input autocomplete="given-name"></label>';
  const scan = await createEngine(document).scan({ ...profile, personal: { ...profile.personal, lastName: '' } });
  expect(scan.fields[0]).toMatchObject({ status: 'unanswered' });
  expect(scan.fields[0].value).toBeUndefined();
});

test('does not reinterpret an incomplete first and last name as a request for one saved name part', async () => {
  document.body.innerHTML = '<label>Legal first &amp; last name<input></label>';
  const scan = await createEngine(document).scan({ ...profile, personal: { ...profile.personal, firstName: '' } });
  expect(scan.fields[0]).toMatchObject({ status: 'unanswered', aiEligible: false });
  expect(scan.fields[0].interpretationEligible).not.toBe(true);
});

test.each([
  'By entering your name, you confirm that the above statements are accurate.',
  'This entry serves as your electronic signature.',
  'Type your legal first and last name to attest to the above.',
])('leaves a name-based attestation manual even when the field label only asks for a name (%s)', async help => {
  const label = 'Please list legal first and last name';
  document.body.innerHTML = `<label for="legal-name">${label}</label><input id="legal-name" aria-describedby="help"><p id="help">${help}</p>`;
  const engine = createEngine(document);
  const scan = await engine.scan({ ...profile, answers: [{ question: label, answer: 'Jordan Lee' }] });
  expect(scan.fields[0].status).not.toBe('ready');
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(document.querySelector('input')!.value).toBe('');
});

test.each([
  'Please enter your preferred first and last name',
  'Have you worked for Flutter Entertainment or PokerStars?',
  'Are you subject to a non-compete agreement?',
  'What are your salary expectations?',
])('leaves an applicant fact with no saved answer manual (%s)', async label => {
  document.body.innerHTML = `<label>${label}<input></label>`;
  const scan = await createEngine(document).scan(profile);
  expect(scan.fields[0].value).toBeUndefined();
});

function select(question: string, extra = '') {
  document.body.innerHTML = `<label>${question}<select>
    <option value="">Choose</option><option value="affirmative">Yes</option><option value="negative">No</option>${extra}
  </select></label>`;
  return createEngine(document);
}

test.each([
  [radiusQuestion, 'yes', 'Yes', ''],
  [radiusQuestion, 'yes', 'Yes', `<option>${nearbyChoice}</option>`],
  [radiusQuestion, 'no', 'No', ''],
  ["If you don't live within 75 kilometers of the job location, would you be open to relocation if hired?", 'yes', 'Yes', ''],
  ['If you live outside a 50-mile radius of this office, are you willing to relocate?', 'yes', 'Yes', ''],
])('uses saved willingness without asserting a distance (%s, %s)', async (label, saved, expected, extra) => {
  const engine = select(label, extra);
  const scan = await engine.scan({ ...profile, applicationDefaults: { relocation: saved as 'yes' | 'no' } });
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: expected });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector('option:checked')?.textContent).toBe(expected);
});

test.each([
  [radiusQuestion, '<option>Not applicable – I already live nearby</option>'],
  [radiusQuestion, '<option>I am located within 50 miles</option>'],
  ['Do you live within 120 miles of this location?', ''],
  ['If you are not located within 120 miles of this location, are you legally authorized to work in the United States?', ''],
  ['If you are not located within 120 miles of this location, are you willing to relocate only if reimbursed?', ''],
  ['If you are not located within 120 miles of this location, will you relocate before your first day?', ''],
])('leaves an ungrounded distance or additional condition manual (%s)', async (question, extra) => {
  const engine = select(question, extra);
  const scan = await engine.scan(profile);
  expect(scan.fields[0].value).toBeUndefined();
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(document.querySelector('select')!.value).toBe('');
});

test('leaves a negative willingness manual when the question offers a distance answer', async () => {
  const engine = select(radiusQuestion, `<option>${nearbyChoice}</option>`);
  const scan = await engine.scan({ ...profile, applicationDefaults: { relocation: 'no' } });
  expect(scan.fields[0].value).toBeUndefined();
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
});

test('leaves radius-dependent willingness manual in a menu whose full choices cannot be checked together', async () => {
  document.body.innerHTML = `<label for="relocation">${radiusQuestion}</label>
    <button type="button" id="relocation" role="combobox" aria-haspopup="tree" aria-expanded="false" aria-controls="choices">Choose</button>
    <div id="choices" role="tree" hidden></div>`;
  const scan = await createEngine(document).scan(profile);
  expect(scan.fields[0].value).toBeUndefined();
});

test.each([
  ['', true],
  [nearbyChoice, true],
  ['Not applicable', false],
] as const)('checks lazy relocation choices before committing (%s)', async (extra, eligible) => {
  vi.useFakeTimers();
  document.body.innerHTML = `<label for="relocation">${radiusQuestion}</label>
    <button type="button" id="relocation" role="combobox" aria-expanded="false" aria-controls="options">Choose</button>
    <div id="options" role="listbox" hidden></div>`;
  const button = document.querySelector('button')!;
  const options = document.querySelector<HTMLElement>('#options')!;
  button.addEventListener('click', () => {
    button.setAttribute('aria-expanded', 'true');
    options.hidden = false;
    options.innerHTML = '<div role="option">Yes</div><div role="option">No</div>'
      + (extra ? `<div role="option">${extra}</div>` : '');
  });
  options.addEventListener('click', event => {
    button.textContent = (event.target as Element).textContent;
    button.setAttribute('aria-expanded', 'false');
    options.hidden = true;
  });
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
  const fill = engine.fill(scan.scanId);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await fill).toMatchObject({ filled: eligible ? 1 : 0 });
  expect(button.textContent).toBe(eligible ? 'Yes' : 'Choose');
});
