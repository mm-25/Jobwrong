import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import { appendWorkdaySkills, restoreWorkdaySkills, sameWorkdaySkillSelections,
  workdaySkillsWidget, workdaySkillSelections, type WorkdaySkillSelection } from '../../src/engine/workday-skills';

const existing = 'Design Research';
const saved = 'User Experience';
const exact = 'User Experience (UX)';

afterEach(() => document.body.replaceChildren());

function workdaySkills(behavior: 'commit' | 'duplicate' | 'query-only' | 'edit' | 'unrelated-focus' | 'remounted-list' = 'commit') {
  const id = 'skills-picker';
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage">
    <div data-automation-id="formField-skills" data-fkit-id="skills--skills">
      <label for="skills--skills">Type to Add Skills</label>
      <div data-automation-id="multiSelectContainer" id="${id}">
        <span data-automation-id="promptSelectionLabel"></span>
        <div role="listbox" data-automation-id="selectedItemList" data-uxi-multiselect-id="${id}"></div>
        <div data-automation-id="multiselectInputContainer">
          <input id="skills--skills" data-uxi-widget-type="selectinput" data-uxi-multiselect-id="${id}" enterkeyhint="search" aria-describedby="skills-status">
          <span id="skills-status" data-automation-id="promptAriaInstruction" aria-hidden="true"></span>
        </div>
      </div>
    </div>
    <button type="button">Unrelated control</button>
  </main>`;
  const input = document.querySelector('input')!;
  const list = document.querySelector('[data-automation-id="selectedItemList"]')!;
  const status = document.getElementById('skills-status')!;
  const updateStatus = () => {
    const labels = [...list.querySelectorAll('[data-automation-id="promptOption"]')].map(item => item.textContent);
    status.textContent = `${labels.length} ${labels.length === 1 ? 'item' : 'items'} selected, ${labels.join(', ')}`;
  };
  const add = (id: string, label: string) => {
    const pill = document.createElement('div');
    pill.id = `pill-REMOTE_SKILL-1-${id}`;
    pill.setAttribute('role', 'option');
    pill.setAttribute('data-automation-id', 'selectedItem');
    pill.setAttribute('aria-label', `${label}, press delete to clear value.`);
    pill.innerHTML = `<p data-automation-id="promptOption" data-automation-label="${label}">${label}</p>
      <div data-automation-id="DELETE_charm" role="presentation" aria-hidden="true" tabindex="-1"></div>`;
    pill.lastElementChild!.addEventListener('click', () => { pill.remove(); updateStatus(); });
    list.append(pill);
    updateStatus();
  };
  add('1000', existing);
  let menu: HTMLElement | undefined;
  let manual = false;
  const clicks: string[] = [];
  const queries: string[] = [];
  const close = () => {
    menu?.remove();
    input.removeAttribute('data-automation-id');
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
    if (event.key !== 'Enter') return;
    queries.push(input.value);
    menu?.remove();
    const portal = document.createElement('div');
    portal.setAttribute('data-automation-id', 'responsiveMonikerPrompt');
    portal.setAttribute('data-associated-widget', id);
    portal.setAttribute('data-automation-type', 'multiSelectPrompt');
    portal.setAttribute('data-uxi-prompt-type', 'multiselect');
    const labels = behavior === 'duplicate' ? [exact, saved, 'User Experience Design'] : [exact, 'User Experience Design'];
    portal.innerHTML = `<div data-uxi-multiselectlist-issearch="true">
      <div role="listbox" data-automation-id="activeListContainer" aria-multiselectable="true" tabindex="-1">
        ${labels.map((label, index) => `<div role="option" data-automation-id="menuItem" id="menuItem-REMOTE_SKILL-1-${1001 + index}"
          aria-posinset="${index + 1}" aria-setsize="${labels.length}" aria-label="${label} not checked">
          <div data-automation-id="promptLeafNode" data-uxi-multiselect-id="${id}"
            data-uxi-multiselectlistitem-hassidecharm="false" data-uxi-multiselectlistitem-isselected="false">
            <input type="checkbox" aria-checked="false" data-automation-id="checkboxPanel">
            <p data-automation-id="promptOption" data-automation-label="${label}">${label}</p>
          </div></div>`).join('')}
      </div></div>`;
    portal.querySelectorAll('input').forEach((box, index) => {
      box.addEventListener('click', () => {
        clicks.push(labels[index]);
        if (behavior !== 'query-only') add(String(1001 + index), labels[index]);
      });
    });
    menu = portal;
    document.body.append(portal);
    const results = portal.querySelector<HTMLElement>('[data-automation-id="activeListContainer"]')!;
    results.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    input.setAttribute('data-automation-id', 'searchBox');
    results.focus();
    if (behavior === 'unrelated-focus') document.querySelector('button')!.focus();
    if (behavior === 'remounted-list') queueMicrotask(() => {
      const replacement = results.cloneNode(true) as HTMLElement;
      results.replaceWith(replacement);
      replacement.focus();
    });
    if (behavior === 'edit') {
      input.value = 'manual search';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      manual = true;
    }
  });
  const widget = workdaySkillsWidget(input)!;
  const selections = () => workdaySkillSelections(widget)!;
  const owns = (query: string, expected: WorkdaySkillSelection[]) =>
    !manual && input.value === query && sameWorkdaySkillSelections(expected, selections());
  const ownMutation = (write: () => void) => write();
  return { widget, selections, owns, ownMutation, queries, clicks, add };
}

test('Workday adds the exact saved skill receipt and Undo removes only that new skill', async () => {
  const { widget, selections, owns, ownMutation, clicks, queries } = workdaySkills();
  const before = selections();
  const after = await appendWorkdaySkills(widget, [existing, saved], owns, ownMutation);
  expect(queries).toEqual([saved]);
  expect(clicks).toEqual([exact]);
  expect(after?.map(({ label }) => label)).toEqual([existing, exact]);
  expect(widget.input.value).toBe('');
  expect(await restoreWorkdaySkills(widget, before, after!, owns, ownMutation)).toBe(true);
  expect(selections()).toEqual(before);
});

test.each(['duplicate', 'query-only', 'edit', 'unrelated-focus', 'remounted-list'] as const)('Workday does not claim a skill was added in the %s case', async behavior => {
  const { widget, selections, owns, ownMutation, clicks } = workdaySkills(behavior);
  expect(await appendWorkdaySkills(widget, [saved], owns, ownMutation)).toBeUndefined();
  expect(selections().map(({ label }) => label)).toEqual([existing]);
  const expectedQuery = behavior === 'edit' ? 'manual search'
    : behavior === 'unrelated-focus' || behavior === 'remounted-list' ? saved : '';
  expect(widget.input.value).toBe(expectedQuery);
  if (behavior === 'unrelated-focus') expect(document.activeElement?.textContent).toBe('Unrelated control');
  expect(clicks).toEqual(behavior === 'query-only' ? [exact] : []);
});

test('Workday Skills Undo preserves a later user-added chip', async () => {
  const { widget, selections, owns, ownMutation, add } = workdaySkills();
  const before = selections();
  const after = await appendWorkdaySkills(widget, [saved], owns, ownMutation);
  expect(after?.map(({ label }) => label)).toEqual([existing, exact]);
  add('9999', 'Typography');
  expect(await restoreWorkdaySkills(widget, before, after!, owns, ownMutation)).toBe(false);
  expect(selections().map(({ label }) => label)).toEqual([existing, exact, 'Typography']);
});

test('the engine plans a missing saved skill even when a manual skill is already present', async () => {
  const { selections, queries } = workdaySkills();
  const engine = createEngine(document);
  const profile = { ...emptyProfile(), skills: [existing, saved] };
  const plan = await engine.scan(profile);
  expect(plan.fields).toContainEqual(expect.objectContaining({ label: 'Type to Add Skills', kind: 'combobox', status: 'ready' }));
  expect(queries).toEqual([]);
  const result = await engine.fill(plan.scanId);
  expect(result, result.entries.map(entry => entry.reason).filter(Boolean).join('\n')).toMatchObject({
    filled: 1, failed: 0, undoAvailable: true,
  });
  expect(selections().map(({ label }) => label)).toEqual([existing, exact]);
  expect(await engine.undo(plan.scanId)).toEqual({ restored: 1, skipped: 0 });
  expect(selections().map(({ label }) => label)).toEqual([existing]);
});
