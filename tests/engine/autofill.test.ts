import { beforeEach, describe, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import type { Profile } from '../../src/shared/types';

const profile: Profile = {
  schemaVersion: 1,
  personal: {
    firstName: 'Maya', lastName: 'Patel', email: 'maya@example.test', phone: '313-555-0145',
    address: '10 Main St', city: 'Detroit', state: 'Michigan', postalCode: '48201',
    country: 'United States', linkedin: 'https://example.test/maya', website: '', github: '',
  },
  employment: [
    { company: 'Studio A', title: 'Designer', location: 'Detroit', startDate: '2020-01', endDate: '', current: true, description: '' },
    { company: 'Studio B', title: 'Researcher', location: 'Chicago', startDate: '2018-03', endDate: '2020-01', current: false, description: '' },
  ],
  education: [
    { school: 'College A', degree: 'BFA', fieldOfStudy: 'Design', startDate: '', endDate: '', gpa: '' },
    { school: 'College B', degree: 'MFA', fieldOfStudy: 'Research', startDate: '', endDate: '', gpa: '' },
  ],
  answers: [],
};

function form(markup: string) {
  document.body.innerHTML = '<form>' + markup + '</form>';
  return createEngine(document);
}

function control<T extends HTMLElement = HTMLInputElement>(id: string) {
  return document.getElementById(id) as T;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('application autofill', () => {
  test('scan reads accessible labels and autocomplete without changing the page', async () => {
    const engine = form(`
      <span id="first-label">First</span><span id="name-label">name</span>
      <input id="given" aria-labelledby="first-label name-label">
      <input id="surname" autocomplete="section-profile family-name">
      <label>Email <input type="email" id="email" value="already@example.test"></label>
      <input id="unknown" data-field-path="mystery">
      <fieldset disabled><label>Phone <input id="disabled"></label></fieldset>
      <div style="display:none"><label>City <input id="hidden"></label></div>
    `);
    const changes: string[] = [];
    document.querySelector('form')?.addEventListener('input', (e) => changes.push(e.type));
    const scan = await engine.scan(profile);
    expect(scan.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'First name', status: 'ready', value: 'Maya' }),
      expect.objectContaining({ status: 'ready', value: 'Patel' }),
      expect.objectContaining({ label: 'Email', status: 'preserved', currentValue: 'already@example.test' }),
      expect.objectContaining({ status: 'unsupported' }),
    ]));
    expect(scan.fields).toHaveLength(4);
    expect(control('given').value).toBe('');
    expect(changes).toEqual([]);
  });

  test('fills selected fields with observable native events and restores them', async () => {
    const engine = form('<label>First name <input id="first"></label><label>Last name <input id="last"></label>');
    const values: string[] = [];
    const first = control('first');
    first.addEventListener('input', () => values.push('input ' + first.value));
    first.addEventListener('change', () => values.push('change ' + first.value));
    const { scanId, fields } = await engine.scan(profile);
    expect(await engine.fill(scanId, [fields[0].id])).toMatchObject({ filled: 1, failed: 0 });
    expect(first.value).toBe('Maya');
    expect(control('last').value).toBe('');
    expect(await engine.undo()).toEqual({ restored: 1, skipped: 0 });
    expect(first.value).toBe('');
    expect(values).toEqual(['input Maya', 'change Maya', 'input ', 'change ']);
  });

  test('does not write a field manually changed or replaced after preview', async () => {
    const engine = form(`
      <label>First name <input id="first" value="Existing"></label>
      <label>Last name <input id="last"></label>
      <label>Email <input id="email"></label>
    `);
    const { scanId } = await engine.scan(profile, { overwriteExisting: true });
    control('first').value = 'Manual';
    control('last').replaceWith(control('last').cloneNode());
    expect(await engine.fill(scanId)).toMatchObject({ filled: 1, skipped: 2, needsRescan: true });
    expect(control('first').value).toBe('Manual');
    expect(control('last').value).toBe('');
    expect(control('email').value).toBe('maya@example.test');
  });

  test('does not reuse an earlier preview after a rescan', async () => {
    const engine = form('<label>Email <input id="email"></label>');
    const older = await engine.scan(profile);
    const newer = await engine.scan(profile);
    expect(older.fields[0].id).toBe(newer.fields[0].id);
    expect(await engine.fill(older.scanId)).toMatchObject({ filled: 0, needsRescan: true });
    expect(control('email').value).toBe('');
  });

  test('undo preserves field edits made after filling', async () => {
    const engine = form('<label>Email <input id="email"></label><label>City <input id="city"></label>');
    const { scanId } = await engine.scan(profile);
    await engine.fill(scanId);
    control('email').value = 'my-edit@example.test';
    await engine.scan(profile);
    expect(await engine.undo()).toEqual({ restored: 1, skipped: 1 });
    expect(control('email').value).toBe('my-edit@example.test');
    expect(control('city').value).toBe('');
  });

  test('exact saved answers can fill sensitive questions, while consent and credentials stay untouched', async () => {
    const engine = form(`
      <label>Are you authorized to work in the United States? <input id="auth"></label>
      <label>Do you now require sponsorship? <input id="visa"></label>
      <label>I agree to the privacy policy <input id="consent" type="checkbox"></label>
      <label>Electronic signature <input id="signature"></label>
      <label>Account password <input id="password" type="password"></label>
      <label>What is your salary expectation? <input id="salary"></label>
    `);
    const scan = await engine.scan({ ...profile, answers: [
      { question: '  ARE YOU AUTHORIZED TO WORK IN THE UNITED STATES ', answer: 'Yes' },
      { question: 'Do you require sponsorship?', answer: 'No' },
      { question: 'I agree to the privacy policy', answer: 'Yes' },
      { question: 'Electronic signature', answer: 'Maya Patel' },
      { question: 'Account password', answer: 'secret' },
    ] });
    expect(scan.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Are you authorized to work in the United States?', status: 'ready', sensitive: true }),
      expect.objectContaining({ label: 'Do you now require sponsorship?', status: 'unanswered', sensitive: true }),
      expect.objectContaining({ label: 'What is your salary expectation?', status: 'unanswered', sensitive: true }),
    ]));
    expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
    expect(control('auth').value).toBe('Yes');
    expect(control('visa').value).toBe('');
    expect(control('consent').checked).toBe(false);
    expect(control('signature').value).toBe('');
    expect(control('password').value).toBe('');
  });

  test('reviewed answers apply to the same unanswered field and never follow a changed question', async () => {
    const engine = form(`
      <label><span id="question">Why would you like to join us?</span><textarea id="motivation"></textarea></label>
      <label>What are your pronouns? <input id="pronouns"></label>
    `);
    const first = await engine.scan(profile);
    const ids = first.fields.map((field) => field.id);
    const reviewedAnswers = { [ids[0]]: 'I enjoy product design.', [ids[1]]: 'They/them' };
    const reviewed = await engine.scan(profile, { reviewedAnswers });
    expect(reviewed.fields.map((field) => field.status)).toEqual(['ready', 'unanswered']);
    control('question').textContent = 'Why are you leaving your current role?';
    const changed = await engine.scan(profile, { reviewedAnswers });
    expect(changed.fields[0]).toMatchObject({ status: 'unanswered' });
    expect(changed.fields[0].id).not.toBe(ids[0]);
    expect(await engine.fill(reviewed.scanId)).toMatchObject({ filled: 0, needsRescan: true });
    expect(control('motivation').value).toBe('');
  });

  test('native choices resolve unique labels and preserve other forms with the same radio name', async () => {
    const engine = form(`
      <label>Country <select id="country"><option value="">Please select</option><option value="US">United States</option></select></label>
      <fieldset><legend>Do you want to be contacted?</legend>
        <label><input type="radio" name="contact" value="N" id="no" checked> No</label>
        <label><input type="radio" name="contact" value="Y" id="yes"> Yes</label>
      </fieldset>
    `);
    document.body.insertAdjacentHTML('beforeend', '<form><label><input type="radio" name="contact" value="N" id="other" checked> No</label></form>');
    const { scanId } = await engine.scan({ ...profile, answers: [{ question: 'Do you want to be contacted?', answer: 'Yes' }] }, { overwriteExisting: true });
    const results = await engine.fill(scanId);
    expect(results, JSON.stringify(results.entries)).toMatchObject({ filled: 2 });
    expect(control<HTMLSelectElement>('country').value).toBe('US');
    expect(control('yes').checked).toBe(true);
    expect(control('other').checked).toBe(true);
    expect(await engine.undo()).toEqual({ restored: 2, skipped: 0 });
    expect(control<HTMLSelectElement>('country').value).toBe('');
    expect(control('no').checked).toBe(true);
  });

  test('preserves already-entered row identity and fills other repeated rows independently', async () => {
    const engine = form(`
      <fieldset><legend>Work Experience</legend>
        <fieldset><legend>Employment 1</legend><label>Company <input id="company1" value="Studio B"></label>
        <label>Job title <input id="title1"></label></fieldset>
        <fieldset><legend>Employment 2</legend><label>Company <input id="company2"></label>
        <label>Job title <input id="title2"></label><label>I currently work here <input type="checkbox" id="current"></label></fieldset>
      </fieldset>
      <fieldset><legend>Education</legend>
        <fieldset><legend>Education 1</legend><label>School <input id="school1"></label><label>Degree <input id="degree1"></label></fieldset>
        <fieldset><legend>Education 2</legend><label>School <input id="school2"></label><label>Degree <input id="degree2"></label></fieldset>
      </fieldset>
    `);
    const { scanId } = await engine.scan(profile);
    expect(await engine.fill(scanId)).toMatchObject({ filled: 8 });
    expect(control('company1').value).toBe('Studio B');
    expect(control('title1').value).toBe('Researcher');
    expect(control('company2').value).toBe('Studio A');
    expect(control('title2').value).toBe('Designer');
    expect(control('current').checked).toBe(true);
    expect(control('school1').value).toBe('College A');
    expect(control('degree1').value).toBe('BFA');
    expect(control('school2').value).toBe('College B');
    expect(control('degree2').value).toBe('MFA');
  });

  test('a handler rejecting the planned value is reported as a failed fill', async () => {
    const engine = form('<label>Email <input id="email"></label>');
    control('email').addEventListener('change', () => { control('email').value = ''; });
    const { scanId } = await engine.scan(profile);
    expect(await engine.fill(scanId)).toMatchObject({ failed: 1, filled: 0 });
    expect(await engine.undo()).toEqual({ restored: 0, skipped: 0 });
  });

  test('does not submit a form even when a combobox lists a submit button as an option', async () => {
    const engine = form(`
      <label>Country <input id="country" role="combobox" aria-controls="list"></label>
      <div id="list" role="listbox"><button role="option">United States</button></div>
    `);
    let submits = 0;
    document.querySelector('form')?.addEventListener('submit', (event) => { event.preventDefault(); submits++; });
    const { scanId } = await engine.scan(profile);
    expect(await engine.fill(scanId)).toMatchObject({ filled: 0 });
    expect(submits).toBe(0);
  });

  test('a moved input cannot carry a plan into a different form', async () => {
    const engine = form('<label id="email-label">Email <input id="email"></label>');
    const { scanId } = await engine.scan(profile);
    const laterForm = document.createElement('form');
    document.body.append(laterForm);
    laterForm.append(control('email-label'));
    expect(await engine.fill(scanId)).toMatchObject({ filled: 0, skipped: 1 });
    expect(control('email').value).toBe('');
  });

  test('placeholder selects remain fillable and are restored on undo', async () => {
    const engine = form(`
      <label>Country <select id="country">
        <option value="placeholder" selected disabled>Select a country</option>
        <option value="US">United States</option>
      </select></label>
    `);
    const { scanId, fields } = await engine.scan(profile);
    expect(fields[0]).toMatchObject({ status: 'ready', value: 'United States' });
    expect(await engine.fill(scanId)).toMatchObject({ filled: 1 });
    expect(await engine.undo()).toMatchObject({ restored: 1 });
    expect(control<HTMLSelectElement>('country').value).toBe('placeholder');
  });

  test('multi-select verification follows document order', async () => {
    const engine = form(`
      <label>Which teams interest you? <select id="teams" multiple>
        <option value="d">Design</option><option value="e">Engineering</option>
      </select></label>
    `);
    const { scanId } = await engine.scan({
      ...profile, answers: [{ question: 'Which teams interest you?', answer: 'Engineering; Design' }],
    });
    expect(await engine.fill(scanId)).toMatchObject({ filled: 1 });
    expect([...control<HTMLSelectElement>('teams').options].map((option) => option.selected)).toEqual([true, true]);
    expect(await engine.undo()).toMatchObject({ restored: 1 });
    expect([...control<HTMLSelectElement>('teams').options].map((option) => option.selected)).toEqual([false, false]);
  });

  test('consent described via aria-describedby never becomes a saved-answer action', async () => {
    const engine = form(`
      <p id="terms">I agree to the privacy policy and authorize processing my application.</p>
      <label>Confirm <input id="confirm" type="checkbox" aria-describedby="terms"></label>
    `);
    const { scanId, fields } = await engine.scan({
      ...profile, answers: [{ question: 'Confirm', answer: 'Yes' }],
    });
    expect(fields[0]).toMatchObject({ status: 'unsupported', aiEligible: false });
    expect(await engine.fill(scanId)).toMatchObject({ filled: 0 });
    expect(control('confirm').checked).toBe(false);
  });

  test('stale work history identity prevents filling in details for another company', async () => {
    const engine = form(`
      <fieldset><legend>Work Experience</legend>
        <label>Company <input id="company" value="Studio A"></label>
        <label>Job title <input id="title"></label>
      </fieldset>
    `);
    const { scanId } = await engine.scan(profile);
    control('company').value = 'Different company';
    expect(await engine.fill(scanId)).toMatchObject({ filled: 0, skipped: 1 });
    expect(control('title').value).toBe('');
  });

  test('a label styled as an option cannot activate a separate submit control', async () => {
    const engine = form(`
      <label>Country <input id="country" role="combobox" aria-controls="options"></label>
      <div id="options" role="listbox"><label for="submit" role="option">United States</label></div>
      <input id="submit" type="submit">
    `);
    let submits = 0;
    document.querySelector('form')?.addEventListener('submit', (event) => { event.preventDefault(); submits++; });
    const { scanId, fields } = await engine.scan(profile);
    expect(fields[0]).toMatchObject({ status: 'unsupported' });
    await engine.fill(scanId);
    expect(submits).toBe(0);
  });

  test('conflicting saved answers remain unresolved and cannot be overridden by a reviewed answer', async () => {
    const engine = form('<label>Why would you like to join us? <input id="motivation"></label>');
    const withDuplicates = { ...profile, answers: [
      { question: 'Why would you like to join us?', answer: 'First answer' },
      { question: 'WHY WOULD YOU LIKE TO JOIN US', answer: 'Second answer' },
    ] };
    const first = await engine.scan(withDuplicates);
    const { scanId, fields } = await engine.scan(withDuplicates, {
      reviewedAnswers: { [first.fields[0].id]: 'Third answer' },
    });
    expect(fields[0]).toMatchObject({ status: 'unanswered', aiEligible: false });
    expect(await engine.fill(scanId)).toMatchObject({ filled: 0 });
    expect(control('motivation').value).toBe('');
  });

  test('checkbox changes are committed by a controlled click listener and restored on undo', async () => {
    const engine = form('<label>Are you open to relocation? <input id="relocate" type="checkbox"></label>');
    const input = control('relocate');
    let checked = false;
    input.addEventListener('click', () => { checked = input.checked; });
    input.addEventListener('change', () => {
      requestAnimationFrame(() => { input.checked = checked; });
    });
    const { scanId } = await engine.scan({ ...profile, answers: [
      { question: 'Are you open to relocation?', answer: 'Yes' },
    ] });
    expect(await engine.fill(scanId)).toMatchObject({ filled: 1 });
    expect(checked).toBe(true);
    expect(await engine.undo()).toMatchObject({ restored: 1 });
    expect(checked).toBe(false);
  });

  test('native radio selection and undo dispatch clicks for a controlled group', async () => {
    const engine = form(`
      <fieldset><legend>Which team would you prefer?</legend>
        <label><input type="radio" name="team" value="design" id="design"> Design</label>
        <label><input type="radio" name="team" value="research" id="research" checked> Research</label>
      </fieldset>
    `);
    const group = document.querySelector('fieldset')!;
    let selected = 'research';
    group.addEventListener('click', (event) => {
      const input = event.target as HTMLInputElement;
      if (input.checked) selected = input.value;
    });
    group.addEventListener('change', () => {
      requestAnimationFrame(() => { control(selected).checked = true; });
    });
    const { scanId } = await engine.scan({ ...profile, answers: [
      { question: 'Which team would you prefer?', answer: 'Design' },
    ] }, { overwriteExisting: true });
    expect(await engine.fill(scanId)).toMatchObject({ filled: 1 });
    expect(selected).toBe('design');
    expect(await engine.undo()).toMatchObject({ restored: 1 });
    expect(selected).toBe('research');
  });

  test('undo to an initially empty radio group notifies its controlled click listener', async () => {
    const engine = form(`
      <fieldset><legend>Which team would you prefer?</legend>
        <label><input type="radio" name="team" value="design" id="design"> Design</label>
        <label><input type="radio" name="team" value="research" id="research"> Research</label>
      </fieldset>
    `);
    const group = document.querySelector('fieldset')!;
    let selected = '';
    group.addEventListener('click', (event) => {
      const input = event.target as HTMLInputElement;
      selected = input.checked ? input.value : '';
    });
    group.addEventListener('change', () => {
      requestAnimationFrame(() => {
        for (const radio of group.querySelectorAll('input')) radio.checked = selected === radio.value;
      });
    });
    const { scanId } = await engine.scan({ ...profile, answers: [
      { question: 'Which team would you prefer?', answer: 'Design' },
    ] });
    expect(await engine.fill(scanId)).toMatchObject({ filled: 1 });
    expect(selected).toBe('design');
    expect(await engine.undo()).toMatchObject({ restored: 1 });
    expect(selected).toBe('');
    expect(control('design').checked).toBe(false);
    expect(control('research').checked).toBe(false);
  });

  test('undo is scoped to the fill operation requested by the caller', async () => {
    const engine = form('<label>Email <input id="email"></label>');
    const { scanId } = await engine.scan(profile);
    await engine.fill(scanId);
    const other = await engine.scan(profile);
    expect(await engine.undo(other.scanId)).toEqual({ restored: 0, skipped: 0 });
    expect(control('email').value).toBe('maya@example.test');
    expect(await engine.undo(scanId)).toEqual({ restored: 1, skipped: 0 });
    expect(control('email').value).toBe('');
  });

  test('accepting a data processing statement requires direct applicant action', async () => {
    const engine = form('<label>Do you accept the applicant data processing statement? <input id="processing" type="checkbox"></label>');
    const { scanId, fields } = await engine.scan({ ...profile, answers: [
      { question: 'Do you accept the applicant data processing statement?', answer: 'Yes' },
    ] });
    expect(fields[0]).toMatchObject({ status: 'unsupported', aiEligible: false });
    expect(await engine.fill(scanId)).toMatchObject({ filled: 0 });
    expect(control('processing').checked).toBe(false);
  });

  test('a visible cover letter label takes precedence over resume-like file metadata', async () => {
    const engine = form('<label>Cover letter <input type="file" name="resume"></label>');
    const { fields } = await engine.scan(profile);
    expect(fields[0]).toMatchObject({ kind: 'file', status: 'unsupported', aiEligible: false });
  });

  test('native sanitization cannot discard an existing answer during overwrite', async () => {
    const engine = form(`
      <label>How many projects? <input id="projects" type="number" value="7"></label>
      <label>Which skills? <input id="skills" value="Existing skills"></label>
    `);
    const { scanId, fields } = await engine.scan({ ...profile, answers: [
      { question: 'How many projects?', answer: '+42' },
      { question: 'Which skills?', answer: 'First skill\nSecond skill' },
    ] }, { overwriteExisting: true });
    expect(fields.map((field) => field.status)).toEqual(['unanswered', 'unanswered']);
    expect(await engine.fill(scanId)).toMatchObject({ filled: 0 });
    expect(control('projects').value).toBe('7');
    expect(control('skills').value).toBe('Existing skills');
  });
});
