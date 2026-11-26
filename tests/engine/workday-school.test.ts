import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import { workdaySchoolSearch } from '../../src/engine/education-school';
import { chooseWorkdaySchool, workdaySchoolWidget } from '../../src/engine/workday-school';
import { workdayPromptSelection } from '../../src/engine/workday-controls';

const michigan = 'University of Michigan';
const campus = 'Ann Arbor';
const caption = 'The University of Michigan, Ann Arbor';

afterEach(() => document.body.replaceChildren());

function fixture(options: string[], config: { partial?: boolean; manualEdit?: boolean; missingReceipt?: boolean; virtual?: boolean; unrelatedFocus?: boolean; optionFocus?: boolean; closeOnResultBlur?: boolean; reuseSearchMenu?: boolean; resultHeader?: string; clickableHeader?: boolean; closeOnTab?: boolean; autoSelect?: boolean } = {}) {
  document.body.innerHTML = `<main data-automation-id="applyFlowPage">
    <div data-automation-id="applyFlowMyExpPage">
      <div role="group" aria-labelledby="Education-section">
        <h4 id="Education-section">Education</h4>
        <div role="group" aria-labelledby="Education-1-panel">
          <h5 id="Education-1-panel">Education 1</h5>
          <div data-automation-id="formField-school">
            <label for="education-5--school">School or University</label>
            <div id="school-widget" data-automation-id="multiSelectContainer">
              <div data-automation-id="multiselectInputContainer">
                <div data-automation-id="promptSelectionLabel"></div>
                <p id="school-instruction" data-automation-id="promptAriaInstruction" aria-hidden="true">0 items selected</p>
                <input aria-describedby="school-instruction" id="education-5--school" data-uxi-widget-type="selectinput"
                  data-uxi-multiselect-id="school-widget" enterkeyhint="search">
              </div>
            </div>
          </div>
          <div data-automation-id="formField-degree">
            <label for="education-5--degree">Degree</label>
            <button type="button" aria-haspopup="listbox" aria-label="Degree Master of Science Required"
              id="education-5--degree" name="degree" value="MS">Master of Science</button>
          </div>
        </div>
      </div>
    </div>
  </main><button type="button" id="unrelated">Unrelated</button>`;
  const input = document.querySelector('input')!;
  const container = document.getElementById('school-widget')!;
  const announcement = document.getElementById('school-instruction')!;
  let portal: HTMLElement;
  const submitted: string[] = [];
  const selections: string[] = [];
  let scrollExtent = 0;
  const startPortal = () => {
    const shell = document.createElement('div');
    shell.dataset.automationId = 'responsiveMonikerPrompt';
    shell.dataset.associatedWidget = container.id;
    document.body.append(shell);
    return shell;
  };
  const commit = (label: string) => {
    selections.push(label);
    input.value = '';
    portal.remove();
    input.removeAttribute('data-automation-id');
    announcement.textContent = config.missingReceipt ? '0 items selected' : `1 item selected, ${label}`;
    if (!config.missingReceipt) container.insertAdjacentHTML('beforeend', `<ul role="listbox" data-automation-id="selectedItemList" tabindex="-1"
      data-uxi-multiselect-id="school-widget"><li role="option" data-automation-id="selectedItem"
      aria-label="${label}, press delete to clear value."><div data-automation-id="DELETE_charm" role="presentation" aria-hidden="true" tabindex="-1"></div><div data-automation-id="promptOption">${label}</div></li></ul>`);
  };
  const readyPortal = (shell: HTMLElement, search: boolean) => {
    shell.dataset.automationType = 'singleSelectPrompt';
    shell.dataset.uxiPromptType = 'singleselect';
    shell.innerHTML = `<div data-uxi-widget-type="multiselectlist" data-uxi-multiselectlist-isresponsive="false"
      data-uxi-multiselectlist-issearch="${search}"><div role="listbox" tabindex="-1" data-automation-id="activeListContainer"><div role="presentation">
      ${search ? options.map((label, i) => `<div id="menuItem-school-${i}" data-automation-id="menuItem" role="option"
        aria-label="${label} not checked" aria-selected="false" aria-posinset="${i + 1}" aria-setsize="${options.length + Number(!!config.partial)}">
        <div data-automation-id="promptLeafNode" data-uxi-multiselect-id="school-widget"
          data-uxi-multiselectlistitem-hassidecharm="false"><div data-automation-id="promptOption">${label}</div></div>
      </div>`).join('') : '<div>No Items</div>'}</div></div></div>`;
    if (search && config.resultHeader) shell.insertAdjacentHTML('afterbegin', `<div data-automation-id="multiSelectHeader"
      data-uxi-widget-type="multiselectlistheader" data-uxi-multiselect-id="school-widget"
      data-uxi-multiselectlistheader-clickable="${!!config.clickableHeader}">
      <div data-automation-id="promptTitle" aria-hidden="true" title="Search Results">Search Results</div>
      <div>${config.resultHeader}</div></div>`);
    shell.addEventListener('click', event => {
      const option = (event.target as Element).closest('[data-automation-id="promptLeafNode"]');
      if (!option) return;
      const label = option.querySelector('[data-automation-id="promptOption"]')!.textContent!;
      commit(label);
    });
    if (config.virtual && search) {
      const menu = shell.querySelector<HTMLElement>('[role="listbox"]')!;
      const content = menu.firstElementChild as HTMLElement;
      const nodes = [...content.children];
      menu.className = 'ReactVirtualized__Grid ReactVirtualized__List';
      menu.style.overflowY = 'auto';
      content.className = 'ReactVirtualized__Grid__innerScrollContainer';
      const rowHeight = 25;
      const height = 100;
      const scrollHeight = nodes.length * rowHeight;
      let top = 0;
      const render = () => {
        const start = Math.floor(top / rowHeight);
        content.replaceChildren(...nodes.slice(start, Math.ceil((top + height) / rowHeight)));
      };
      menu.getBoundingClientRect = () => new DOMRect(0, 0, 100, height);
      content.getBoundingClientRect = () => new DOMRect(0, -top, 100, scrollHeight);
      for (const [index, node] of nodes.entries()) {
        node.getBoundingClientRect = () => new DOMRect(0, index * rowHeight - top, 100, rowHeight);
      }
      Object.defineProperties(menu, {
        clientHeight: { value: height }, scrollHeight: { value: scrollHeight },
        scrollTop: { get: () => top, set: (next: number) => {
          top = Math.min(scrollHeight - height, Math.max(0, next));
          scrollExtent = Math.max(scrollExtent, top);
          window.setTimeout(render, 8);
        } },
      });
      render();
    }
  };
  input.addEventListener('click', () => {
    if (portal?.isConnected) return;
    portal = startPortal();
    announcement.textContent = 'Expanded';
    readyPortal(portal, false);
  });
  container.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.dataset.automationId !== 'DELETE_charm') return;
    target.closest('[data-automation-id="selectedItemList"]')!.remove();
    announcement.textContent = '0 items selected';
  });
  let original = true;
  const owned = new WeakSet<Event>();
  input.addEventListener('input', event => { if (!owned.has(event)) original = false; });
  input.addEventListener('change', event => { if (!owned.has(event)) original = false; });
  input.addEventListener('keydown', event => {
    if (config.closeOnTab && event.key === 'Tab' && !input.value) {
      portal.remove();
      const minimized = startPortal();
      minimized.dataset.automationMode = 'reactminimized';
      container.append(minimized);
      input.addEventListener('blur', () => minimized.remove(), { once: true });
    } else if (!config.closeOnTab && event.key === 'Escape') portal.remove();
    if (event.key !== 'Enter') return;
    submitted.push(input.value);
    input.dataset.automationId = 'searchBox';
    if (!config.reuseSearchMenu) {
      portal.remove();
      portal = startPortal();
      portal.setAttribute('aria-busy', 'true');
    }
    window.setTimeout(() => {
      if (config.autoSelect) {
        commit(options[0]);
        container.querySelector<HTMLElement>('[data-automation-id="selectedItemList"]')?.focus();
        if (config.manualEdit) input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if (config.reuseSearchMenu) {
        const rendered = document.createElement('div');
        readyPortal(rendered, true);
        const header = rendered.querySelector('[data-automation-id="multiSelectHeader"]');
        if (header) portal.prepend(header);
        const view = portal.querySelector('[data-uxi-widget-type="multiselectlist"]')!;
        view.setAttribute('data-uxi-multiselectlist-issearch', 'true');
        portal.querySelector('[role="listbox"]')!.replaceChildren(...rendered.querySelector('[role="listbox"]')!.children);
      } else {
        portal.remove();
        portal = startPortal();
        readyPortal(portal, true);
      }
      const focus = config.unrelatedFocus ? document.getElementById('unrelated')!
        : portal.querySelector<HTMLElement>(config.optionFocus ? '[role="option"]' : '[role="listbox"]')!;
      if (config.closeOnResultBlur) focus.addEventListener('blur', () => portal.remove(), { once: true });
      focus.tabIndex = -1;
      focus.focus();
      if (config.manualEdit) {
        input.value = 'Typed by applicant';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 5);
  });
  const widget = workdaySchoolWidget(input)!;
  return {
    input, submitted, selections, scrollExtent: () => scrollExtent,
    choose: (school = michigan, location = campus) => chooseWorkdaySchool(widget, workdaySchoolSearch(school, location)!,
      state => original && state.query === (input.value || undefined) && state.value === workdayPromptSelection(container),
      event => owned.add(event), mutation => mutation()),
  };
}

test('searches only the owned Workday prompt, prefers the campus, and verifies an actual selected pill', async () => {
  const { choose, submitted, selections, input } = fixture([michigan, `${michigan} - Dearborn`, caption, 'U of Michigan Ann Arbor']);
  expect(submitted).toEqual([]);
  await expect(choose()).resolves.toEqual({ kind: 'combobox', value: caption });
  expect(submitted).toEqual([campus]);
  expect(selections).toEqual([caption]);
  expect(input.value).toBe('');
});

test('requires every declared result even if the campus is already visible', async () => {
  const { choose, selections, input } = fixture([caption], { partial: true, closeOnResultBlur: true });
  await expect(choose()).rejects.toThrow();
  expect(selections).toEqual([]);
  expect(input.value).toBe('');
});

test('preserves an applicant edit during the search', async () => {
  const { choose, selections, input } = fixture([caption], { manualEdit: true });
  await expect(choose()).rejects.toThrow();
  expect(selections).toEqual([]);
  expect(input.value).toBe('Typed by applicant');
});

test('requires a pill after activating a result', async () => {
  const { choose, selections } = fixture([caption], { missingReceipt: true });
  await expect(choose()).rejects.toThrow();
  expect(selections).toEqual([caption]);
});

test('replays the full virtual search catalog before selecting one equivalent Michigan identity', async () => {
  const { choose, selections, scrollExtent } = fixture([
    'U of Michigan Ann Arbor', `${michigan} - Dearborn`, michigan, ...Array.from({ length: 12 }, (_, i) => `Other School ${i}`),
    caption, caption, 'The University of Michigan Ann Arbor - School of Engineering',
  ], { virtual: true, resultHeader: '(18)' });
  await expect(choose()).resolves.toMatchObject({ value: caption });
  expect(selections).toEqual([caption]);
  expect(scrollExtent()).toBe(18 * 25 - 100);
});

test('falls back to a broad Michigan caption only after a complete institution search', async () => {
  const { choose, submitted } = fixture([michigan, 'Michigan State University']);
  await expect(choose()).resolves.toMatchObject({ value: michigan });
  expect(submitted).toEqual([campus, michigan]);
});

function educationProfile(ambiguous = false) {
  const profile = emptyProfile();
  const fields = { fieldOfStudy: '', startDate: '', endDate: '', gpa: '' };
  profile.education = [
    { ...fields, school: 'Sample Institute of Technology', degree: ambiguous ? 'MS' : 'Bachelor of Engineering' },
    { ...fields, school: michigan, campus, degree: "Master's Degree" },
  ];
  return profile;
}

test('fills a searchable school from the only record corroborated by the applicant-selected degree and undoes only the school', async () => {
  const { input, selections, submitted } = fixture([michigan, `${michigan} - Dearborn`, caption]);
  const engine = createEngine(document);
  const { scanId, fields } = await engine.scan(educationProfile());
  const school = fields.find(field => field.label === 'School or University')!;
  expect(school).toMatchObject({ status: 'ready', value: `${michigan} - ${campus}` });
  expect(fields.find(field => field.label === 'Degree')).toMatchObject({ status: 'preserved' });
  expect(submitted).toEqual([]);
  const result = await engine.fill(scanId);
  expect(result.entries).toContainEqual(expect.objectContaining({ id: school.id, status: 'filled' }));
  expect(selections).toEqual([caption]);
  expect(submitted).toEqual([campus]);
  expect(input.value).toBe('');
  expect(await engine.undo(scanId)).toEqual({ restored: 1, skipped: 0 });
  expect(document.querySelector('[data-automation-id="selectedItem"]')).toBeNull();
  expect(document.getElementById('education-5--degree')?.textContent).toBe('Master of Science');
});

test('leaves a blank searchable school unresolved when multiple records corroborate the same selected degree', async () => {
  const { submitted } = fixture([caption]);
  const engine = createEngine(document);
  const scan = await engine.scan(educationProfile(true));
  const school = scan.fields.find(field => field.label === 'School or University')!;
  expect(school.status).toBe('unanswered');
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 0 });
  expect(submitted).toEqual([]);
});

test('treats separately identified Workday results for the same Toronto campus as one school choice', async () => {
  const label = 'THE UNIV. OF TORONTO (SCARBOROUGH)';
  const { choose, submitted, selections } = fixture([
    'University of Toronto - Mississauga', 'University of Toronto Scarborough School of Design',
    label, label, 'U of Toronto Scarborough', 'THE UNIV. OF TORONTO',
  ]);
  await expect(choose('University of Toronto', 'Scarborough')).resolves.toMatchObject({ value: label });
  expect(submitted).toEqual(['Scarborough']);
  expect(selections).toEqual([label]);
});

test('leaves the query alone when focus moves to an unrelated control', async () => {
  const { choose, input, selections } = fixture([caption], { unrelatedFocus: true });
  await expect(choose()).rejects.toThrow(/changed during the search/);
  expect(selections).toEqual([]);
  expect(input.value).toBe(campus);
  expect(document.activeElement?.id).toBe('unrelated');
});

test('accepts focus on a verified option while comparing the complete owned result list', async () => {
  const { choose, selections } = fixture([`${michigan} - Dearborn`, caption], { optionFocus: true });
  await expect(choose()).resolves.toMatchObject({ value: caption });
  expect(selections).toEqual([caption]);
});

test('accepts the counted results header when the owned blank view becomes a search without remounting', async () => {
  const { choose, selections } = fixture([caption, 'Michigan State University'], { reuseSearchMenu: true, resultHeader: '(2)' });
  await expect(choose()).resolves.toMatchObject({ value: caption });
  expect(selections).toEqual([caption]);
}, 12000);

test.each([
  ['an incomplete result count', '(2+)', false],
  ['a count that differs from the rows', '(3)', false],
  ['a clickable category header', '(2)', true],
] as const)('does not select under %s', async (_, resultHeader, clickableHeader) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] });
  try {
    const { choose, selections, input } = fixture([caption, 'Michigan State University'], { resultHeader, clickableHeader });
    const rejected = expect(choose()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10025);
    await rejected;
    expect(selections).toEqual([]);
    expect(input.value).toBe('');
  } finally {
    vi.useRealTimers();
  }
});

test('closes an owned Workday search that responds to Tab after clearing its unmatched query', async () => {
  const { choose, selections, input } = fixture(['Michigan State University', 'University of Michigan - Dearborn'], {
    resultHeader: '(2)', closeOnTab: true,
  });
  await expect(choose('Example University', '')).rejects.toThrow(/No verified Workday search result/);
  expect(selections).toEqual([]);
  expect(input.value).toBe('');
  expect(document.querySelector('[data-automation-id="responsiveMonikerPrompt"]')).toBeNull();
});

test.each([
  [caption, false, true, true],
  [michigan, false, false, false],
  [`${michigan} - Dearborn`, false, false, false],
  [`${michigan} - Dearborn`, true, false, true],
] as const)('handles a site-selected singleton %s (applicant edit %s)', async (label, manualEdit, accepted, retained) => {
  const { choose } = fixture([label], { autoSelect: true, manualEdit });
  if (accepted) await expect(choose()).resolves.toEqual({ kind: 'combobox', value: label });
  else await expect(choose()).rejects.toThrow(/Workday selected a school during the search/);
  expect(document.querySelector('[data-automation-id="selectedItem"]')?.textContent?.trim()).toBe(retained ? label : undefined);
});
