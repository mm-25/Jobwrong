import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const primary = 'Bachelor of Technology';
const alternatives = ['Bachelor of Engineering', 'Bachelor of Science'];
function candidate() {
  return { ...emptyProfile(), education: [{ school: 'Example Institute', degree: primary,
    degreeAlternatives: alternatives, fieldOfStudy: '', startDate: '', endDate: '', gpa: '3.8' }] };
}
function application(options?: string[]) {
  document.body.innerHTML = `<fieldset><legend>Education</legend><label>School<input value="Example Institute"></label>
    <label>Degree${options ? '<select><option value=""></option>' + options.map(option => `<option>${option}</option>`).join('') + '</select>' : '<input>'}</label></fieldset>`;
  return createEngine(document);
}
afterEach(() => document.body.replaceChildren());

test.each(['B.Tech.', 'BTech', 'Bachelor of Technology (B.Tech.)'])('recognizes %s as the primary award', async label => {
  const engine = application(['Bachelor of Science', 'Bachelor of Engineering', label]);
  const scan = await engine.scan(candidate());
  expect(scan.fields.find(field => field.label === 'Degree')).toMatchObject({ status: 'ready', value: label });
});

test.each([
  [['Bachelor of Science', 'Bachelor of Engineering'], 'Bachelor of Engineering'],
  [['Bachelor of Arts', 'Bachelor of Science'], 'Bachelor of Science'],
  [["Bachelor's Degree", 'Bachelor of Engineering'], "Bachelor's Degree"],
])('uses the configured order or primary generic level in %j', async (options, expected) => {
  const engine = application(options as string[]);
  const scan = await engine.scan(candidate());
  expect(scan.fields.find(field => field.label === 'Degree')).toMatchObject({ status: 'ready', value: expected });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
});

test('keeps the actual award in a free-text field', async () => {
  const scan = await application().scan(candidate());
  expect(scan.fields.find(field => field.label === 'Degree')).toMatchObject({ status: 'ready', value: primary });
});

test.each([
  ['BTech', 'B.Tech.', 'Bachelor of Engineering'],
  ['BEng', 'B.Eng.', 'Bachelor of Science'],
].map(options => ({ options })))('does not fall through an ambiguous preferred award in $options', async ({ options }) => {
  const scan = await application(options).scan(candidate());
  expect(scan.fields.find(field => field.label === 'Degree')?.status).toBe('unanswered');
});

test('does not use an unapproved alternative and retains exact saved-answer precedence', async () => {
  const engine = application(alternatives);
  const plain = candidate();
  plain.education[0].degreeAlternatives = [];
  expect((await engine.scan(plain)).fields.find(field => field.label === 'Degree')?.status).toBe('unanswered');
  const saved = { ...candidate(), answers: [{ question: 'Degree', answer: 'Bachelor of Science' }] };
  expect((await engine.scan(saved)).fields.find(field => field.label === 'Degree')).toMatchObject({ status: 'ready', value: 'Bachelor of Science' });
});

test('recognizes a configured alternative in an existing Workday row without changing it', async () => {
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage"><div role="group" aria-labelledby="Education-section">
    <h4 id="Education-section">Education</h4><div role="group" aria-labelledby="Education-1-panel"><h5 id="Education-1-panel">Education 1</h5>
    <label>School<input id="education-5--schoolName" value="Example Institute"></label>
    <label>Degree<input id="education-5--degree" value="Bachelor of Engineering"></label>
    <label>GPA<input id="education-5--gpa"></label></div></div></main>`;
  const engine = createEngine(document);
  const scan = await engine.scan(candidate());
  expect(scan.fields.find(field => field.label === 'GPA')).toMatchObject({ status: 'ready', value: '3.8' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect((document.getElementById('education-5--degree') as HTMLInputElement).value).toBe('Bachelor of Engineering');
});
