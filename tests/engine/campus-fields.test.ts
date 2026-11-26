import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const profile = { ...emptyProfile(), education: [{
  school: 'University of Michigan', campus: 'Ann Arbor', degree: 'MS', fieldOfStudy: 'Information',
  startDate: '2024', endDate: '2026', current: true, gpa: '',
}] };
const options = '<option value="">Select...</option><option>New York Medical College</option><option>University of Michigan - Dearborn</option><option>University of Michigan - Ann Arbor</option><option>University of Michigan - Flint</option>';

test('fills the known campus for Palantir wording despite other campuses and medical institution options', async () => {
  document.body.innerHTML = `<form><label>Which university are you currently attending or did you last attend? Please select "Other (School Not Listed)" if your school is not listed.<select>${options}</select></label></form>`;
  const engine = createEngine(document);
  const plan = await engine.scan(profile);
  expect(plan.fields[0]).toMatchObject({ status: 'ready', value: 'University of Michigan - Ann Arbor' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector('select')?.value).toBe('University of Michigan - Ann Arbor');
});

test('uses the same campus resolver for repeated education rows', async () => {
  document.body.innerHTML = `<form><fieldset><legend>Education</legend><label>School<select>${options}</select></label></fieldset></form>`;
  const engine = createEngine(document);
  const plan = await engine.scan(profile);
  expect(plan.fields[0]).toMatchObject({ status: 'ready', value: 'University of Michigan - Ann Arbor' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1 });
});

test('uses the visible school caption even when another option reuses that text as a machine value', async () => {
  document.body.innerHTML = `<form><label>University<select><option value="">Select...</option><option value="umich">University of Michigan - Ann Arbor</option><option value="University of Michigan - Ann Arbor">Different University</option></select></label></form>`;
  const engine = createEngine(document);
  const plan = await engine.scan(profile);
  expect(plan.fields[0]).toMatchObject({ status: 'ready', value: 'University of Michigan - Ann Arbor' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector('select')?.value).toBe('umich');
});

test('matches an already-selected campus back to its education record after resume parsing', async () => {
  document.body.innerHTML = `<form><fieldset><legend>Education</legend>
    <label>School<select><option selected>University of Michigan - Ann Arbor</option><option>University of Michigan - Dearborn</option></select></label>
    <label>Degree<input id="degree"></label><label>Field of study<input id="study"></label>
  </fieldset></form>`;
  const engine = createEngine(document);
  const plan = await engine.scan(profile);
  expect(plan.fields[0]).toMatchObject({ status: 'preserved' });
  expect(plan.fields.slice(1).map(field => field.value)).toEqual(['MS', 'Information']);
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 2 });
  expect(document.querySelector<HTMLInputElement>('#study')?.value).toBe('Information');
});

test('does not attach Ann Arbor degree details to an existing Dearborn school row', async () => {
  document.body.innerHTML = `<form><fieldset><legend>Education</legend>
    <label>School<select><option selected>University of Michigan - Dearborn</option></select></label>
    <label>Degree<input></label></fieldset></form>`;
  const fields = (await createEngine(document).scan(profile)).fields;
  expect(fields[0]).toMatchObject({ status: 'preserved' });
  expect(fields[1]).toMatchObject({ status: 'unanswered' });
});

test('leaves a preselected broad school row ambiguous when two saved campuses compete', async () => {
  document.body.innerHTML = `<form><fieldset><legend>Education</legend>
    <label>School<select><option selected>University of Michigan</option></select></label>
    <label>Degree<input></label></fieldset></form>`;
  const p = { ...profile, education: [profile.education[0], { ...profile.education[0], campus: 'Dearborn', degree: 'BS' }] };
  expect((await createEngine(document).scan(p)).fields[1]).toMatchObject({ status: 'unanswered' });
});

test('does not resolve an ambiguous school by eliminating a campus used by another row', async () => {
  document.body.innerHTML = `<form><fieldset><legend>Education</legend>
    <label>School<select><option selected>University of Michigan - Ann Arbor</option></select></label>
    <label>Degree<input></label></fieldset>
    <fieldset><legend>Education</legend>
    <label>School<select><option selected>University of Michigan</option></select></label>
    <label>Degree<input></label></fieldset></form>`;
  const p = { ...profile, education: [profile.education[0], { ...profile.education[0], campus: 'Flint', degree: 'BS' }] };
  const engine = createEngine(document);
  const plan = await engine.scan(p);
  expect(plan.fields[1]).toMatchObject({ status: 'ready', value: 'MS' });
  expect(plan.fields[3]).toMatchObject({ status: 'unanswered' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1 });
  expect([...document.querySelectorAll('input')].map(input => input.value)).toEqual(['MS', '']);
});
