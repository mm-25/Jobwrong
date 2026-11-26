import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { Education } from '../../src/shared/types';

const education: Education = {
  school: 'Example University', degree: 'M.S.', fieldOfStudy: 'Design',
  startDate: '2026-09', endDate: '2028-05', gpa: '',
};

function form(markup: string) {
  document.body.innerHTML = `<form>${markup}</form>`;
  return createEngine(document);
}

function select(label: string, options: string) {
  return `<label>${label}<select><option value="">Select…</option>${options}</select></label>`;
}

const years = '<option value="year27">2027</option><option value="year28">2028</option><option>Other</option>';
const palantirUniversity = 'Which university are you currently attending or did you last attend? Please select "Other (School Not Listed)" if your school is not listed.';
const palantirGraduation = 'Please include your intended graduation year for the degree or relevant learning program that you are currently pursuing or have completed.';

test('matches a last-university dropdown despite sensitive words in the names of other universities', async () => {
  const engine = form(select(palantirUniversity, `
    <option>Example Medical School</option>
    <option>College of Religious Studies</option>
    <option value="campus-411">Example University</option>
    <option>Other (School Not Listed)</option>`));
  const scan = await engine.scan({ ...emptyProfile(), education: [education] });
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Example University' });
  expect(scan.fields[0].sensitive).toBeFalsy();
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector('select')?.value).toBe('campus-411');
});

test('keeps status and identity dropdowns sensitive when their choices expose a sensitive purpose', async () => {
  const options = '<option>On medical leave</option><option>Not on medical leave</option>';
  const engine = form(select('Status', options) + select('Select your identity', options)
    + select('University', options)
    + '<fieldset><legend>Medical leave</legend>' + select('University', '<option>Example University</option>') + '</fieldset>');
  const scan = await engine.scan({ ...emptyProfile(), education: [education] });
  expect(scan.fields).toHaveLength(4);
  scan.fields.forEach(field => expect(field).toMatchObject({ status: 'unanswered', sensitive: true, aiEligible: false }));
});

test('does not choose a partial, duplicate, or hidden option value for a standalone university', async () => {
  const engine = form(select('University', '<option>Example University – North</option><option>Other (School Not Listed)</option>')
    + select('University', '<option value="a">Example University</option><option value="b">Example University</option>')
    + select('University', '<option value="Example University">Unrelated College</option>'));
  const scan = await engine.scan({ ...emptyProfile(), education: [education] });
  expect(scan.fields.map(field => field.status)).toEqual(['unanswered', 'unanswered', 'unanswered']);
});

test('uses an explicit end year for a standalone intended graduation year dropdown', async () => {
  const engine = form(select(palantirGraduation, years));
  const scan = await engine.scan({ ...emptyProfile(), education: [{ ...education, current: true }] });
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: '2028' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector('select')?.value).toBe('year28');
});

test('requires a saved graduation date and a visible matching year', async () => {
  const engine = form(select('Intended Graduation Year', years));
  for (const endDate of ['', 'Spring 2028', '2029-05']) {
    const scan = await engine.scan({ ...emptyProfile(), education: [{ ...education, startDate: '2027-09', endDate }] });
    expect(scan.fields[0]).toMatchObject({ status: 'unanswered', aiEligible: false });
  }
});

test('keeps standalone education questions blank when two records could answer them', async () => {
  const engine = form('<label>University <input></label>' + select('Graduation Year', years)
    + '<label>Which university did you last attend? <input></label>');
  const second = { ...education, school: 'Another University', startDate: '', endDate: '' };
  const scan = await engine.scan({ ...emptyProfile(), education: [education, second] });
  expect(scan.fields).toHaveLength(3);
  scan.fields.forEach(field => expect(field).toMatchObject({ status: 'unanswered', aiEligible: false }));
});

test('uses a uniquely current record for current school and expected graduation questions', async () => {
  const engine = form('<label>Which university are you currently attending? <input></label>'
    + select('Expected graduation year', years));
  const previous = { ...education, school: 'Past University', endDate: '2023-09', current: false };
  const scan = await engine.scan({ ...emptyProfile(), education: [previous, { ...education, current: true }] });
  expect(scan.fields.map(field => field.value)).toEqual(['Example University', '2028']);
});

test('uses saved chronology only for a question that explicitly asks for the last institution', async () => {
  const engine = form('<label>Which university did you last attend? <input></label><label>University <input></label>');
  const latest = { ...education, startDate: '2026-09', endDate: '2028-05', current: false };
  const previous = { ...education, school: 'Past University', startDate: '2020-09', endDate: '2024-05', current: false };
  const scan = await engine.scan({ ...emptyProfile(), education: [latest, previous] });
  expect(scan.fields.map(field => field.value)).toEqual(['Example University', undefined]);
});

test('uses the same latest dated record for current-or-last school and pursuing-or-completed graduation', async () => {
  const completedYears = '<option>2018</option><option>2020</option>';
  const engine = form(`<label>${palantirUniversity}<input></label>` + select(palantirGraduation, completedYears));
  const previous = { ...education, school: 'Earlier College', startDate: '2014-09', endDate: '2018-06', current: false };
  const latest = { ...education, startDate: '2018-09', endDate: '2020-05', current: false };
  const scan = await engine.scan({ ...emptyProfile(), education: [previous, latest] });
  expect(scan.fields.map(field => field.value)).toEqual(['Example University', '2020']);
});

test('leaves both current-or-last school and pursuing-or-completed year unresolved if the latest record is ambiguous', async () => {
  const engine = form(`<label>${palantirUniversity}<input></label>` + select(palantirGraduation, years));
  const first = { ...education, current: false };
  for (const endDate of ['', '2028', '2028-05']) {
    const second = { ...education, school: 'Another University', endDate, current: false };
    const scan = await engine.scan({ ...emptyProfile(), education: [first, second] });
    expect(scan.fields.map(field => field.value)).toEqual([undefined, undefined]);
  }
});

test('never reports a future end year as a completed graduation', async () => {
  const engine = form('<label>What year did you graduate? <input type="number"></label>');
  const pastYear = new Date().getFullYear() - 1;
  const futureYear = pastYear + 2;
  for (const current of [undefined, false]) {
    const future = await engine.scan({ ...emptyProfile(), education: [{ ...education, endDate: `${futureYear}-05`, current }] });
    expect(future.fields[0]).toMatchObject({ status: 'unanswered', aiEligible: false });
    const past = await engine.scan({ ...emptyProfile(), education: [{ ...education, endDate: `${pastYear}-05`, current }] });
    expect(past.fields[0]).toMatchObject({ status: 'ready', value: String(pastYear) });
  }
});

test('an exact saved answer wins over a structured education record', async () => {
  const engine = form(select('Which university did you last attend?', '<option>Example University</option><option>Partner College</option>'));
  const scan = await engine.scan({
    ...emptyProfile(), education: [education],
    answers: [{ question: 'Which university did you last attend?', answer: 'Partner College' }],
  });
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Partner College' });
});

test('matches the compound preferred-name caption using saved preferred components', async () => {
  const engine = form('<label>Preferred Name | What would you like us to call you? <input></label>');
  const base = emptyProfile();
  const personal = { ...base.personal, firstName: 'Morgan', lastName: 'Lee' };
  const withPreferredName = await engine.scan({ ...base, personal: { ...personal, preferredFirstName: 'Mo' } });
  expect(withPreferredName.fields[0]).toMatchObject({ status: 'ready', value: 'Mo' });
  expect((await engine.scan({ ...base, personal })).fields[0]).toMatchObject({ status: 'unanswered' });
});
