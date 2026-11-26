import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const question = 'Are you open to relocation?';
const profile = { ...emptyProfile(), answers: [{ question, answer: 'Yes' }] };

function reactSelectForm(menuId = 'react-select-question_123-listbox', {
  caption = question, options = ['Yes', 'No'], education = false, delay = 0, pointerOnly = false,
} = {}) {
  document.body.innerHTML = `<form>
    ${education ? '<fieldset><legend>Education</legend>' : ''}
    <label for="question_123">${caption}</label>
    <div class="select-shell">
      <div><div class="select__control">
        <div class="select__value-container">
          <div class="select__placeholder">Select...</div>
          <div class="select__input-container">
            <input id="question_123" class="select__input" role="combobox" aria-expanded="false" aria-haspopup="true">
          </div>
        </div>
        <div class="select__indicators"><button type="button" aria-label="${pointerOnly ? 'Toggle flyout' : 'Show choices'}">⌄</button></div>
      </div></div>
    </div>
    ${education ? '</fieldset>' : ''}
    <div id="unrelated" role="listbox"><div role="option">Yes</div></div>
    <button type="submit">Submit</button>
  </form>`;
  const input = document.querySelector<HTMLInputElement>('#question_123')!;
  const valueContainer = document.querySelector('.select__value-container')!;
  const shell = document.querySelector('.select-shell')!;
  const activity: string[] = [];
  const openingSteps: string[] = [];
  input.addEventListener('focus', () => openingSteps.push('focus'));
  document.querySelector('#unrelated')!.addEventListener('click', () => activity.push('unrelated click'));
  document.querySelector('form')!.addEventListener('submit', event => {
    event.preventDefault();
    activity.push('submit');
  });
  function close() {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-controls');
    shell.querySelector('[role="listbox"]')?.remove();
  }
  function open() {
    if (input.getAttribute('aria-expanded') === 'true') return;
    activity.push('open');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', menuId);
    const menu = document.createElement('div');
    menu.id = menuId;
    menu.setAttribute('role', 'listbox');
    for (const label of options) {
      const choice = document.createElement('div');
      choice.textContent = label;
      choice.setAttribute('role', 'option');
      choice.addEventListener('click', () => {
        activity.push(label);
        const selection = document.createElement('div');
        selection.className = 'select__single-value';
        selection.textContent = label;
        valueContainer.querySelector('.select__placeholder')!.replaceWith(selection);
        close();
      });
      menu.append(choice);
    }
    shell.append(menu);
  }
  function requestOpen() {
    if (delay) window.setTimeout(open, delay);
    else open();
  }
  const toggle = shell.querySelector('button')!;
  toggle.addEventListener('click', event => {
    openingSteps.push('click');
    event.preventDefault();
  });
  toggle.addEventListener('mousedown', () => openingSteps.push('mousedown'));
  const controlledWrapper = shell.querySelector('.select__control')!.parentElement!;
  controlledWrapper.addEventListener('mouseup', event => {
    openingSteps.push('mouseup');
    if (pointerOnly && event.target === toggle && event.button === 0 && event.buttons === 0) requestOpen();
  });
  controlledWrapper.addEventListener('keyup', event => {
    if (pointerOnly && event.code === 'Escape') {
      activity.push('close');
      close();
    }
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') openingSteps.push('ArrowDown');
    if (!pointerOnly && event.key === 'ArrowDown' && event.code === 'ArrowDown'
      && document.activeElement === input) requestOpen();
  });
  return { engine: createEngine(document), input, activity, openingSteps, toggle };
}

test('focuses a closed React Select before opening and confirms the visible committed value', async () => {
  const { engine, input, activity, openingSteps } = reactSelectForm();
  const scan = await engine.scan(profile);
  expect(scan.fields.find(field => field.label === question)).toMatchObject({ status: 'ready', value: 'Yes' });
  expect(input.hasAttribute('aria-controls')).toBe(false);
  expect(activity).toEqual([]);

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, undoAvailable: true });
  expect(activity).toEqual(['open', 'Yes']);
  expect(openingSteps).toEqual(['focus', 'ArrowDown']);
  expect(input.value).toBe('');
  expect(document.querySelector('.select__single-value')?.textContent).toBe('Yes');
  expect((await engine.scan(profile)).fields.find(field => field.label === question))
    .toMatchObject({ status: 'preserved', currentValue: 'Yes' });
});

test.each([0, 120])('sends one primary mouseup to the controlled Greenhouse flyout with menu delay %i', async delay => {
  const { engine, activity, openingSteps } = reactSelectForm(undefined, { delay, pointerOnly: true });
  const scan = await engine.scan(profile);
  const filled = await engine.fill(scan.scanId);
  expect(filled.entries[0]?.reason).toBeUndefined();
  expect(filled).toMatchObject({ filled: 1, failed: 0 });
  expect(activity).toEqual(['open', 'Yes']);
  expect(openingSteps).toEqual(['focus', 'mouseup']);
});

test('closes an opened controlled Greenhouse menu on Escape keyup after ambiguous choices', async () => {
  const { engine, input, activity, openingSteps } = reactSelectForm(undefined, {
    pointerOnly: true, options: ['Yes', 'Yes'],
  });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(activity).toEqual(['open', 'close']);
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(openingSteps).toEqual(['focus', 'mouseup']);
});

test('revalidates the target after focus before opening its menu', async () => {
  const { engine, input, activity, openingSteps } = reactSelectForm(undefined, { pointerOnly: true });
  const scan = await engine.scan(profile);
  input.addEventListener('focus', () => {
    input.value = 'A value set during focus';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(input.value).toBe('A value set during focus');
  expect(activity).toEqual([]);
  expect(openingSteps).toEqual(['focus']);
});

test('leaves the menu closed when the applicant moves focus during the opening attempt', async () => {
  const { engine, input, activity, openingSteps } = reactSelectForm(undefined, { pointerOnly: true });
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  input.addEventListener('focus', () => submit.focus());
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(document.activeElement).toBe(submit);
  expect(activity).toEqual([]);
  expect(openingSteps).toEqual(['focus']);
});

test.each([
  ['type', 'submit'],
  ['formaction', '/other'],
  ['command', '--not-a-flyout'],
  ['aria-controls', 'unrelated'],
  ['aria-labelledby', 'destructive-caption'],
] as const)('does not activate a Greenhouse lookalike with %s=%s', async (attribute, value) => {
  const { engine, activity, openingSteps, toggle } = reactSelectForm();
  toggle.setAttribute('aria-label', 'Toggle flyout');
  toggle.setAttribute(attribute, value);
  if (attribute === 'aria-labelledby') {
    const caption = document.createElement('span');
    caption.id = value;
    caption.textContent = 'Delete attachment';
    document.body.append(caption);
  }
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(activity).toEqual(['open', 'Yes']);
  expect(openingSteps).toEqual(['focus', 'ArrowDown']);
});

function degreeProfile() {
  return { ...emptyProfile(), education: [{
    school: 'Example University', degree: 'B.Sc.', fieldOfStudy: 'Design',
    startDate: '2020-01', endDate: '2024-01', gpa: '',
  }] };
}

test('resolves a lazy degree caption from the original profile snapshot', async () => {
  const { engine, activity } = reactSelectForm(undefined, {
    caption: 'Degree', education: true, options: ['Bachelor of Arts', 'Bachelor of Science'],
  });
  const candidate = degreeProfile();
  const scan = await engine.scan(candidate);
  expect(scan.fields.find(field => field.label === 'Degree')).toMatchObject({ status: 'ready', value: 'B.Sc.' });
  expect(activity).toEqual([]);
  candidate.education[0].degree = 'Bachelor of Arts';

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(activity).toEqual(['open', 'Bachelor of Science']);
});

test('a saved answer stays authoritative when the lazy menu includes other degree formats', async () => {
  const { engine, activity } = reactSelectForm(undefined, {
    caption: 'Degree', education: true, options: ['Bachelor of Science', 'Bachelor of Arts'],
  });
  const candidate = degreeProfile();
  candidate.answers = [{ question: 'Degree', answer: 'Bachelor of Arts' }];
  const scan = await engine.scan(candidate);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(activity).toEqual(['open', 'Bachelor of Arts']);
});

test.each([
  ['no matching choice', ['Bachelor of Arts', 'Master of Science']],
  ['conflicting aliases', ['Bachelor of Science', 'BSc']],
])('leaves the lazy degree unchanged with %s', async (_reason, options) => {
  const { engine, activity } = reactSelectForm(undefined, { caption: 'Degree', education: true, options });
  const scan = await engine.scan(degreeProfile());
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(activity).toEqual(['open']);
  expect(document.querySelector('.select__single-value')).toBeNull();
});

test('does not select from a list with an unexpected late association', async () => {
  const { engine, activity } = reactSelectForm('react-select-other-listbox');
  const scan = await engine.scan(profile);
  expect(scan.fields.find(field => field.label === question)?.status).toBe('ready');
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(activity).toEqual(['open']);
});

test('a closed unassociated generic combobox is not activated', async () => {
  const { engine, input, activity } = reactSelectForm();
  input.classList.remove('select__input');
  const scan = await engine.scan(profile);
  expect(scan.fields.find(field => field.label === question)?.status).toBe('unsupported');
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(activity).toEqual([]);
});

test('distinguishes plain Attach labels by the uniquely associated upload purpose', async () => {
  document.body.innerHTML = `<form>
    <div class="file-upload"><p>Resume/CV</p><div class="file-upload__wrapper">
      <label for="resume">Attach</label><input id="resume" type="file" hidden>
    </div></div>
    <div class="file-upload"><p>Cover Letter</p><div class="file-upload__wrapper">
      <label for="cover_letter">Attach</label><input id="cover_letter" type="file" hidden>
    </div></div>
    <div class="file-upload"><p>Cover Letter</p><div class="file-upload__wrapper">
      <label for="other">Attach</label><input id="other" name="resume" type="file" hidden>
    </div></div>
    <label for="cv">Attach</label><input id="cv" type="file" hidden>
  </form>`;
  const scan = await createEngine(document).scan(emptyProfile());
  expect(scan.fields.map(({ label, status }) => ({ label, status }))).toEqual([
    { label: 'Resume/CV', status: 'unanswered' },
    { label: 'Cover Letter', status: 'unsupported' },
    { label: 'Attach', status: 'unsupported' },
    { label: 'Resume/CV', status: 'unanswered' },
  ]);
});
