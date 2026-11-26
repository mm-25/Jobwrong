import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const query = 'Detroit, Michigan';
const location = 'Detroit, Michigan, United States';
const committed = 'Detroit, MI, USA';
const choices = [committed, 'Detroit Lakes, Minnesota, United States', 'Detroit, Michigan, Canada'];
const saved = { ...emptyProfile(), answers: [{ question: 'Location', answer: location }] };

type LocationOption = string | { label: string; ariaLabel?: string; dismissOnly?: boolean };

function fixture(options: LocationOption[] = choices, afterSearch?: (input: HTMLInputElement, render: () => void) => void, doc = document) {
  doc.body.innerHTML = `<div class="ashby-application-form-field-entry" data-field-path="_systemfield_location">
    <label for="_systemfield_location">Location</label>
    <div><input class="ashby-application-form-input-autocomplete" role="combobox"
      aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" placeholder="Start typing...">
      <button>Toggle</button></div>
  </div>`;
  const input = doc.querySelector('input')!;
  const button = doc.querySelector('button')!;
  const label = doc.querySelector('label')!;
  const activity: string[] = [];
  let menu: HTMLElement | undefined;
  function close() {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-controls');
    label.removeAttribute('aria-hidden');
    button.removeAttribute('aria-hidden');
    menu?.remove();
    menu = undefined;
  }
  button.addEventListener('click', () => {
    activity.push('open');
    menu = doc.createElement('div');
    menu.id = ':r0:';
    menu.setAttribute('role', 'listbox');
    menu.textContent = 'No results';
    doc.body.append(menu);
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', menu.id);
    label.setAttribute('aria-hidden', 'true');
    button.setAttribute('aria-hidden', 'true');
  });
  input.addEventListener('input', () => {
    activity.push('input ' + input.value);
    if (!menu) return;
    menu.replaceChildren();
    if (input.value !== query) return;
    const render = () => {
      for (const entry of options) {
        const optionState = typeof entry === 'string' ? { label: entry } : entry;
        const { label: text, ariaLabel, dismissOnly } = optionState;
        const option = doc.createElement('div');
        option.setAttribute('role', 'option');
        if (ariaLabel) option.setAttribute('aria-label', ariaLabel);
        option.textContent = text;
        option.addEventListener('click', () => {
          activity.push('selected ' + text);
          if (!dismissOnly) input.value = text;
          close();
        });
        menu?.append(option);
      }
    };
    if (afterSearch) afterSearch(input, render);
    else render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  return { engine: createEngine(doc), input, activity };
}

test('searches the scoped Ashby system field then commits one complete equivalent location', async () => {
  const { engine, input, activity } = fixture();
  const scan = await engine.scan(saved);
  expect(scan.fields).toMatchObject([{ label: 'Location', kind: 'combobox', status: 'ready', value: location }]);
  expect(activity).toEqual([]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(activity).toEqual(['open', 'input ' + query, 'selected ' + committed]);
  expect(input.value).toBe(committed);
  expect(input.getAttribute('aria-expanded')).toBe('false');
});

test.each([
  ['location disagrees in country or city', [choices[1], choices[2]]],
  ['location has two fully equivalent choices', [committed, location]],
])('restores the original blank on failure when the %s', async (_description, options) => {
  const { engine, input, activity } = fixture(options);
  const scan = await engine.scan(saved);
  expect(scan.fields[0].status).toBe('ready');
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(activity).toEqual(['open', 'input ' + query, 'input ']);
  expect(input.value).toBe('');
  expect(input.getAttribute('aria-expanded')).toBe('false');
});

test('does not click a location whose visible text conflicts with its accessible caption', async () => {
  const { engine, input, activity } = fixture([{ label: choices[1], ariaLabel: committed }]);
  const scan = await engine.scan(saved);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(activity).toEqual(['open', 'input ' + query, 'input ']);
  expect(input.value).toBe('');
});

test('dismissing a menu without committing the complete location does not count as selection', async () => {
  const { engine, input, activity } = fixture([{ label: location, dismissOnly: true }]);
  const scan = await engine.scan(saved);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(activity).toEqual(['open', 'input ' + query, 'selected ' + location, 'input ']);
  expect(input.value).toBe('');
});

test('does not clear manually edited search text while autocomplete is waiting', async () => {
  const manual = 'Applicant-entered city';
  const { engine, input, activity } = fixture([], field => {
    window.setTimeout(() => {
      field.value = manual;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, 10);
  });
  const scan = await engine.scan(saved);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(activity).toEqual(['open', 'input ' + query, 'input ' + manual]);
  expect(input.value).toBe(manual);
});

test('treats an edit away from and back to the original query as an applicant edit', async () => {
  let manual = false;
  const { engine, input, activity } = fixture([], field => {
    if (manual) return;
    manual = true;
    window.setTimeout(() => {
      for (const value of ['Applicant draft', query]) {
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 10);
  });
  const scan = await engine.scan(saved);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(activity).toEqual(['open', 'input ' + query, 'input Applicant draft', 'input ' + query]);
  expect(input.value).toBe(query);
});

test('does not commit a search in a retained iframe after its containing application changes', async () => {
  const original = document.URL;
  const frame = document.createElement('iframe');
  document.body.replaceChildren(frame);
  const frameDoc = frame.contentDocument!;
  const frameUrl = frameDoc.URL;
  const { engine, activity } = fixture(choices, (_input, render) => {
    window.setTimeout(() => {
      history.pushState({}, '', '/different-application');
      render();
    }, 10);
  }, frameDoc);
  const scan = await engine.scan(saved);
  try {
    expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
    expect(document.URL).not.toBe(original);
    expect(frameDoc.URL).toBe(frameUrl);
    expect(activity).toEqual(['open', 'input ' + query]);
  } finally {
    history.replaceState({}, '', original);
  }
});

test('preserves an occupied location and avoids an unrecognized autocomplete', async () => {
  const { engine, input, activity } = fixture();
  input.value = 'Previously selected location';
  const occupied = await engine.scan(saved);
  expect(occupied.fields[0].status).toBe('preserved');
  expect(await engine.fill(occupied.scanId)).toMatchObject({ filled: 0 });
  expect(activity).toEqual([]);

  input.value = '';
  input.closest('[data-field-path]')!.setAttribute('data-field-path', 'unknown_location');
  const unknown = await engine.scan(saved);
  expect(unknown.fields[0].status).toBe('unsupported');
  expect(await engine.fill(unknown.scanId)).toMatchObject({ filled: 0 });
  expect(activity).toEqual([]);
});

test.each(['aria-label', 'aria-labelledby'])('a conflicting %s does not start a saved-residence search', async attribute => {
  const { engine, input, activity } = fixture();
  const caption = 'Which city would you prefer to work in?';
  if (attribute === 'aria-labelledby') {
    const reference = document.createElement('span');
    reference.id = 'preferred-city';
    reference.textContent = caption;
    document.body.append(reference);
    input.setAttribute(attribute, reference.id);
  } else {
    input.setAttribute(attribute, caption);
  }
  const profile = emptyProfile();
  Object.assign(profile.personal, { city: 'Detroit', state: 'Michigan', country: 'United States' });
  const scan = await engine.scan(profile);
  expect(scan.fields[0].status).toBe('unsupported');
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 0 });
  expect(activity).toEqual([]);
});
