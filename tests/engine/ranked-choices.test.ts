import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { Profile } from '../../src/shared/types';

const question = 'Race/Ethnicity';
const asian = 'Asian';
const southAsian = 'South Asian';

function defaults(): Profile {
  return { ...emptyProfile(), applicationDefaults: { raceEthnicity: 'south_asian' } };
}

function nativeSelect(labels: string[]) {
  document.body.innerHTML = `<label>${question}<select><option value="">Select one</option>${
    labels.map((label, index) => `<option value="${index + 1}">${label}</option>`).join('')
  }</select></label>`;
  return { engine: createEngine(document), select: document.querySelector('select')! };
}

test.each([
  { labels: [asian, southAsian], winner: southAsian },
  { labels: [asian], winner: asian },
  { labels: [asian, asian, southAsian], winner: southAsian },
  { labels: [asian, southAsian, southAsian], winner: undefined },
  { labels: [asian, asian], winner: undefined },
])('uses a unique highest-ranked native choice among $labels', async ({ labels, winner }) => {
  const { engine, select } = nativeSelect(labels);
  const scan = await engine.scan(defaults());

  if (winner) {
    expect(scan.fields[0]).toMatchObject({ status: 'ready', value: winner, sensitive: true });
    expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
    expect(select.selectedOptions[0]?.label).toBe(winner);
  } else {
    expect(scan.fields[0]).toMatchObject({ status: 'unanswered', sensitive: true });
    expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
    expect(select.value).toBe('');
  }
});

test('keeps an exact saved answer ahead of the ranked South Asian default', async () => {
  const { engine, select } = nativeSelect([asian, southAsian]);
  const profile = { ...defaults(), answers: [{ question, answer: asian }] };
  const scan = await engine.scan(profile);

  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: asian });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(select.selectedOptions[0]?.label).toBe(asian);
});

test.each([
  { additionalOption: southAsian, winner: southAsian, opened: false },
  { additionalOption: '', winner: asian, opened: false },
  { additionalOption: southAsian, winner: southAsian, opened: true },
])('chooses $winner when the lazy menu finishes loading (opened: $opened)', async ({ additionalOption, winner, opened }) => {
  document.body.innerHTML = `
    <form data-automation-id="applyFlowPage">
      <div data-automation-id="formField-race">
        <label for="race">${question}</label>
        <button id="race" type="button" aria-haspopup="listbox" aria-controls="race-options" aria-expanded="false">Select One</button>
      </div>
      <ul id="race-options" role="listbox" hidden></ul>
    </form>`;
  const button = document.querySelector('button')!;
  const options = document.querySelector('ul')!;
  const committed: string[] = [];
  function startLoading() {
    button.setAttribute('aria-expanded', 'true');
    options.hidden = false;
    options.setAttribute('aria-busy', 'true');
    options.innerHTML = '<li role="option">Asian</li>';
    window.setTimeout(() => {
      if (additionalOption) options.insertAdjacentHTML('beforeend', `<li role="option">${additionalOption}</li>`);
      options.setAttribute('aria-busy', 'false');
    }, 80);
  }
  button.addEventListener('click', startLoading);
  options.addEventListener('click', ({ target }) => {
    const option = target as HTMLElement;
    if (options.getAttribute('aria-busy') === 'true') committed.push('While loading');
    committed.push(option.textContent!);
    button.textContent = option.textContent;
    button.setAttribute('aria-expanded', 'false');
    options.hidden = true;
  });
  if (opened) startLoading();
  const engine = createEngine(document);
  const scan = await engine.scan(defaults());

  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: southAsian, sensitive: true });
  expect(options.hidden).toBe(!opened);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(committed).toEqual([winner]);
});

function nestedSelect(labels: string[]) {
  document.body.innerHTML = `
    <form>
      <button type="button" aria-label="${question}" aria-haspopup="tree" aria-controls="races" aria-expanded="false">Select One</button>
      <div role="tree" id="races" hidden>
        ${labels.map((_, index) => `<button type="button" role="treeitem" aria-controls="branch-${index}" aria-expanded="false">Category ${index}</button>`).join('')}
      </div>
      ${labels.map((label, index) => `<div role="group" id="branch-${index}" hidden><div role="treeitem">${label}</div></div>`).join('')}
    </form>`;
  const trigger = document.querySelector('button')!;
  const root = document.querySelector<HTMLElement>('[role="tree"]')!;
  const committed: string[] = [];
  function toggle(button: HTMLButtonElement, panel: HTMLElement) {
    button.setAttribute('aria-expanded', String(panel.hidden));
    panel.hidden = !panel.hidden;
  }
  trigger.addEventListener('click', () => toggle(trigger, root));
  for (const branch of root.querySelectorAll('button')) {
    const group = document.getElementById(branch.getAttribute('aria-controls')!)!;
    branch.addEventListener('click', () => toggle(branch, group));
    group.firstElementChild!.addEventListener('click', ({ target }) => {
      const leaf = target as HTMLElement;
      committed.push(leaf.textContent!);
      trigger.textContent = leaf.textContent;
      toggle(trigger, root);
      toggle(branch, group);
    });
  }
  return { engine: createEngine(document), committed };
}

test('explores other branches for the specific choice even when earlier fallback leaves tie', async () => {
  const { engine, committed } = nestedSelect([asian, asian, southAsian]);
  const scan = await engine.scan(defaults());

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(committed).toEqual([southAsian]);
});

test('rejects equally ranked South Asian leaves in different menu branches', async () => {
  const { engine, committed } = nestedSelect([asian, southAsian, southAsian]);
  const scan = await engine.scan(defaults());

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(committed).toEqual([]);
});

test('uses the unique broader category when no nested branch offers South Asian', async () => {
  const { engine, committed } = nestedSelect(['White', asian]);
  const scan = await engine.scan(defaults());

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(committed).toEqual([asian]);
});
