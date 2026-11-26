import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

function application(markup: string) {
  document.body.innerHTML = '<form>' + markup + '</form>';
  return createEngine(document);
}

function checkbox(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

test('discovers a concealed resume file input only through its visible, associated label', async () => {
  const engine = application(`
    <label for="resume">Resume / CV *</label>
    <input id="resume" name="resume" type="file" hidden>
    <input id="orphaned" name="resume-other" type="file" hidden aria-label="Resume">
    <label for="disabled">Resume</label>
    <input id="disabled" name="resume-disabled" type="file" hidden disabled>
    <label for="hidden-area">Resume</label>
    <div hidden><input id="hidden-area" name="resume-stale" type="file" hidden></div>
    <label for="inert-upload">Resume</label>
    <input id="inert-upload" name="resume-inert" type="file" inert hidden>
  `);

  const scan = await engine.scan(emptyProfile());

  expect(scan.fields).toEqual([
    expect.objectContaining({ label: 'Resume / CV', kind: 'file', required: true, status: 'unanswered' }),
  ]);
});

test('fills a labeled native checkbox group with exact choices and restores prior selections', async () => {
  const engine = application(`
    <fieldset>
      <legend>Which office locations work for you? *</legend>
      <label><input type="checkbox" name="locations[]" value="detroit" id="detroit" checked> Detroit</label>
      <label><input type="checkbox" name="locations[]" value="nyc" id="nyc"> New York</label>
      <label><input type="checkbox" name="locations[]" value="remote" id="remote"> Remote</label>
    </fieldset>
    <label><input type="checkbox" name="extra" id="extra"> Notify me about future roles</label>
  `);
  const profile = {
    ...emptyProfile(),
    answers: [{ question: 'Which office locations work for you?', answer: 'New York\nremote' }],
  };

  const scan = await engine.scan(profile, { overwriteExisting: true });
  expect(scan.fields).toEqual([
    expect.objectContaining({
      label: 'Which office locations work for you?', required: true, kind: 'checkbox',
      options: ['Detroit', 'New York', 'Remote'], status: 'ready', value: ['New York', 'Remote'], currentValue: 'Detroit',
    }),
    expect.objectContaining({ label: 'Notify me about future roles', status: 'unanswered' }),
  ]);

  expect(await engine.fill(scan.scanId, [scan.fields[0].id])).toMatchObject({ filled: 1, failed: 0 });
  expect([checkbox('detroit').checked, checkbox('nyc').checked, checkbox('remote').checked, checkbox('extra').checked])
    .toEqual([false, true, true, false]);

  expect(await engine.undo()).toMatchObject({ restored: 1, skipped: 0 });
  expect([checkbox('detroit').checked, checkbox('nyc').checked, checkbox('remote').checked])
    .toEqual([true, false, false]);
});

test('skips a group when an option or its protected purpose changes after preview', async () => {
  const engine = application(`
    <fieldset>
      <legend>Which offices work for you?</legend>
      <input type="checkbox" name="location" value="detroit" id="detroit"><label for="detroit">Detroit</label>
      <input type="checkbox" name="location" value="remote" id="remote"><label for="remote">Remote</label>
    </fieldset>
  `);
  const profile = {
    ...emptyProfile(),
    answers: [{ question: 'Which offices work for you?', answer: 'Remote' }],
  };

  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready' });
  document.querySelector('label[for="detroit"]')!.textContent = 'I Accept';
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, skipped: 1 });
  expect(checkbox('remote').checked).toBe(false);

  const changed = await engine.scan(profile);
  expect(changed.fields[0]).toMatchObject({ status: 'unsupported' });
});

test('restores earlier changes when a checkbox group rejects a later selection', async () => {
  const engine = application(`
    <fieldset>
      <legend>Available shifts</legend>
      <label><input type="checkbox" name="shift" id="morning" value="morning">Morning</label>
      <label><input type="checkbox" name="shift" id="evening" value="evening">Evening</label>
    </fieldset>
  `);
  checkbox('evening').addEventListener('click', (event) => event.preventDefault());
  const profile = { ...emptyProfile(), answers: [{ question: 'Available shifts', answer: 'Morning; Evening' }] };
  const scan = await engine.scan(profile);
  expect(scan.fields[0].status).toBe('ready');

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect([checkbox('morning').checked, checkbox('evening').checked]).toEqual([false, false]);
});

test('restores earlier changes when a selection opens an additional checkbox choice', async () => {
  const engine = application(`
    <fieldset>
      <legend>Available shifts</legend>
      <label><input type="checkbox" name="shift" id="morning" value="morning">Morning</label>
      <label><input type="checkbox" name="shift" id="evening" value="evening">Evening</label>
    </fieldset>
  `);
  checkbox('morning').addEventListener('change', () => {
    if (checkbox('morning').checked && !document.getElementById('weekend')) {
      document.querySelector('fieldset')!.insertAdjacentHTML('beforeend',
        '<label><input type="checkbox" name="shift" id="weekend" value="weekend">Weekend</label>');
    }
  });
  const profile = { ...emptyProfile(), answers: [{ question: 'Available shifts', answer: 'Morning; Evening' }] };
  const scan = await engine.scan(profile);
  expect(scan.fields[0].status).toBe('ready');

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect([checkbox('morning').checked, checkbox('evening').checked, checkbox('weekend').checked])
    .toEqual([false, false, false]);
});

test('uses local section names to distinguish citizenship from a residence country', async () => {
  const country = '<option value="">Select</option><option value="CA">Canada</option>';
  const engine = application(`
    <section aria-labelledby="citizenship-title">
      <h2 id="citizenship-title">Citizenship</h2>
      <fieldset><label>Country<select id="country-a">${country}</select></label></fieldset>
    </section>
    <div role="region" aria-label="Nationality">
      <div role="group" aria-label="Country details">
        <label>Country<select id="country-b">${country}</select></label>
      </div>
    </div>
    <section>
      <h2>Country of citizenship</h2>
      <label>Country<select id="country-c">${country}</select></label>
    </section>
    <section aria-label="Contact information">
      <fieldset><legend>Residence</legend><label>Country<select id="residence">${country}</select></label></fieldset>
      <div><h3>Citizenship</h3><p>Refer to the eligibility section for citizenship information.</p></div>
    </section>
  `);
  const profile = emptyProfile();
  profile.personal.country = 'Canada';

  const scan = await engine.scan(profile);
  expect(scan.fields).toEqual([
    ...Array.from({ length: 3 }, () => expect.objectContaining({ status: 'unanswered', sensitive: true, aiEligible: false })),
    expect.objectContaining({ status: 'ready', value: 'Canada' }),
  ]);

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  const value = (id: string) => (document.getElementById(id) as HTMLSelectElement).value;
  expect(['country-a', 'country-b', 'country-c', 'residence'].map(value)).toEqual(['', '', '', 'CA']);
});

test('refuses ambiguous checkbox group choices without choosing a partial answer', async () => {
  const engine = application(`
    <fieldset>
      <legend>Available shifts</legend>
      <label><input type="checkbox" name="shift" value="morning-a" id="morning-a">Morning</label>
      <label><input type="checkbox" name="shift" value="morning-b" id="morning-b">Morning</label>
      <label><input type="checkbox" name="shift" value="evening" id="evening">Evening</label>
    </fieldset>
  `);
  const profile = { ...emptyProfile(), answers: [{ question: 'Available shifts', answer: 'Morning; Evening' }] };
  const scan = await engine.scan(profile);

  expect(scan.fields[0]).toMatchObject({ label: 'Available shifts', status: 'unanswered' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(checkbox('evening').checked).toBe(false);
});

test('shows custom controls as manual without duplicating a nested native input or its listbox', async () => {
  const engine = application(`
    <div role="textbox" contenteditable="true" aria-label="Portfolio summary" aria-required="true"></div>
    <button type="button" role="switch" aria-label="Willing to travel" aria-checked="false">Off</button>
    <div role="checkbox" aria-label="Certified trainer" aria-checked="false" tabindex="0"></div>
    <div role="radiogroup" aria-label="Preferred schedule">
      <div role="radio" aria-checked="false" tabindex="0">Morning</div>
      <div role="radio" aria-checked="false" tabindex="-1">Evening</div>
    </div>
    <div role="textbox"><label>First name<input id="first" autocomplete="given-name"></label></div>
    <input id="country" role="combobox" aria-label="Country" aria-controls="country-options" aria-expanded="true">
    <div role="listbox" id="country-options"><div role="option">Canada</div></div>
    <button type="button" aria-label="Working hours" aria-haspopup="listbox" aria-controls="hours">Select</button>
    <div role="listbox" id="hours"><div role="option">Full time</div></div>
    <input aria-label="Nearest airport" aria-haspopup="listbox">
    <div role="listbox" aria-label="Favorite programming language" tabindex="0"><div role="option">Python</div></div>
    <section hidden><div role="textbox" contenteditable="true" aria-label="Hidden notes"></div></section>
  `);
  const profile = emptyProfile();
  profile.personal.firstName = 'Lin';
  profile.answers = [
    { question: 'Portfolio summary', answer: 'Example description' },
    { question: 'Willing to travel', answer: 'yes' },
    { question: 'Nearest airport', answer: 'DTW' },
  ];

  const scan = await engine.scan(profile);
  const manual = scan.fields.filter((field) => field.status === 'unsupported');
  expect(manual.map((field) => field.label)).toEqual([
    'Portfolio summary', 'Willing to travel', 'Certified trainer', 'Preferred schedule', 'Working hours', 'Nearest airport',
    'Favorite programming language',
  ]);
  expect(manual.every((field) => field.aiEligible === false)).toBe(true);
  expect(manual[0].required).toBe(true);
  expect(scan.fields).toHaveLength(9);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(checkbox('first').value).toBe('Lin');
  expect(document.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  expect(document.querySelector('[contenteditable]')?.textContent).toBe('');
});
