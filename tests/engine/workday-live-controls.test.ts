import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { applyTarget } from '../../src/engine/controls';
import { inspectField } from '../../src/engine/discovery';
import { emptyProfile } from '../../src/shared/profile';

const sourceQuestion = 'Where did you hear about us?';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

function workdaySource(commit: boolean, virtual?: { options: readonly string[]; missingPosition?: number; changeOnReplay?: boolean;
  omitSetSize?: boolean }, announcement = "1 item selected, LinkedIn") {
  document.body.innerHTML = `
    <main data-automation-id="applyFlowPage">
      <div data-automation-id="formField-source">
        <label for="source--source">${sourceQuestion}</label>
        <p id="source-help">Choose the source for this application.</p>
        <div id="source-prompt" data-automation-id="multiSelectContainer">
          <div data-automation-id="multiselectInputContainer">
            <div data-automation-hiddensearch="false">
              <div data-automation-id="promptSelectionLabel"></div>
              <div id="source-instruction" data-automation-id="promptAriaInstruction" aria-hidden="true">0 items selected</div>
              <input id="source--source" placeholder="Search" enterkeyhint="search" aria-describedby="source-instruction source-help"
                data-uxi-widget-type="selectinput" data-uxi-multiselect-id="source-prompt">
            </div>
          </div>
        </div>
      </div>
    </main>`;
  const input = document.querySelector<HTMLInputElement>('#source--source')!;
  const widget = document.getElementById('source-prompt')!;
  const renderedOption = (caption: string, branch: boolean, position?: number, count?: number) => `<div data-automation-id="menuItem" role="option"
    ${position ? `id="menuItem-source-${position}" aria-posinset="${position}"` : ''}
    ${count === undefined ? '' : `aria-setsize="${count}"`}
    aria-label="${caption} not checked" aria-selected="false">
    <div data-automation-id="promptLeafNode" data-uxi-multiselect-id="source-prompt" data-uxi-multiselectlistitem-hassidecharm="${branch}">
      ${branch ? '' : '<input type="radio" data-automation-id="radioBtn" aria-checked="false">'}
      <div data-automation-id="promptOption" data-automation-label="${caption}">${caption}</div>
    </div></div>`;
  const rootMenu = () => `<div data-automation-id="activeListContainer" role="listbox" aria-label="Options Expanded">
    <div role="presentation">${renderedOption('Internet Search', true)}${renderedOption('Job Sites', true)}</div></div>`;
  let inputEvents = 0;
  let selectionClicks = 0;
  let scrollExtent = 0;
  let jobSitesVisits = 0;
  input.addEventListener('input', () => { inputEvents++; });
  input.addEventListener('click', () => {
    if (document.querySelector('[data-automation-id="responsiveMonikerPrompt"]')) return;
    document.body.insertAdjacentHTML('beforeend', `<div data-automation-id="responsiveMonikerPrompt" data-associated-widget="source-prompt"
      data-automation-type="singleSelectPrompt" data-uxi-prompt-type="singleselect">${rootMenu()}</div>`);
    input.setAttribute('data-automation-id', 'searchBox');
    input.parentElement!.setAttribute('data-automation-id', 'monikerSearchBox');
    input.parentElement!.setAttribute('data-automation-hiddensearch', 'true');
    widget.querySelector('#source-instruction')!.textContent = 'Expanded';
    input.focus();
    const popup = document.body.lastElementChild!;
    popup.addEventListener('click', event => {
      const target = event.target as Element;
      if (target.matches('[data-automation-id="backButton"]')) {
        popup.innerHTML = rootMenu();
        return;
      }
      const option = target.closest('[role="option"]');
      const caption = option?.querySelector('[data-automation-id="promptOption"]')?.textContent;
      if (caption === 'Internet Search' || caption === 'Job Sites') {
        popup.replaceChildren();
        window.setTimeout(() => {
          const leaf = caption === 'Job Sites' ? 'LinkedIn' : 'Web Search';
          const virtualPane = caption === 'Job Sites' && virtual;
          popup.innerHTML = `<div data-automation-id="multiSelectHeader" data-uxi-widget-type="multiselectlistheader"
            data-uxi-multiselect-id="source-prompt" data-uxi-multiselectlistheader-clickable="true">
            <div><span data-automation-id="backButton"></span></div>
            <div data-automation-id="promptTitle" aria-hidden="true" title="${caption}">${caption}</div></div>
            <div data-automation-id="activeListContainer" role="listbox" aria-label="Options Expanded"
              ${virtualPane ? 'class="ReactVirtualized__Grid ReactVirtualized__List" style="overflow-y: auto"' : ''}>
              <div role="presentation" ${virtualPane ? 'class="ReactVirtualized__Grid__innerScrollContainer"' : ''}>${virtualPane ? '' : renderedOption(leaf, false)}</div></div>`;
          if (!virtualPane) return;
          jobSitesVisits++;
          const menu = popup.querySelector('[role="listbox"]')!;
          const content = menu.firstElementChild!;
          const height = 96;
          const rowHeight = 32;
          const options = [...virtualPane.options];
          if (virtualPane.changeOnReplay && jobSitesVisits > 1) options[5] = 'Changed listing';
          const scrollHeight = rowHeight * options.length;
          let top = 0;
          const render = () => {
            const start = Math.floor(top / rowHeight);
            const end = Math.min(options.length, Math.ceil((top + height) / rowHeight) + 1);
            content.innerHTML = options.slice(start, end).map((name, index) => {
              const position = start + index + 1;
              return position === virtualPane.missingPosition ? '' : renderedOption(name, false, position,
                virtualPane.omitSetSize ? undefined : options.length);
            }).join('');
            for (const item of content.children) {
              item.getBoundingClientRect = () => new DOMRect(0, (Number(item.getAttribute('aria-posinset')) - 1) * rowHeight - top, 100, rowHeight);
            }
          };
          menu.getBoundingClientRect = () => new DOMRect(0, 0, 100, height);
          content.getBoundingClientRect = () => new DOMRect(0, -top, 100, scrollHeight);
          Object.defineProperties(menu, {
            clientHeight: { value: height }, scrollHeight: { value: scrollHeight },
            scrollTop: { get: () => top, set: (next: number) => {
              top = Math.min(scrollHeight - height, Math.max(0, next));
              scrollExtent = Math.max(scrollExtent, top);
              window.setTimeout(render, 8);
            } },
          });
          render();
        }, 10);
        return;
      }
      if (caption !== 'LinkedIn') return;
      selectionClicks++;
      popup.remove();
      input.removeAttribute('data-automation-id');
      input.parentElement!.removeAttribute('data-automation-id');
      input.parentElement!.setAttribute('data-automation-hiddensearch', 'false');
      widget.querySelector('#source-instruction')!.textContent = commit ? announcement : '0 items selected';
      if (!commit) {
        input.value = 'LinkedIn';
        return;
      }
      input.value = '';
      widget.insertAdjacentHTML('afterbegin', `<ul role="listbox" data-automation-id="selectedItemList" data-uxi-multiselect-id="source-prompt">
        <li role="presentation" data-automation-id="menuItem">
          <div role="option" data-automation-id="selectedItem" id="pill-linkedin" aria-label="LinkedIn, press delete to clear value.">
            <div data-automation-id="DELETE_charm" role="presentation" aria-hidden="true" tabindex="-1"></div>
            <p data-automation-id="promptOption">LinkedIn</p>
          </div>
        </li>
      </ul>`);
      widget.querySelector('[data-automation-id="DELETE_charm"]')!.addEventListener('click', () => {
        widget.querySelector('ul')!.remove();
        widget.querySelector('#source-instruction')!.textContent = '0 items selected';
      });
    });
  });
  const profile = emptyProfile();
  profile.applicationDefaults = { referralSource: 'linkedin' };
  return { engine: createEngine(document), input, profile, widget, inputEvents: () => inputEvents,
    selectionClicks: () => selectionClicks, scrollExtent: () => scrollExtent };
}

test('Workday follows referral branches across menu remounts and verifies the selected token', async () => {
  const { engine, input, profile, widget, inputEvents } = workdaySource(true);
  const scan = await engine.scan(profile);
  expect(scan.fields).toEqual([expect.objectContaining({ label: sourceQuestion, kind: 'combobox', status: 'ready' })]);
  expect(input.value).toBe('');
  expect(document.querySelector('[data-automation-id="responsiveMonikerPrompt"]')).toBeNull();

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  expect(inputEvents()).toBe(0);
  expect(input.value).toBe('');
  expect(widget.querySelector('[data-automation-id="selectedItem"]')?.textContent?.trim()).toBe('LinkedIn');
  expect((await engine.scan(profile)).fields).toEqual([expect.objectContaining({ status: 'preserved', currentValue: 'LinkedIn' })]);
});

test('Workday opens a prompt whose own instruction becomes Minimized on focus', async () => {
  const { engine, input, profile, widget, selectionClicks } = workdaySource(true);
  input.addEventListener('focus', () => {
    widget.querySelector('#source-instruction')!.textContent = 'Minimized';
    widget.insertAdjacentHTML('beforeend', `<div style="height: 0px" data-automation-id="responsiveMonikerPrompt"
      data-associated-widget="source-prompt" data-automation-mode="reactminimized" data-automation-type="singleSelectPrompt"></div>`);
  }, { once: true });
  input.addEventListener('click', () => widget.querySelector('[data-automation-mode="reactminimized"]')?.remove(), { capture: true });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(selectionClicks()).toBe(1);
});

test('Undo removes only the committed Workday token', async () => {
  const { engine, input, profile, widget } = workdaySource(true);
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(await engine.undo()).toMatchObject({ restored: 1, skipped: 0 });
  expect(widget.querySelector('[data-automation-id="selectedItem"]')).toBeNull();
  expect(input.value).toBe('');
});

test.each(['Choose a source for the updated question.', 'Minimized'])('changed independent help still invalidates a Workday fill (%s)', async updatedHelp => {
  const { engine, input, profile, selectionClicks } = workdaySource(true);
  const scan = await engine.scan(profile);
  input.addEventListener('click', () => {
    document.querySelector('#source-help')!.textContent = updatedHelp;
  });

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(selectionClicks()).toBe(0);
});

test.each([
  '1 item selected, Indeed',
  '1 item selected, LinkedIn. Read the updated instructions.',
])('retains mismatching or additional Workday help in the question identity (%s)', async announcement => {
  const { engine, profile, selectionClicks } = workdaySource(true, undefined, announcement);
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(selectionClicks()).toBe(1);
});

const virtualJobSites = ['104', '51 Job', 'ANAPEC', 'CV Library', 'Factory Fix', 'Indeed', 'Job Bank', 'LinkedIn', 'Monster', 'ZipRecruiter'];

test('finds an offscreen Workday option only after verifying the complete virtual category', async () => {
  const { engine, profile, widget, scrollExtent, selectionClicks } = workdaySource(true, { options: virtualJobSites });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(scrollExtent()).toBeGreaterThanOrEqual(144);
  expect(selectionClicks()).toBe(1);
  expect(widget.querySelector('[data-automation-id="selectedItem"]')?.textContent?.trim()).toBe('LinkedIn');
});

test.each([
  ['a second matching position', { options: ['LinkedIn', ...virtualJobSites.slice(1)] }],
  ['an unrendered position', { options: virtualJobSites, missingPosition: 5 }],
  ['a changed option when reopening the category', { options: virtualJobSites, changeOnReplay: true }],
] as const)('leaves a virtual Workday choice alone with %s', async (_reason, virtual) => {
  const { engine, profile, selectionClicks, scrollExtent } = workdaySource(true, virtual);
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(scrollExtent()).toBeGreaterThanOrEqual(144);
  expect(selectionClicks()).toBe(0);
});

test('does not select a visible Workday option from a virtual category without a verified total', async () => {
  const { engine, profile, selectionClicks } = workdaySource(true, {
    options: ['LinkedIn', ...virtualJobSites.slice(1)], omitSetSize: true,
  });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(selectionClicks()).toBe(0);
});

test('Workday leaves a prompt unfilled when its matching result closes the menu without adding a token', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  const { engine, input, profile, widget, selectionClicks } = workdaySource(false);
  const scan = await engine.scan(profile);
  const result = engine.fill(scan.scanId);
  await vi.advanceTimersByTimeAsync(8000);

  expect(await result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(selectionClicks()).toBe(1);
  expect(input.value).toBe('LinkedIn');
  expect(widget.querySelector('[data-automation-id="selectedItem"]')).toBeNull();
});

test('Workday binds a lazy listbox to its State label and selects Michigan for a saved MI', async () => {
  document.body.innerHTML = `<header><button type="button" aria-label="State" aria-haspopup="listbox"
    aria-controls="header-menu" aria-expanded="false">Select one</button></header>
  <main data-automation-id="applyFlowPage">
    <div data-automation-id="formField-countryRegion">
      <label for="address--countryRegion">State <abbr>*</abbr></label>
      <button id="address--countryRegion" name="countryRegion" type="button" aria-haspopup="listbox"
        aria-label="State Select one Required">Select one</button>
      <input type="text" style="display: none">
    </div>
  </main>`;
  const button = document.querySelector<HTMLButtonElement>('#address--countryRegion')!;
  const hidden = document.querySelector<HTMLInputElement>('input')!;
  let headerOpens = 0;
  document.querySelector('header > button')!.addEventListener('click', () => { headerOpens++; });
  button.addEventListener('click', () => {
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', 'lazy-id');
    document.body.insertAdjacentHTML('beforeend', `<ul role="listbox" id="lazy-id" aria-required="true">
      <li role="option" id="select-one" aria-disabled="true" data-value="">Select one</li>
      <li role="option" id="mi-opaque" data-value="mi-opaque"><div>Michigan</div></li>
      <li role="option" id="mn-opaque" data-value="mn-opaque"><div>Minnesota</div></li>
    </ul>`);
    const list = document.getElementById('lazy-id')!;
    list.addEventListener('click', event => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option?.dataset.value) return;
      hidden.value = option.dataset.value;
      const caption = option.textContent;
      button.textContent = caption;
      button.setAttribute('aria-label', `State ${caption} Required`);
      button.removeAttribute('aria-expanded');
      button.removeAttribute('aria-controls');
      list.remove();
    });
  });
  const profile = emptyProfile();
  Object.assign(profile.personal, { state: 'MI', country: 'United States' });
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields).toEqual([expect.objectContaining({ label: 'State', kind: 'combobox', status: 'ready', required: true })]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(button.textContent).toBe('Michigan');
  expect(hidden.value).toBe('mi-opaque');
  expect(headerOpens).toBe(0);
});

test('Workday leaves State alone when a previously associated listbox is replaced before fill', async () => {
  document.body.innerHTML = `<main data-automation-id="applyFlowPage">
    <div data-automation-id="formField-countryRegion">
      <label for="state">State</label>
      <button id="state" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="original">Select one</button>
    </div>
    <ul role="listbox" id="original" hidden><li role="option">Michigan</li></ul>
    <ul role="listbox" id="replacement" hidden><li role="option">Michigan</li></ul>
  </main>`;
  const button = document.querySelector('button')!;
  const replacement = document.getElementById('replacement')!;
  button.addEventListener('click', () => {
    button.setAttribute('aria-expanded', 'true');
    replacement.hidden = false;
  });
  let selections = 0;
  replacement.addEventListener('click', () => { selections++; button.textContent = 'Michigan'; });
  const profile = emptyProfile();
  Object.assign(profile.personal, { state: 'Michigan', country: 'United States' });
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields).toEqual([expect.objectContaining({ label: 'State', status: 'ready' })]);
  button.setAttribute('aria-controls', 'replacement');

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(selections).toBe(0);
});

function workdayDates(
  mismatch?: 'display' | 'aria-valuetext' | 'aria-valuenow', commitOnBlur = false, interaction?: 'deferred',
) {
  const date = (key: string, caption: string) => {
    const baseId = `workExperience-265--${key}`;
    const helpId = `helpText-${baseId}`;
    return `<div data-automation-id="formField-${key}"><fieldset>
      <legend><label><span>${caption}</span><abbr aria-hidden="true">*</abbr></label></legend>
      <div><div>
        <div id="${helpId}" aria-hidden="true">current value is MM/YYYY</div>
        <div id="${baseId}" data-automation-id="dateInputWrapper" role="group" aria-labelledby="hiddenDateValueId-${baseId}">
          <div tabindex="-1">
            ${['Month', 'Year'].map(part => `<div id="${baseId}-dateSection${part}">
              <div aria-hidden="true" data-automation-id="dateSection${part}-display" id="${baseId}-dateSection${part}-display">${part === 'Month' ? 'MM' : 'YYYY'}</div>
              <input role="spinbutton" aria-label="${part}" aria-describedby="${helpId}" aria-valuetext="${part === 'Month' ? 'MM' : 'YYYY'}" aria-valuemin="1" aria-valuemax="${part === 'Month' ? '12' : '9999'}"
                data-automation-id="dateSection${part}-input" id="${baseId}-dateSection${part}-input">
            </div>`).join('')}
          </div>
        </div>
        <div id="${helpId}" hidden>use right and left arrows to navigate spin buttons</div>
      </div></div></fieldset></div>`;
  };
  document.body.innerHTML = `<main data-automation-id="applyFlowPage"><div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Work-Experience-section">
      <h4 id="Work-Experience-section">Work Experience</h4>
      <div role="group" aria-labelledby="Work-Experience-1-panel">
        <h4 id="Work-Experience-1-panel">Work Experience 1</h4>
        <label>Company<input value="Example Studio"></label>
        ${date('startDate', 'From')}${date('endDate', 'To')}
      </div>
    </div>
  </div></main>`;
  for (const group of document.querySelectorAll('[data-automation-id="dateInputWrapper"]')) {
    const [month, year] = group.querySelectorAll<HTMLInputElement>('input');
    const displayValues = () => {
      const conflicting = month.value && month.id.includes('--startDate-') ? mismatch : undefined;
      const value = month.value ? String(Number(month.value)) : '';
      const rendered = value ? value.padStart(2, '0') : 'MM';
      month.value = value;
      month.previousElementSibling!.textContent = conflicting === 'display' ? '02' : rendered;
      month.setAttribute('aria-valuetext', conflicting === 'aria-valuetext' ? '2' : value || 'MM');
      if (value) month.setAttribute('aria-valuenow', conflicting === 'aria-valuenow' ? '2' : value);
      else month.removeAttribute('aria-valuenow');
      year.previousElementSibling!.textContent = year.value || 'YYYY';
      year.setAttribute('aria-valuetext', year.value || 'YYYY');
      if (year.value) year.setAttribute('aria-valuenow', year.value);
      else year.removeAttribute('aria-valuenow');
      group.previousElementSibling!.textContent = `current value is ${rendered}/${year.value || 'YYYY'}`;
    };
    let selectedPart = year;
    if (interaction === 'deferred') {
      group.addEventListener('focusin', event => {
        const target = event.target;
        if (target === month || target === year) queueMicrotask(() => { selectedPart = target as HTMLInputElement; });
      });
    }
    group.addEventListener('input', event => {
      if (interaction === 'deferred' && selectedPart === year && event.target === month && month.value) {
        year.value = String(2000 + Number(month.value));
        month.value = '0';
      }
      displayValues();
    });
    if (commitOnBlur) {
      for (const input of [month, year]) {
        input.addEventListener('blur', () => { input.dataset.accepted = input.value; });
      }
    }
  }
  const profile = emptyProfile();
  profile.employment = [{ company: 'Example Studio', title: 'Designer', startDate: '2021-09', endDate: '2024-05',
    current: false, location: '', description: '' }];
  return { profile, engine: createEngine(document), dates: [...document.querySelectorAll<HTMLInputElement>('[role="spinbutton"]')] };
}

test('Workday fills and undoes canonicalized From and To date parts as the announcement changes', async () => {
  const { engine, profile, dates } = workdayDates();
  const scan = await engine.scan(profile);
  expect(scan.fields.filter(field => field.status === 'ready').map(field => [field.label, field.value])).toEqual([
    ['From Month', '09'], ['From Year', '2021'], ['To Month', '05'], ['To Year', '2024'],
  ]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 4, failed: 0 });
  expect(dates.map(input => input.value)).toEqual(['9', '2021', '5', '2024']);
  expect(dates[0].previousElementSibling?.textContent).toBe('09');
  expect(dates[2].previousElementSibling?.textContent).toBe('05');
  expect(await engine.undo(scan.scanId)).toMatchObject({ restored: 4, skipped: 0 });
  expect(dates.map(input => input.value)).toEqual(['', '', '', '']);
});

test('Workday commits populated date parts through focus and blur before reporting success', async () => {
  const { engine, profile, dates } = workdayDates(undefined, true);
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 4, failed: 0 });
  expect(dates.map(input => input.dataset.accepted)).toEqual(['9', '2021', '5', '2024']);
  expect(await engine.undo(scan.scanId)).toMatchObject({ restored: 4, skipped: 0 });
  expect(dates.map(input => input.dataset.accepted)).toEqual(['', '', '', '']);
});

test('Workday re-emits an existing date value with a required error to a tracked input', async () => {
  const { dates } = workdayDates();
  const [, year] = dates;
  year.value = '2021';
  year.dispatchEvent(new Event('input', { bubbles: true }));
  const group = year.closest<HTMLElement>('[data-automation-id="dateInputWrapper"]')!;
  group.insertAdjacentHTML('afterend',
    `<div data-automation-id="inputAlert" id="error1-${group.id}">Error: The field From is required and must have a value.</div>`);
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  let trackedValue = year.value;
  const acceptedValues: string[] = [];
  const eventValues: string[] = [];
  Object.defineProperty(year, 'value', {
    get() { return nativeValue.get!.call(year); },
    set(value: string) {
      nativeValue.set!.call(year, value);
      trackedValue = year.value;
    },
  });
  year.addEventListener('input', () => {
    eventValues.push(year.value);
    if (trackedValue !== year.value) acceptedValues.push(year.value);
  });
  year.addEventListener('change', () => eventValues.push(year.value));
  const field = inspectField(year)!;
  expect(await applyTarget(field, '2021', { kind: 'text', value: '2021' }, () => true, () => {}, write => write()))
    .toEqual({ kind: 'text', value: '2021' });
  expect(acceptedValues).toEqual(['2021']);
  expect(eventValues).toEqual(['2021', '2021']);
  expect(year.value).toBe('2021');
  expect(dates.filter(input => input !== year).map(input => input.value)).toEqual(['', '', '']);
});

test('a replacement for the real Workday date help still invalidates the unwritten date part', async () => {
  const { engine, profile, dates } = workdayDates();
  dates[0].addEventListener('input', () => {
    dates[0].closest('[data-automation-id="dateInputWrapper"]')!.nextElementSibling!.textContent = 'New help for the From date';
  });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 3, skipped: 1 });
  expect(dates.map(input => input.value)).toEqual(['9', '', '5', '2024']);
});

test.each(['display', 'aria-valuetext', 'aria-valuenow'] as const)('does not verify a canonicalized month with contradictory %s', async mismatch => {
  const { engine, profile } = workdayDates(mismatch);
  const scan = await engine.scan(profile);
  const fill = await engine.fill(scan.scanId);
  expect(fill).toMatchObject({ filled: 3, failed: 1 });
  expect(fill.entries.find(entry => entry.label === 'From Month')?.status).toBe('failed');
});

test('Workday repairs existing required dates only when both parts agree with the saved record', async () => {
  const { engine, profile, dates } = workdayDates(undefined, true);
  const values = ['9', '2021', '5', '2025'];
  const eventValues: string[][] = dates.map(() => []);
  dates.forEach((input, index) => {
    input.value = values[index];
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.addEventListener('input', () => eventValues[index].push(input.value));
  });
  for (const [index, direction] of [[0, 'From'], [2, 'To']] as const) {
    const group = dates[index].closest('[data-automation-id="dateInputWrapper"]')!;
    group.parentElement!.insertAdjacentHTML('beforeend',
      `<p data-automation-id="inputAlert" id="error1-${group.id}">Error: The field ${direction} is required and must have a value.</p>`);
  }

  const plan = await engine.scan(profile);
  expect(plan.fields.filter(field => /^(?:From|To) (?:Month|Year)$/.test(field.label))
    .map(({ label, status }) => [label, status])).toEqual([
    ['From Month', 'ready'], ['From Year', 'ready'], ['To Month', 'preserved'], ['To Year', 'preserved'],
  ]);
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 2, failed: 0, undoAvailable: false });
  expect(dates.map(input => input.value)).toEqual(values);
  expect(eventValues).toEqual([['9'], ['2021'], [], []]);
  expect(dates.map(input => input.dataset.accepted)).toEqual(['9', '2021', undefined, undefined]);
});


test('Workday waits for the newly focused date segment before writing blank month and year fields', async () => {
  const { engine, profile, dates } = workdayDates(undefined, true, 'deferred');
  profile.employment[0].startDate = '2021-10';
  profile.employment[0].endDate = '2024-01';
  const plan = await engine.scan(profile);
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 4, failed: 0, undoAvailable: true });
  expect(dates.map(input => input.value)).toEqual(['10', '2021', '1', '2024']);
  expect(dates.map(input => input.dataset.accepted)).toEqual(['10', '2021', '1', '2024']);
  expect(await engine.undo(plan.scanId)).toEqual({ restored: 4, skipped: 0 });
  expect(dates.map(input => input.value)).toEqual(['', '', '', '']);
});


test('Workday leaves the date untouched if focus moves elsewhere before the date controller settles', async () => {
  const { engine, profile, dates } = workdayDates(undefined, true, 'deferred');
  const elsewhere = document.createElement('button');
  document.body.append(elsewhere);
  dates[0].addEventListener('focus', () => queueMicrotask(() => elsewhere.focus()));
  const plan = await engine.scan(profile);
  const month = plan.fields.find(field => field.label === 'From Month')!;
  expect(await engine.fill(plan.scanId, [month.id])).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(dates.map(input => input.value)).toEqual(['', '', '', '']);
  expect(document.activeElement).toBe(elsewhere);
});

test('Workday does not verify a month write that also changes its sibling year', async () => {
  const { engine, profile, dates } = workdayDates(undefined, true, 'deferred');
  dates[0].addEventListener('input', () => { dates[1].value = '2009'; });
  const plan = await engine.scan(profile);
  const month = plan.fields.find(field => field.label === 'From Month')!;
  expect(await engine.fill(plan.scanId, [month.id])).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
});
