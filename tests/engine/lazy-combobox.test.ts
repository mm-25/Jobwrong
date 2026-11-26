import { expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const profile = emptyProfile();
profile.personal.country = 'United States';

function countryForm({
  options = ['United States Minor Outlying Islands', 'United States', 'Canada'],
  delay = 0,
  onOpen,
  keyboardOnly = false,
  retainSelection = true,
  initialSelection = '',
}: {
  options?: string[];
  delay?: number;
  onOpen?: (input: HTMLInputElement, label: HTMLLabelElement) => void;
  keyboardOnly?: boolean;
  retainSelection?: boolean;
  initialSelection?: string;
} = {}) {
  document.body.innerHTML = `
    <form>
      <div class="field">
        <label for="gh-country_short_name">Country*</label>
        <div class="typeahead-control">
          <input id="gh-country_short_name" type="text" role="combobox" aria-autocomplete="list"
            aria-controls="gh-country_short_name-listbox" aria-expanded="false"
            placeholder="Select..." name="country_short_name" value="">
          <button id="toggle" type="button" class="typeahead-indicator"
            aria-label="Toggle country_short_name options"></button>
          <button id="unrelated" type="button" aria-label="Show applicant help"></button>
        </div>
      </div>
      <div id="unrelated-list" role="listbox"><button type="button" role="option">United States</button></div>
      <button id="submit">Submit application</button>
    </form>
  `;
  const form = document.querySelector('form')!;
  const input = form.querySelector('input')!;
  const label = form.querySelector('label')!;
  const toggle = form.querySelector<HTMLButtonElement>('#toggle')!;
  const listId = input.getAttribute('aria-controls')!;
  const events: string[] = [];
  let selected = initialSelection;
  input.value = initialSelection;
  let menu: HTMLElement | undefined;
  let render: number | undefined;

  function close() {
    window.clearTimeout(render);
    menu?.remove();
    menu = undefined;
    input.setAttribute('aria-expanded', 'false');
  }

  function showOptions() {
    menu = document.createElement('div');
    menu.id = listId;
    menu.className = 'typeahead-menu';
    menu.setAttribute('role', 'listbox');
    for (const text of options) {
      const option = document.createElement('button');
      option.type = 'button';
      option.textContent = text;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.addEventListener('click', () => {
        if (!retainSelection) return;
        selected = text;
        input.value = text;
        close();
      });
      menu.append(option);
    }
    input.parentElement!.after(menu);
  }

  function open() {
    if (input.getAttribute('aria-expanded') === 'true') {
      close();
      return;
    }
    input.setAttribute('aria-expanded', 'true');
    onOpen?.(input, label);
    if (delay) render = window.setTimeout(showOptions, delay);
    else showOptions();
  }
  toggle.addEventListener('click', open);
  if (keyboardOnly) toggle.remove();
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && keyboardOnly) open();
    if (event.key === 'Escape') close();
  });
  form.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    events.push('click ' + (target.id || target.textContent));
  }, true);
  form.addEventListener('input', () => events.push('input'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    events.push('submit');
  });

  return { engine: createEngine(document), input, toggle, events, listId, selected: () => selected };
}

test('previews a required lazy country field without activating any control', async () => {
  const { engine, input, events, listId } = countryForm();
  const { fields } = await engine.scan(profile);
  expect(fields).toEqual([
    expect.objectContaining({ label: 'Country', required: true, status: 'ready', value: 'United States' }),
  ]);
  expect(input.value).toBe('');
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(document.getElementById(listId)).toBeNull();
  expect(events).toEqual([]);
});

test('activates the country toggle and selects only the exact option from its list', async () => {
  const { engine, input, events, selected } = countryForm();
  const { scanId } = await engine.scan(profile);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(selected()).toBe('United States');
  expect(input.value).toBe('United States');
  expect(events).toEqual(['click toggle', 'click United States']);
});

test('waits for lazily rendered options to become available', async () => {
  const { engine, selected } = countryForm({ delay: 60 });
  const { scanId } = await engine.scan(profile);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(selected()).toBe('United States');
});

test('allows a user-opened menu after preview when the original answer is untouched', async () => {
  const { engine, toggle, events, selected } = countryForm();
  const { scanId } = await engine.scan(profile);
  toggle.click();
  expect(await engine.fill(scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(selected()).toBe('United States');
  expect(events).toEqual(['click toggle', 'click United States']);
});

test('leaves a user-opened menu alone when its exact choice is ambiguous', async () => {
  const { engine, input, toggle, events, selected } = countryForm({ options: ['United States', 'United States'] });
  const { scanId } = await engine.scan(profile);
  toggle.click();
  expect(await engine.fill(scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(selected()).toBe('');
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(events).toEqual(['click toggle']);
});

test('reopens a menu that was open at preview to find its planned choice', async () => {
  const { engine, toggle, selected } = countryForm();
  toggle.click();
  const { scanId, fields } = await engine.scan(profile);
  expect(fields[0].options).toContain('United States');
  toggle.click();
  expect(await engine.fill(scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(selected()).toBe('United States');
});

test('rejects a newly ambiguous answer even if the previewed option still exists', async () => {
  const { engine, toggle, listId, selected } = countryForm();
  toggle.click();
  const { scanId } = await engine.scan(profile);
  const options = Array.from(document.getElementById(listId)!.querySelectorAll<HTMLElement>('[role="option"]'));
  options.find((item) => item.textContent === 'Canada')!.dataset.value = 'United States';
  expect(await engine.fill(scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(selected()).toBe('');
});

test('undo restores the previous exact choice when it must reopen a lazy menu', async () => {
  const { engine, input, selected } = countryForm({ initialSelection: 'Canada', delay: 40 });
  const { scanId } = await engine.scan(profile, { overwriteExisting: true });
  expect(await engine.fill(scanId)).toMatchObject({ filled: 1 });
  expect(selected()).toBe('United States');
  expect(await engine.undo(scanId)).toEqual({ restored: 1, skipped: 0 });
  expect(selected()).toBe('Canada');
  expect(input.value).toBe('Canada');
});

test('undo skips when the previous choice is ambiguous in the reopened menu', async () => {
  const { engine, input, selected } = countryForm({
    initialSelection: 'Canada', options: ['United States', 'Canada', 'Canada'],
  });
  const { scanId } = await engine.scan(profile, { overwriteExisting: true });
  expect(await engine.fill(scanId)).toMatchObject({ filled: 1 });
  expect(await engine.undo(scanId)).toEqual({ restored: 0, skipped: 1 });
  expect(selected()).toBe('United States');
  expect(input.getAttribute('aria-expanded')).toBe('false');
});

test('undo to a blank value never clicks an unrelated Remove button', async () => {
  const { engine, input, events } = countryForm();
  document.querySelector('#unrelated')?.setAttribute('aria-label', 'Remove');
  const { scanId } = await engine.scan(profile);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 1 });
  expect(await engine.undo(scanId)).toEqual({ restored: 0, skipped: 1 });
  expect(input.value).toBe('United States');
  expect(events).toEqual(['click toggle', 'click United States']);
});

test('opens a lazy combobox using its own keyboard activation when it has no toggle', async () => {
  const { engine, selected } = countryForm({ keyboardOnly: true });
  const { scanId } = await engine.scan(profile);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(selected()).toBe('United States');
});

test.each([
  ['missing', ['Canada', 'United States Minor Outlying Islands']],
  ['ambiguous', ['United States', 'United States']],
])('leaves the country blank when the exact option is %s', async (_case, options) => {
  const { engine, input, events, selected } = countryForm({ options });
  const { scanId } = await engine.scan(profile);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(input.value).toBe('');
  expect(selected()).toBe('');
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(events).toEqual(['click toggle', 'click toggle']);
});

test('preserves a manual edit made while opening the menu', async () => {
  const { engine, input, selected } = countryForm({
    delay: 40,
    onOpen: (input) => window.setTimeout(() => {
      input.value = 'Canada';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 20),
  });
  const { scanId } = await engine.scan(profile);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(input.value).toBe('Canada');
  expect(selected()).toBe('');
});

test('detects a manual input event even when the same value remains', async () => {
  const { engine, selected } = countryForm({
    onOpen: (input) => { input.dispatchEvent(new Event('input', { bubbles: true })); },
  });
  const { scanId } = await engine.scan(profile);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(selected()).toBe('');
});

test('does not use the country answer when the question changes on open', async () => {
  const { engine, input, selected } = countryForm({
    onOpen: (_input, label) => { label.textContent = 'Country of citizenship*'; },
  });
  const { scanId } = await engine.scan(profile);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(input.value).toBe('');
  expect(selected()).toBe('');
});

test('closes the opened menu when the application does not commit the option', async () => {
  const { engine, input, events } = countryForm({ retainSelection: false });
  const { scanId } = await engine.scan(profile);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(input.value).toBe('');
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(events).toEqual(['click toggle', 'click United States', 'click toggle']);
});

test.each([
  [true, 1, 0, 'United States'],
  [false, 0, 1, ''],
])('verifies committing an exact query even when the displayed value is unchanged', async (retainSelection, filled, failed, committed) => {
  const { engine, input, toggle, events, selected } = countryForm({ retainSelection });
  toggle.click();
  input.value = 'United States';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const { scanId } = await engine.scan(profile, { overwriteExisting: true });
  expect(await engine.fill(scanId)).toMatchObject({ filled, failed });
  expect(selected()).toBe(committed);
  expect(events).toEqual(['click toggle', 'input', 'click United States']);
});

test('shows a missing profile answer without opening the closed menu', async () => {
  const { engine, events } = countryForm();
  const { fields } = await engine.scan(emptyProfile());
  expect(fields[0]).toMatchObject({ status: 'unanswered', reason: expect.stringContaining('profile') });
  expect(events).toEqual([]);
});

test('detects required attributes and an associated visual asterisk', async () => {
  document.body.innerHTML = `
    <form>
      <label>Name <input required></label>
      <label>Email <input aria-required="true"></label>
      <label for="phone">Phone<span aria-hidden="true">*</span></label><input id="phone">
      <label>City <input aria-required="false"></label>
    </form>
  `;
  const { fields } = await createEngine(document).scan(profile);
  expect(fields.map(({ label, required }) => [label, !!required])).toEqual([
    ['Name', true], ['Email', true], ['Phone', true], ['City', false],
  ]);
});

function resumeForm() {
  document.body.innerHTML = `
    <form>
      <div class="field">
        <label class="labell" for="gh-resume">Resume/CV<span class="required">*</span></label>
        <div class="control"><span class="hint">Upload a file</span><input id="gh-resume" type="file" name="resume"></div>
        <div class="control"><span class="hint">Or paste as text</span><textarea id="gh-resume_text-alt" name="resume_text"></textarea></div>
      </div>
    </form>
  `;
  return {
    engine: createEngine(document), file: document.querySelector('input')!, text: document.querySelector('textarea')!,
  };
}

test('shows a resume upload and its paste alternative separately', async () => {
  const { engine } = resumeForm();
  const { fields } = await engine.scan(profile);
  expect(fields.map(({ label, kind, required }) => [label, kind, !!required])).toEqual([
    ['Resume/CV', 'file', true], ['Resume/CV (paste as text)', 'text', false],
  ]);
});

test('treats a pasted resume as satisfying the upload without showing resume contents', async () => {
  const { engine, text } = resumeForm();
  text.value = 'Private resume text';
  const { fields } = await engine.scan(profile);
  expect(fields[0]).toMatchObject({ status: 'preserved', reason: 'Resume already supplied as text.' });
  expect(fields[1].status).toBe('preserved');
  expect(JSON.stringify(fields)).not.toContain('Private resume text');
});

test('treats a selected resume file as satisfying the blank paste alternative', async () => {
  const { engine, file } = resumeForm();
  Object.defineProperty(file, 'files', { value: [new File(['resume'], 'stored.pdf', { type: 'application/pdf' })] });
  const { fields } = await engine.scan(profile);
  expect(fields[1]).toMatchObject({ status: 'preserved', reason: 'Resume already supplied as a file.' });
});

test('skips the planned attachment if a resume is pasted after preview', async () => {
  const { engine, file, text } = resumeForm();
  vi.stubGlobal('DataTransfer', class {});
  try {
    const { scanId, fields } = await engine.scan({
      ...profile,
      resume: { name: 'stored.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,YQ==', lastModified: 1 },
    });
    expect(fields[0]).toMatchObject({ status: 'ready' });
    text.value = 'Resume pasted after preview';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    expect(await engine.fill(scanId)).toMatchObject({ filled: 0, skipped: 1, failed: 0 });
    expect(file.files).toHaveLength(0);
    expect(text.value).toBe('Resume pasted after preview');
  } finally {
    vi.unstubAllGlobals();
  }
});

test('routes an acceptance checkbox to the applicant even when its label only says I Accept', async () => {
  document.body.innerHTML = `
    <form><div class="checkbox-group">
      <label class="checkbox"><input type="checkbox" id="accept">I Accept</label>
    </div></form>
  `;
  const engine = createEngine(document);
  const { fields, scanId } = await engine.scan({
    ...profile,
    answers: [{ question: 'I Accept', answer: 'Yes' }],
  });
  expect(fields[0]).toMatchObject({ status: 'unsupported', sensitive: true });
  expect(await engine.fill(scanId)).toMatchObject({ filled: 0 });
  expect(document.querySelector('input')?.checked).toBe(false);
});

test('counts the required marker for the only control in its enclosing field', async () => {
  document.body.innerHTML = `
    <form>
      <div class="field">
        <label>Read the applicant privacy policy.<span class="required">*</span></label>
        <div class="checkbox-group">
          <label class="checkbox"><input type="checkbox">I Accept</label>
        </div>
      </div>
    </form>
  `;
  const { fields } = await createEngine(document).scan(profile);
  expect(fields[0]).toMatchObject({ label: 'I Accept', required: true, status: 'unsupported' });
});

test('counts manually completed protected controls without exposing values or allowing overwrite', async () => {
  document.body.innerHTML = `
    <form>
      <label><input id="accept" type="checkbox" required>I Accept</label>
      <label>Portfolio Password <input id="password" type="text" value="private-example"></label>
    </form>
  `;
  const engine = createEngine(document);
  const accept = document.querySelector<HTMLInputElement>('#accept')!;
  const password = document.querySelector<HTMLInputElement>('#password')!;
  const withAnswers = { ...profile, answers: [
    { question: 'I Accept', answer: 'No' }, { question: 'Portfolio Password', answer: 'new-example' },
  ] };
  expect((await engine.scan(withAnswers)).fields[0].status).toBe('unsupported');
  accept.click();
  const { fields, scanId } = await engine.scan(withAnswers, { overwriteExisting: true });
  expect(fields.map(({ status }) => status)).toEqual(['preserved', 'preserved']);
  for (const field of fields) expect(field).not.toHaveProperty('currentValue');
  expect(JSON.stringify(fields)).not.toContain('private-example');
  expect(await engine.fill(scanId, fields.map(({ id }) => id))).toMatchObject({ filled: 0, skipped: 2 });
  expect(accept.checked).toBe(true);
  expect(password.value).toBe('private-example');
});
