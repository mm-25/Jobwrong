import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => vi.useRealTimers());

const sourceQuestion = 'How did you hear about us?';

function saved(question: string, answer: string) {
  return { ...emptyProfile(), answers: [{ question, answer }] };
}

function workdayMenu(secondLeaf = 'Company Website', branchDelay = 0) {
  document.body.innerHTML = `
    <form data-automation-id="applyFlowPage">
      <div data-automation-id="formField-source">
        <label for="source">${sourceQuestion}</label>
        <button type="button" data-automation-id="promptSearchButton" id="source"
          aria-haspopup="tree" aria-controls="sources" aria-expanded="false">Select one</button>
        <button type="button" aria-label="Clear selection" aria-controls="source">Clear</button>
      </div>
      <div id="sources" role="tree" hidden>
        <button type="button" role="treeitem" aria-expanded="false" aria-controls="jobs"
          data-automation-id="promptBranchNode">Job Boards and LinkedIn</button>
        <button type="button" role="treeitem" aria-expanded="false" aria-controls="online"
          data-automation-id="promptBranchNode">Online</button>
      </div>
      <div id="jobs" role="group" hidden>
        <div role="treeitem" data-automation-id="promptLeafNode">LinkedIn</div>
        <div role="treeitem" data-automation-id="promptLeafNode">Indeed</div>
      </div>
      <div id="online" role="group" hidden>
        <div role="treeitem" data-automation-id="promptLeafNode">${secondLeaf}</div>
      </div>
      <div role="tree"><button type="button" role="treeitem">LinkedIn</button></div>
    </form>`;
  const source = document.querySelector<HTMLButtonElement>('#source')!;
  const tree = document.querySelector<HTMLElement>('#sources')!;
  const clicks: string[] = [];
  function expand(trigger: HTMLElement, panel: HTMLElement) {
    trigger.setAttribute('aria-expanded', String(panel.hidden));
    panel.hidden = !panel.hidden;
  }
  source.addEventListener('click', () => expand(source, tree));
  source.nextElementSibling!.addEventListener('click', () => { source.textContent = 'Select one'; });
  for (const branch of tree.querySelectorAll<HTMLElement>('[aria-controls]')) {
    const panel = document.getElementById(branch.getAttribute('aria-controls')!)!;
    branch.addEventListener('click', () => {
      if (branchDelay && panel.id === 'jobs' && panel.hidden) {
        branch.setAttribute('aria-expanded', 'true');
        window.setTimeout(() => { panel.hidden = false; }, branchDelay);
      } else expand(branch, panel);
    });
    for (const leaf of panel.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
      leaf.addEventListener('click', () => {
        clicks.push(leaf.textContent!);
        source.textContent = leaf.textContent;
        tree.hidden = true;
        panel.hidden = true;
        branch.setAttribute('aria-expanded', 'false');
        source.setAttribute('aria-expanded', 'false');
      });
    }
  }
  return { source, tree, clicks, engine: createEngine(document) };
}

test('fills a unique leaf across scoped Workday tree branches and clears it on undo', async () => {
  const { source, tree, clicks, engine } = workdayMenu();
  const scan = await engine.scan(saved(sourceQuestion, 'LinkedIn'));

  expect(scan.fields).toEqual([expect.objectContaining({ status: 'ready', label: sourceQuestion, kind: 'combobox' })]);
  expect(tree.hidden).toBe(true);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  expect(clicks).toEqual(['LinkedIn']);
  expect(source.textContent).toBe('LinkedIn');
  expect(await engine.undo()).toMatchObject({ restored: 1, skipped: 0 });
  expect(source.textContent).toBe('Select one');
});

test('rejects duplicate leaves across branches before clicking either', async () => {
  const { clicks, source, engine } = workdayMenu('LinkedIn');
  const scan = await engine.scan(saved(sourceQuestion, 'LinkedIn'));

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(clicks).toEqual([]);
  expect(source.textContent).toBe('Select one');
});

test('leaves an exact category label unselected when no leaf matches it', async () => {
  const { clicks, source, engine } = workdayMenu();
  const scan = await engine.scan(saved(sourceQuestion, 'Job Boards and LinkedIn'));

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(clicks).toEqual([]);
  expect(source.textContent).toBe('Select one');
});

test('maps a deferred Workday semantic answer after network-delayed options arrive', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  document.body.innerHTML = `
    <form data-automation-id="applyFlowPage">
      <div data-automation-id="formField-veteran">
        <label for="veteran">Veteran status</label>
        <button id="veteran" type="button" aria-haspopup="listbox" aria-controls="veteran-menu" aria-expanded="false">Select One</button>
      </div>
      <ul role="listbox" id="veteran-menu" hidden></ul>
    </form>`;
  const trigger = document.querySelector<HTMLButtonElement>('#veteran')!;
  const list = document.querySelector<HTMLElement>('#veteran-menu')!;
  trigger.addEventListener('click', () => {
    trigger.setAttribute('aria-expanded', 'true');
    list.hidden = false;
    window.setTimeout(() => {
      list.innerHTML = '<li role="option">I am not a veteran</li><li role="option">I am a veteran</li>';
    }, 900);
  });
  list.addEventListener('click', (event) => {
    trigger.textContent = (event.target as HTMLElement).textContent;
    trigger.setAttribute('aria-expanded', 'false');
    list.hidden = true;
  });
  const engine = createEngine(document);
  const scan = await engine.scan({ ...emptyProfile(), applicationDefaults: { veteran: 'no' } });

  expect(scan.fields).toEqual([expect.objectContaining({ status: 'ready', kind: 'combobox' })]);
  const filling = engine.fill(scan.scanId);
  await vi.advanceTimersByTimeAsync(1200);
  expect(await filling).toMatchObject({ filled: 1, failed: 0 });
  expect(trigger.textContent).toBe('I am not a veteran');
});

test('fills click-driven ARIA checkbox and radio buttons and preserves a radio edit on undo', async () => {
  document.body.innerHTML = `
    <form>
      <button id="license" type="button" role="checkbox" aria-label="Licensed driver" aria-checked="false"></button>
      <div role="radiogroup" aria-label="Preferred schedule">
        <button id="day" type="button" role="radio" aria-checked="true">Day</button>
        <button id="night" type="button" role="radio" aria-checked="false">Night</button>
      </div>
    </form>`;
  const license = document.getElementById('license')!;
  const radioGroup = document.querySelector('[role="radiogroup"]')!;
  const [day, night] = [...radioGroup.children] as HTMLElement[];
  license.addEventListener('click', () => license.setAttribute('aria-checked',
    String(license.getAttribute('aria-checked') !== 'true')));
  radioGroup.addEventListener('click', ({ target }) => {
    for (const choice of [day, night]) choice.setAttribute('aria-checked', String(choice === target));
  });
  const engine = createEngine(document);
  const profile = saved('Licensed driver', 'Yes');
  profile.answers.push({ question: 'Preferred schedule', answer: 'Night' });
  const scan = await engine.scan(profile, { overwriteExisting: true });

  expect(scan.fields).toEqual([
    expect.objectContaining({ label: 'Licensed driver', status: 'ready' }),
    expect.objectContaining({ label: 'Preferred schedule', status: 'ready', options: ['Day', 'Night'] }),
  ]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 2, failed: 0 });
  expect(license.getAttribute('aria-checked')).toBe('true');
  expect(night.getAttribute('aria-checked')).toBe('true');

  day.click();
  expect(await engine.undo()).toMatchObject({ restored: 1, skipped: 1 });
  expect(license.getAttribute('aria-checked')).toBe('false');
  expect(day.getAttribute('aria-checked')).toBe('true');
});

test('uses the associated visible label for a hidden native checkbox', async () => {
  document.body.innerHTML = `
    <form>
      <label for="license">Licensed driver</label>
      <input id="license" type="checkbox" hidden>
      <label for="inert-license">Licensed driver</label>
      <input id="inert-license" type="checkbox" hidden inert>
    </form>`;
  const license = document.querySelector<HTMLInputElement>('#license')!;
  const engine = createEngine(document);
  const scan = await engine.scan(saved('Licensed driver', 'Yes'));

  expect(scan.fields).toEqual([expect.objectContaining({ status: 'ready', kind: 'checkbox' })]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(license.checked).toBe(true);
  expect(await engine.undo()).toMatchObject({ restored: 1, skipped: 0 });
  expect(license.checked).toBe(false);
});

test('excludes extension controls inside its shadow root from application scans', async () => {
  document.body.innerHTML = '<form><label>Department<input name="department"></label></form><div data-jobright-local-ui="true"></div>';
  document.querySelector('[data-jobright-local-ui]')!.attachShadow({ mode: 'open' }).innerHTML = '<label>Extension setting<input name="setting"></label>';

  const scan = await createEngine(document).scan(emptyProfile());

  expect(scan.fields.map((field) => field.label)).toEqual(['Department']);
});

test('traverses a Workday prompt that replaces the active menu with each category and a Back button', async () => {
  document.body.innerHTML = `
    <form data-automation-id="applyFlowPage">
      <div data-automation-id="formField-source">
        <label for="source">${sourceQuestion}</label>
        <button type="button" id="source" data-automation-id="promptSearchButton">Select One</button>
        <div data-automation-id="activeListContainer" role="listbox" hidden></div>
      </div>
    </form>`;
  const trigger = document.querySelector<HTMLButtonElement>('#source')!;
  const menu = document.querySelector<HTMLElement>('[role="listbox"]')!;
  const root = '<div role="option" data-automation-id="promptBranchNode">Online</div><div role="option" data-automation-id="promptBranchNode">Events</div>';
  trigger.addEventListener('click', () => {
    menu.hidden = false;
    menu.innerHTML = root;
  });
  menu.addEventListener('click', ({ target }) => {
    const item = target as HTMLElement;
    if (item.matches('[data-automation-id="promptBackButton"]')) {
      menu.innerHTML = root;
    } else if (item.matches('[data-automation-id="promptBranchNode"]')) {
      const leaf = item.textContent === 'Online' ? 'LinkedIn' : 'Career Fair';
      menu.innerHTML = '<button type="button" data-automation-id="promptBackButton">Back</button>' +
        '<div role="option" data-automation-id="promptLeafNode">' + leaf + '</div>';
    } else if (item.matches('[data-automation-id="promptLeafNode"]')) {
      trigger.textContent = item.textContent;
      menu.hidden = true;
    }
  });
  const engine = createEngine(document);
  const scan = await engine.scan(saved(sourceQuestion, 'Career Fair'));

  expect(scan.fields).toEqual([expect.objectContaining({ status: 'ready', label: sourceQuestion })]);
  expect(menu.hidden).toBe(true);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(trigger.textContent).toBe('Career Fair');
});

test('rejects a branch that points back to its own list without activating it', async () => {
  const { source, tree, engine } = workdayMenu();
  const branch = tree.querySelector('button')!;
  branch.setAttribute('aria-controls', tree.id);
  let branchClicks = 0;
  branch.addEventListener('click', () => { branchClicks++; });
  const scan = await engine.scan(saved(sourceQuestion, 'LinkedIn'));

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(branchClicks).toBe(0);
  expect(source.textContent).toBe('Select one');
});

test('checks branches mounted on first open before selecting a flat match', async () => {
  document.body.innerHTML = `
    <form>
      <button type="button" id="source" aria-label="${sourceQuestion}"
        aria-haspopup="listbox" aria-controls="menu" aria-expanded="false">Select One</button>
    </form>`;
  const trigger = document.querySelector<HTMLButtonElement>('#source')!;
  let commits = 0;
  trigger.addEventListener('click', () => {
    trigger.setAttribute('aria-expanded', 'true');
    trigger.insertAdjacentHTML('afterend', `
      <div id="menu" role="listbox">
        <div role="option">LinkedIn</div>
        <button type="button" role="option" aria-expanded="false" aria-controls="boards">Job Boards</button>
      </div>
      <div id="boards" role="group" hidden><div role="option">LinkedIn</div></div>
    `);
    const branch = document.querySelector<HTMLElement>('[aria-controls="boards"]')!;
    const boards = document.querySelector<HTMLElement>('#boards')!;
    branch.addEventListener('click', () => {
      branch.setAttribute('aria-expanded', String(boards.hidden));
      boards.hidden = !boards.hidden;
    });
    for (const leaf of document.querySelectorAll('[role="option"]:not([aria-expanded])')) {
      leaf.addEventListener('click', () => { commits++; trigger.textContent = leaf.textContent; });
    }
  }, { once: true });
  const engine = createEngine(document);
  const scan = await engine.scan(saved(sourceQuestion, 'LinkedIn'));

  expect(scan.fields).toEqual([expect.objectContaining({ status: 'ready' })]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(commits).toBe(0);
});

test('leaves a multi-select tree available for manual completion', async () => {
  const { source, tree, clicks, engine } = workdayMenu();
  tree.setAttribute('aria-multiselectable', 'true');
  const scan = await engine.scan(saved(sourceQuestion, 'LinkedIn'));

  expect(scan.fields).toEqual([expect.objectContaining({ status: 'unsupported' })]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(clicks).toEqual([]);
  expect(source.getAttribute('aria-expanded')).toBe('false');
});

test('does not select choices inside a different form, even if a trigger references their menu', async () => {
  document.body.innerHTML = `
    <form>
      <button type="button" role="combobox" aria-label="${sourceQuestion}"
        aria-controls="other-menu" aria-expanded="true">Select One</button>
    </form>
    <form>
      <div id="other-menu" role="listbox"><div role="option">LinkedIn</div></div>
    </form>`;
  let clicks = 0;
  document.querySelector('[role="option"]')!.addEventListener('click', () => {
    clicks++;
    document.querySelector('button')!.textContent = 'LinkedIn';
  });
  const engine = createEngine(document);
  const scan = await engine.scan(saved(sourceQuestion, 'LinkedIn'));

  expect(scan.fields).toEqual([expect.objectContaining({ status: 'unsupported' })]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(clicks).toBe(0);
});

test('continues waiting for a Workday branch after the application tab goes into the background', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const { engine, clicks } = workdayMenu(undefined, 3000);
  const scan = await engine.scan(saved(sourceQuestion, 'LinkedIn'));

  const filling = engine.fill(scan.scanId);
  await vi.advanceTimersByTimeAsync(100);
  visibility = 'hidden';
  await vi.advanceTimersByTimeAsync(6800);

  expect(await filling).toMatchObject({ filled: 1, failed: 0 });
  expect(clicks).toEqual(['LinkedIn']);
});

test('times out a background Workday branch that never renders within its wait budget', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const { engine, source, tree, clicks } = workdayMenu(undefined, 65000);
  const scan = await engine.scan(saved(sourceQuestion, 'LinkedIn'));
  let finished = false;

  const filling = engine.fill(scan.scanId).then((result) => {
    finished = true;
    return result;
  });
  await vi.advanceTimersByTimeAsync(4250);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1800);

  expect(await filling).toMatchObject({ filled: 0, failed: 1 });
  expect(clicks).toEqual([]);
  expect(tree.hidden).toBe(true);
  expect(source.textContent).toBe('Select one');
});
