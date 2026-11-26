import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { Education, Profile } from '../../src/shared/types';

const alternatives = ['UX Research', 'Product Design', 'Web Design', 'Other'];
const education: Education = {
  school: 'Example University', degree: "Master's", fieldOfStudy: 'Information', fieldOfStudyAlternatives: alternatives,
  startDate: '', endDate: '', gpa: '',
};

afterEach(() => document.body.replaceChildren());

function profile(override: Partial<Education> = {}): Profile {
  return { ...emptyProfile(), education: [{ ...education, ...override }] };
}

function nativeStudy(options: string, caption = 'Field of Study') {
  document.body.innerHTML = `<fieldset><legend>Education</legend><label>${caption}<select name="fieldOfStudy">
    <option value="">Choose</option>${options}</select></label></fieldset>`;
  return createEngine(document);
}

test.each([
  [['Other', 'Product Design', 'Information', 'UX Research'], 'Information'],
  [['Other', 'Web Design', 'User Experience Research', 'Product Design'], 'User Experience Research'],
  [['Other', 'Web Design', 'Product Design'], 'Product Design'],
  [['Other', 'Web Design'], 'Web Design'],
  [['Computer Science', 'Other'], 'Other'],
] as const)('uses the highest authorized visible choice from %j', async (labels, expected) => {
  const engine = nativeStudy(labels.map((label, index) => `<option value="study-${index}">${label}</option>`).join(''));
  const scan = await engine.scan(profile());
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: expected });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(document.querySelector('select')?.selectedOptions[0]?.label).toBe(expected);
  expect(await engine.undo(scan.scanId)).toMatchObject({ restored: 1, skipped: 0 });
});

test('uses only labels, rejects duplicate best choices, and requires explicit Other', async () => {
  const mislabeled = nativeStudy('<option value="UX Research">Computer Science</option><option>Other</option>');
  const absent = await mislabeled.scan(profile({ fieldOfStudyAlternatives: alternatives.slice(0, -1) }));
  expect(absent.fields[0]).toMatchObject({ status: 'unanswered' });

  const duplicates = nativeStudy('<option value="ux-1">User Experience Research</option><option value="ux-2">User Experience Research</option><option>Web Design</option>');
  expect((await duplicates.scan(profile())).fields[0]).toMatchObject({ status: 'unanswered' });
});

test('treats Other as a last resort even when saved first', async () => {
  const engine = nativeStudy('<option>Other</option><option>Web Design</option>');
  const scan = await engine.scan(profile({ fieldOfStudy: 'Other', fieldOfStudyAlternatives: ['Other', 'Web Design'] }));
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Web Design' });
});

test('considers only available native options when ranking the verified captions', async () => {
  const engine = nativeStudy('<option hidden>Information</option><option disabled>UX Research</option><option>Product Design</option>');
  expect((await engine.scan(profile())).fields[0]).toMatchObject({ status: 'ready', value: 'Product Design' });
});

test('an exact saved answer wins, and fallback preferences do not fill unrelated controls or free text', async () => {
  const engine = nativeStudy('<option>Computer Science</option><option>Product Design</option>');
  const saved = { ...profile(), answers: [{ question: 'Field of Study', answer: 'Computer Science' }] };
  expect((await engine.scan(saved)).fields[0]).toMatchObject({ status: 'ready', value: 'Computer Science' });

  const unrelated = nativeStudy('<option>Other</option>', 'Area of professional interest');
  expect((await unrelated.scan(profile())).fields[0]).toMatchObject({ status: 'unanswered' });

  document.body.innerHTML = '<fieldset><legend>Education</legend><label>Field of Study<input></label></fieldset>';
  expect((await createEngine(document).scan(profile())).fields[0]).toMatchObject({ status: 'ready', value: 'Information' });
});

function workdayStudy(labels: readonly string[], incomplete = false) {
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage"><form><fieldset><legend>Education</legend>
    <div data-automation-id="formField-fieldOfStudy">
      <label for="education--fieldOfStudy">Field of Study</label>
      <div id="study-prompt" data-automation-id="multiSelectContainer">
        <div data-automation-id="multiselectInputContainer">
          <div data-automation-id="promptSelectionLabel"></div>
          <input id="education--fieldOfStudy" placeholder="Search" enterkeyhint="search"
            data-uxi-widget-type="selectinput" data-uxi-multiselect-id="study-prompt">
        </div>
      </div>
    </div><button type="submit">Submit application</button>
  </fieldset></form></main>`;
  const input = document.querySelector<HTMLInputElement>('#education--fieldOfStudy')!;
  const widget = document.getElementById('study-prompt')!;
  let selected = '';
  let submit = false;
  document.querySelector('form')!.addEventListener('submit', event => { submit = true; event.preventDefault(); });
  input.addEventListener('click', () => {
    const choices = labels.map((label, index) => `<div data-automation-id="menuItem" role="option"
      id="menuItem-study-${index}" aria-label="${label} not checked" aria-setsize="${labels.length + Number(incomplete)}">
      <div data-automation-id="promptLeafNode" data-uxi-multiselect-id="study-prompt" data-uxi-multiselectlistitem-hassidecharm="false">
        <input type="radio" data-automation-id="radioBtn" aria-checked="false">
        <div data-automation-id="promptOption">${label}</div>
      </div>
    </div>`).join('');
    document.body.insertAdjacentHTML('beforeend', `<div data-automation-id="responsiveMonikerPrompt" data-associated-widget="study-prompt"
      data-automation-type="singleSelectPrompt" data-uxi-prompt-type="singleselect">
      <div data-automation-id="activeListContainer" role="listbox">${choices}</div></div>`);
    const popup = document.body.lastElementChild!;
    popup.addEventListener('click', event => {
      const label = (event.target as Element).closest('[role="option"]')?.querySelector('[data-automation-id="promptOption"]')?.textContent;
      if (!label) return;
      selected = label;
      popup.remove();
      widget.insertAdjacentHTML('afterbegin', `<ul role="listbox" data-automation-id="selectedItemList" data-uxi-multiselect-id="study-prompt">
        <li role="presentation"><div role="option" data-automation-id="selectedItem" aria-label="${label}, press delete to clear value.">
          <div data-automation-id="DELETE_charm" role="presentation" aria-hidden="true" tabindex="-1"></div>
          <p data-automation-id="promptOption">${label}</p>
        </div></li></ul>`);
      widget.querySelector('[data-automation-id="DELETE_charm"]')!.addEventListener('click', () => widget.querySelector('ul')!.remove());
    });
  });
  return { engine: createEngine(document), widget, input, selected: () => selected, submitted: () => submit };
}

test.each([
  [['Other', 'Web Design', 'Product Design', 'User Experience Research'], 'User Experience Research'],
  [['Other', 'Web Design', 'Product Design'], 'Product Design'],
  [['Other', 'Web Design', 'User Experience Research', 'Information'], 'Information'],
  [['Computer Science', 'Other'], 'Other'],
] as const)('resolves the Workday preference only after opening the complete menu %j', async (labels, expected) => {
  const { engine, widget, input, selected, submitted } = workdayStudy(labels);
  const scan = await engine.scan(profile());
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Information' });
  expect(selected()).toBe('');
  expect(document.querySelector('[data-automation-id="responsiveMonikerPrompt"]')).toBeNull();
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  expect(selected()).toBe(expected);
  expect(input.value).toBe('');
  expect(await engine.undo(scan.scanId)).toMatchObject({ restored: 1, skipped: 0 });
  expect(widget.querySelector('[data-automation-id="selectedItem"]')).toBeNull();
  expect(submitted()).toBe(false);
});

test('never selects visible Other in a Workday menu with unverified options', async () => {
  const { engine, selected } = workdayStudy(['Other', 'Computer Science'], true);
  const scan = await engine.scan(profile());
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(selected()).toBe('');
});
