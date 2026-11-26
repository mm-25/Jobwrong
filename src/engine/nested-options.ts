import {
  accessibleText, canClickOption, comboListIds, labelText, menuForId, samePopupScope, writable, type Choice,
} from './discovery';
import { isWorkdayChoice, isWorkdayVirtualizedList, workdayVirtualizedView, workdayPrompt, workdayPromptHeader, workdayPromptMenu, workdayPromptOption, workdayPromptSearchMenu } from './workday-controls';

export const workdayPromptSelector = 'button[type="button"]:is([data-automation-id="promptIcon"], [data-automation-id="promptSearchButton"], [data-automation-id="countryDropdown"])';
export const nestedTriggerSelector = 'button[type="button"][aria-haspopup="tree"], ' + workdayPromptSelector;

const popupRoles = '[role="listbox"], [role="tree"]';
const workdayPopup = '[data-automation-id="activeListContainer"]';
const workdayItems = '[data-automation-id="promptBranchNode"], [data-automation-id="promptLeafNode"], [data-automation-id="promptOption"], [data-automation-id="radioBtn"], [data-automation-id="menuItem"]';
const itemRoles = '[role="treeitem"], [role="option"]';
const groupSelector = popupRoles + ', [role="group"], ' + workdayPopup;
const maxDepth = 6;
const maxBranches = 24;
const maxItems = 512;
const maxVirtualScrolls = 128;

function referencedMenu(origin: HTMLElement, trigger: HTMLElement, selector: string): HTMLElement | undefined {
  const ids = comboListIds(origin);
  if (ids.length !== 1) return undefined;
  const menu = menuForId(origin, ids[0], trigger);
  return menu?.matches(selector) ? menu : undefined;
}

export function workdayLocalWrapper(trigger: HTMLElement): Element | undefined {
  if (!isWorkdayChoice(trigger)) return undefined;
  const wrapper = trigger.closest('[data-automation-id^="formField-"]');
  if (!wrapper) return undefined;
  const triggers = [...wrapper.querySelectorAll(nestedTriggerSelector + ', [role="combobox"], button[aria-haspopup="listbox"]')]
    .filter((other) => other.closest('[data-automation-id^="formField-"]') === wrapper
      && !other.closest(popupRoles + ', ' + workdayPopup));
  return triggers.length === 1 && triggers[0] === trigger ? wrapper : undefined;
}

export function nestedPopup(trigger: HTMLElement): HTMLElement | undefined {
  const prompt = workdayPrompt(trigger);
  if (prompt) return workdayPromptMenu(trigger, prompt);
  const roles = isWorkdayChoice(trigger) ? popupRoles + ', ' + workdayPopup : popupRoles;
  if (comboListIds(trigger).length) return referencedMenu(trigger, trigger, roles);
  const wrapper = workdayLocalWrapper(trigger);
  if (!wrapper) return undefined;
  const menus = [...wrapper.querySelectorAll<HTMLElement>(roles)].filter((menu) =>
    menu.closest('[data-automation-id^="formField-"]') === wrapper && !menu.parentElement?.closest(roles));
  return menus.length === 1 ? menus[0] : undefined;
}

function localGroup(element: HTMLElement, trigger: HTMLElement): HTMLElement | undefined {
  const groups = [...element.children].filter((child): child is HTMLElement =>
    child.matches(groupSelector) && samePopupScope(trigger, child));
  return groups.length === 1 ? groups[0] : undefined;
}

function childMenu(element: HTMLElement, trigger: HTMLElement): HTMLElement | undefined {
  return comboListIds(element).length ? referencedMenu(element, trigger, groupSelector) : localGroup(element, trigger);
}

type Item = Choice & { branch: boolean; key: string };

function items(menu: HTMLElement, trigger: HTMLElement, readOption = workdayPromptOption, prompt = workdayPrompt(trigger)): Item[] {
  if (prompt) {
    return [...menu.querySelectorAll<HTMLElement>('[role="option"][data-automation-id="menuItem"]')].flatMap(element => {
      if (element.parentElement?.closest(groupSelector) !== menu || !writable(element)) return [];
      const option = readOption(element, prompt);
      return option ? [{ ...option, key: JSON.stringify([option.label, option.branch]) }] : [];
    });
  }
  const workday = isWorkdayChoice(trigger);
  const selectors = workday ? itemRoles + ', ' + workdayItems + ', li' : itemRoles;
  return [...menu.querySelectorAll<HTMLElement>(selectors)].filter((node) =>
    (node.parentElement?.closest(groupSelector) === menu)
    && (!node.parentElement?.closest(selectors) || node.parentElement.closest(selectors)!.contains(menu))
    && (!node.matches('li') || node.matches(itemRoles + ', ' + workdayItems) || node.parentElement === menu)
    && node.id !== 'select-one' && writable(node) && canClickOption(node))
    .map((node) => {
      const group = localGroup(node, trigger);
      const branch = node.matches('[aria-expanded], [aria-haspopup="tree"], [aria-haspopup="listbox"], [data-automation-id="promptBranchNode"]')
        || !!group || comboListIds(node).length > 0;
      // A nested group is the item's children, so exclude it from the branch caption.
      const caption = group ? [...node.childNodes]
        .filter((child) => child !== group)
        .map((child) => child.nodeType === 1 ? labelText(child as Element) : child.textContent).join(' ')
        : node.textContent;
      const label = accessibleText(node) || caption?.replace(/\s+/g, ' ').trim() || '';
      const value = node.getAttribute('data-value') ?? '';
      return { element: node, label, value, branch, key: JSON.stringify([label, value, branch, node.id, comboListIds(node)]) };
    }).filter(({ label }) => !!label);
}

export function usesNestedOptions(trigger: HTMLElement): boolean {
  if (trigger.matches('[aria-haspopup="tree"]')) return true;
  const workday = isWorkdayChoice(trigger);
  if (workday && (!comboListIds(trigger).length || trigger.matches(workdayPromptSelector))) return true;
  const popup = nestedPopup(trigger);
  return !!popup && (popup.matches('[role="tree"]')
    || !!popup.querySelector('[role="option"]:is([aria-expanded], [aria-controls], [aria-haspopup="tree"], [aria-haspopup="listbox"]), [data-automation-id="promptBranchNode"]'));
}

export function nestedChoices(trigger: HTMLElement): Choice[] {
  const found: Choice[] = [];
  const visited = new Set<HTMLElement>();
  function collect(menu: HTMLElement | undefined, depth: number) {
    if (!menu || !writable(menu) || visited.has(menu) || depth > maxDepth || visited.size > maxBranches) return;
    visited.add(menu);
    for (const item of items(menu, trigger)) {
      if (item.branch) collect(childMenu(item.element, trigger), depth + 1);
      else if (found.length < maxItems) found.push(item);
    }
  }
  collect(nestedPopup(trigger), 0);
  return found;
}

export function optionWaitDeadline(element: HTMLElement, visibleMs = 2000, hiddenMs = 5000): () => boolean {
  const { document, performance } = element.ownerDocument.defaultView!;
  const started = performance.now();
  let budget = document.visibilityState === 'visible' ? visibleMs : hiddenMs;
  return () => {
    // Retain the longer allowance if the browser throttled timers during this wait.
    if (document.visibilityState !== 'visible') budget = hiddenMs;
    return performance.now() - started >= budget;
  };
}

type Path = string[];
type VirtualSlot = { item: Item; id: string; position: number };
type VirtualView = NonNullable<ReturnType<typeof workdayVirtualizedView>>;
type VirtualCensus = {
  view: VirtualView;
  initialTop: number;
  initialPosition: number;
  total: number;
  slots: Map<number, VirtualSlot>;
  signature: string;
};
type VerifyMenu = (menu: HTMLElement) => boolean;
type ConfirmedMenu = { menu: HTMLElement; portal: Element | null };

function sameVirtualView(expected: VirtualView, current?: VirtualView): boolean {
  return !!current && current.menu === expected.menu && current.portal === expected.portal
    && current.content === expected.content && current.label === expected.label
    && current.resultsHeader?.element === expected.resultsHeader?.element && current.resultsHeader?.count === expected.resultsHeader?.count
    && current.header?.title === expected.header?.title && current.header?.back === expected.header?.back;
}

function sameVirtualSlot(first: VirtualSlot | undefined, second: VirtualSlot): boolean {
  return !!first && first.position === second.position && first.id === second.id && first.item.key === second.item.key;
}

type SearchResults = {
  menu: HTMLElement;
  query: string;
  select: (choices: Choice[]) => Choice | undefined;
  currentMenu?: () => HTMLElement | undefined;
  portal?: HTMLElement;
  container?: HTMLElement;
  readOption?: typeof workdayPromptOption;
  multiple?: true;
  allowResultsHeader?: true;
};

export function findNestedOption(trigger: HTMLElement, rank: (choice: Choice) => number, revalidate: () => boolean): Promise<Choice>;
export function findNestedOption(trigger: HTMLElement, rank: undefined, revalidate: () => boolean, search: SearchResults): Promise<Choice | undefined>;
export async function findNestedOption(
  trigger: HTMLElement,
  rank: ((choice: Choice) => number) | undefined,
  revalidate: () => boolean,
  search?: SearchResults,
): Promise<Choice | undefined> {
  const win = trigger.ownerDocument.defaultView!;
  const expired = optionWaitDeadline(trigger, 20000, 60000);
  const hits: Path[] = [];
  let bestRank = 0;
  const activeViews = new Map<HTMLElement, Set<string>>();
  const visitedPaths = new Map<string, string>();
  const virtualPaths = new Map<string, VirtualCensus>();
  const prompt = search?.container ?? workdayPrompt(trigger);
  const currentSearchMenu = () => search?.currentMenu ? search.currentMenu() : prompt && workdayPromptSearchMenu(trigger, prompt);
  const readItems = (menu: HTMLElement) => items(menu, trigger, search?.readOption, search?.container);
  const virtualView = (menu: HTMLElement) => workdayVirtualizedView(menu, search?.portal, search?.allowResultsHeader);
  let rootVirtualView: VirtualView | undefined;
  let branches = 0;
  let options = 0;

  function guard() {
    if (!revalidate() || (search?.container ? !search.container.contains(trigger) : prompt && workdayPrompt(trigger) !== prompt)) {
      throw new Error('The field changed while opening its options.');
    }
    if (expired()) throw new Error('The menu contents could not be verified in time.');
    if (search && (!prompt || (trigger as HTMLInputElement).value !== search.query
      || currentSearchMenu() !== search.menu || (search.portal && !search.portal.contains(search.menu)))) {
      throw new Error('The Workday search results changed.');
    }
  }

  function portalOf(menu: HTMLElement): Element | null {
    return prompt ? menu.closest('[data-automation-id="responsiveMonikerPrompt"]') : null;
  }

  function ownsMenu(confirmed: ConfirmedMenu): boolean {
    return nestedPopup(trigger) === confirmed.menu && portalOf(confirmed.menu) === confirmed.portal;
  }

  async function waitForMenu(resolve: () => HTMLElement | undefined): Promise<ConfirmedMenu> {
    const menuExpired = optionWaitDeadline(trigger);
    while (true) {
      guard();
      const menu = resolve();
      if (menu && writable(menu) && !menu.matches('[aria-busy="true"]') && readItems(menu).length) {
        return { menu, portal: portalOf(menu) };
      }
      if (menuExpired()) throw new Error('The associated menu could not be verified.');
      await new Promise<void>((resolve) => win.setTimeout(resolve, 20));
    }
  }

  function refind(menu: HTMLElement, key: string): Item {
    const choices = readItems(menu).filter((choice) => choice.key === key);
    if (choices.length !== 1) throw new Error('The menu path changed or became ambiguous.');
    return choices[0];
  }

  function childOf(menu: HTMLElement, key: string): HTMLElement | undefined {
    const branch = refind(menu, key);
    const child = childMenu(branch.element, trigger);
    if (child === menu || child?.contains(menu)) throw new Error('The menu contains a circular path.');
    return child;
  }

  function signature(menu: HTMLElement): string {
    return JSON.stringify(readItems(menu).map(({ key }) => key));
  }

  function readVirtualSlice(menu: HTMLElement, total: number): VirtualSlot[] {
    if (menu.matches('[aria-busy="true"]')) return [];
    const positions = new Set<number>();
    const ids = new Set<string>();
    const current = readItems(menu);
    if (search && menu.querySelectorAll('[role="option"]').length !== current.length) {
      throw new Error('The Workday search options could not be verified.');
    }
    return current.map(item => {
      const { element } = item;
      const id = element.id;
      const position = Number(element.getAttribute('aria-posinset'));
      if (item.branch || !element.querySelector('[data-uxi-multiselectlistitem-hassidecharm="false"]')
        || !/^menuItem-[\w-]+$/.test(id) || ids.has(id) || Number(element.getAttribute('aria-setsize')) !== total
        || !Number.isInteger(position) || position < 1 || position > total || positions.has(position)) {
        throw new Error('The Workday virtual options changed or became ambiguous.');
      }
      positions.add(position);
      ids.add(id);
      return { item, id, position };
    }).sort((a, b) => a.position - b.position);
  }

  function matchesStartingRows(rows: VirtualSlot[], census: VirtualCensus): boolean {
    // A measured grid may mount more overscan rows when returning to the same position.
    return rows.some(row => row.position === census.initialPosition)
      && rows.every(row => sameVirtualSlot(census.slots.get(row.position), row));
  }

  function verifiedVirtualStart(menu: HTMLElement, census: VirtualCensus, reopenedTitle?: string): boolean {
    const view = virtualView(menu);
    if (!view || nestedPopup(trigger) !== menu || Math.abs(menu.scrollTop - census.initialTop) > 1) return false;
    if (reopenedTitle) {
      // Entering the verified branch can mount a new portal. Each census still pins its own portal.
      if (census.view.header?.title !== reopenedTitle || view.header?.title !== reopenedTitle
        || view.label !== census.view.label || (view.portal !== census.view.portal && census.view.portal.isConnected)) return false;
    } else if (!sameVirtualView(census.view, view)) return false;
    return matchesStartingRows(readVirtualSlice(menu, census.total), census);
  }

  async function readVirtualLeaves(menu: HTMLElement, atRoot: boolean, expected?: { census: VirtualCensus; key: string; id?: string }) {
    const view = virtualView(menu);
    if (!prompt || !view || (atRoot ? !!view.header : !view.header)) throw new Error('The menu displays only a subset of its options.');
    if (atRoot) {
      if (rootVirtualView && !sameVirtualView(rootVirtualView, view)) throw new Error('The Workday menu changed while reading its options.');
      rootVirtualView = view;
    }
    const initialTop = menu.scrollTop;
    const viewport = menu.clientHeight;
    const total = Number(readItems(menu)[0]?.element.getAttribute('aria-setsize'));
    if (!Number.isInteger(total) || total < 1 || total > maxItems) throw new Error('The Workday menu size could not be verified.');
    let commandedTop = initialTop;
    const bottom = () => menu.scrollHeight - viewport;
    const atBottom = () => Math.abs(commandedTop - bottom()) <= 1;
    const viewportTop = () => menu.getBoundingClientRect().top + menu.clientTop;
    const roundingTolerance = 2;

    function stillOwnsView() {
      return (search ? currentSearchMenu() : workdayPromptMenu(trigger, prompt!)) === menu && sameVirtualView(view!, virtualView(menu))
        && menu.clientHeight === viewport && Math.abs(menu.scrollTop - Math.min(commandedTop, bottom())) <= 1;
    }

    function checkView() {
      guard();
      if (!stillOwnsView()) throw new Error('The Workday menu changed while reading its options.');
    }

    const signed = (slots: VirtualSlot[]) => JSON.stringify(slots.map(({ position, id, item }) => [position, id, item.key]));
    const initialRows = readVirtualSlice(menu, total);
    const initialPosition = initialRows[0]?.position;
    if (!initialPosition) throw new Error('The Workday menu did not render its starting options.');
    const initialWindow = signed(initialRows);
    async function seek(top: number, ready: (slice: VirtualSlot[], hadRenderOpportunity: boolean) => boolean, settleWindow = false): Promise<VirtualSlot[]> {
      checkView();
      let hadRenderOpportunity = true;
      if (Math.abs(top - commandedTop) > 1) {
        menu.scrollTop = top;
        commandedTop = menu.scrollTop;
        hadRenderOpportunity = false;
        // Wait for a fresh render when overscan could otherwise satisfy this seek.
        if (settleWindow) {
          await new Promise<void>(resolve => win.setTimeout(resolve, 40));
          checkView();
          hadRenderOpportunity = true;
        }
      }
      const done = optionWaitDeadline(trigger, 300, 2000);
      while (true) {
        // Measuring the final rows can shorten the scroll range and clamp the last command.
        commandedTop = Math.min(commandedTop, bottom());
        const rows = readVirtualSlice(menu, total);
        if (ready(rows, hadRenderOpportunity)) return rows;
        if (done()) throw new Error('The Workday menu did not render its requested options.');
        await new Promise<void>(resolve => win.setTimeout(resolve, 20));
        checkView();
        hadRenderOpportunity = true;
      }
    }

    const expectedSlot = (slot: VirtualSlot) => slot.item.key === expected?.key && (!expected.id || slot.id === expected.id);
    const found = new Map<number, VirtualSlot>();
    const seenIds = new Map<string, number>();
    let selectedTop: number | undefined;
    function remember(slice: VirtualSlot[]) {
      for (const slot of slice) {
        const prior = found.get(slot.position);
        const priorPosition = seenIds.get(slot.id);
        if ((prior && !sameVirtualSlot(prior, slot))
          || (priorPosition !== undefined && priorPosition !== slot.position)) {
          throw new Error('The Workday virtual options changed or became ambiguous.');
        }
        found.set(slot.position, slot);
        seenIds.set(slot.id, slot.position);
        if (expectedSlot(slot)) {
          // An overscan row may disappear when approaching the same viewport from the other direction.
          const row = slot.item.element.getBoundingClientRect();
          selectedTop = Math.max(0, menu.scrollTop + row.top - viewportTop());
        }
      }
    }

    function reachesPhysicalEnd(last: VirtualSlot | undefined): boolean {
      if (!last || last.position !== total || !atBottom()) return false;
      const row = last.item.element.getBoundingClientRect();
      const content = view!.content.getBoundingClientRect();
      const top = viewportTop();
      const viewportEnd = top + viewport;
      // An old overscan window can include the last declared row without reaching the content end.
      return row.height > 0 && row.bottom > top && row.top < viewportEnd
        && Math.abs(row.bottom - content.bottom) <= roundingTolerance
        && Math.abs(content.bottom - viewportEnd) <= roundingTolerance;
    }

    function coversViewport(rows: VirtualSlot[]): boolean {
      const first = rows[0]?.item.element.getBoundingClientRect();
      const last = rows.at(-1)?.item.element.getBoundingClientRect();
      const top = viewportTop();
      return !!first && !!last && first.height > 0 && last.height > 0
        && first.top <= top + roundingTolerance && last.bottom >= top + viewport - roundingTolerance;
    }

    let census: VirtualCensus;
    let slots: VirtualSlot[];
    let leaf: Item | undefined;
    try {
      let slice = await seek(0, rows => rows[0]?.position === 1);
      remember(slice);
      for (let step = 0; step <= maxVirtualScrolls; step++) {
        if (atBottom()) {
          slice = await seek(commandedTop, rows => rows.length > 0 && (!atBottom() || reachesPhysicalEnd(rows.at(-1))));
          remember(slice);
          if (atBottom()) break;
        }
        if (step === maxVirtualScrolls) break;
        const previousFirst = slice[0].position;
        const previousLast = slice.at(-1)!.position;
        const overlap = slice[0].item.element.getBoundingClientRect().height;
        const stride = Math.max(1, Math.floor(viewport / 2), Math.floor(viewport - overlap));
        const next = Math.min(commandedTop + stride, bottom());
        // Directional overscan can move the mounted range backward even as the viewport moves forward.
        slice = await seek(next, (rows, hadRenderOpportunity) => rows.length > 0
          && (rows[0].position !== previousFirst || rows.at(-1)?.position !== previousLast
            || (hadRenderOpportunity && coversViewport(rows))));
        remember(slice);
      }
      if (found.size !== total || !reachesPhysicalEnd(slice.at(-1))) {
        throw new Error('Not every option in this Workday menu could be verified.');
      }
      slots = [...found.values()].sort((a, b) => a.position - b.position);
      census = { view, initialTop, initialPosition, total, slots: found, signature: signed(slots) };
      if (expected) {
        if (census.signature !== expected.census.signature) throw new Error('The Workday menu options changed.');
        const matches = slots.filter(expectedSlot);
        if (matches.length !== 1 || selectedTop === undefined) throw new Error('The Workday menu path changed or became ambiguous.');
        const selected = matches[0];
        const sameSlot = (row: VirtualSlot) => sameVirtualSlot(selected, row);
        const replay = await seek(Math.min(selectedTop, bottom()), rows => rows.some(sameSlot), true);
        remember(replay);
        leaf = replay.find(sameSlot)?.item;
      }
    } catch (error) {
      // Best-effort restoration cannot replace the original verification failure.
      if (stillOwnsView()) await seek(initialTop, rows => signed(rows) === initialWindow, true).catch(() => undefined);
      throw error;
    }
    if (!leaf) await seek(initialTop, rows => Math.abs(commandedTop - initialTop) <= 1 && matchesStartingRows(rows, census), true);
    return { entries: slots.map(({ item }) => item), census, leaf };
  }

  function backButton(menu: HTMLElement): HTMLElement | undefined {
    const buttons = [...menu.querySelectorAll<HTMLElement>('button[type="button"][data-automation-id="promptBackButton"]')]
      .filter((button) => button.closest(groupSelector) === menu && writable(button) && canClickOption(button));
    return buttons.length === 1 ? buttons[0] : undefined;
  }

  async function openBranch(parent: ConfirmedMenu, key: string): Promise<{
    next: ConfirmedMenu;
    workdayTitle?: string;
    close: (confirmed?: ConfirmedMenu, verifyStart?: VerifyMenu) => Promise<ConfirmedMenu>;
  }> {
    guard();
    const { menu } = parent;
    const branch = refind(menu, key);
    if (prompt) {
      const option = workdayPromptOption(branch.element, prompt);
      if (!option?.branch || !ownsMenu(parent)) throw new Error('The Workday prompt category changed.');
      const parentTitle = workdayPromptHeader(menu)?.title;
      const prior = signature(menu);
      option.activation.click();
      const next = await waitForMenu(() => {
        const current = nestedPopup(trigger);
        return current && workdayPromptHeader(current)?.title === branch.label && signature(current) !== prior ? current : undefined;
      });
      const entered = signature(next.menu);
      return { next, workdayTitle: branch.label, close: async (confirmed = next, verifyStart) => {
        guard();
        const current = nestedPopup(trigger);
        const header = current && workdayPromptHeader(current);
        if (!current || !ownsMenu(confirmed) || !header || header.title !== branch.label
          || (verifyStart ? !verifyStart(current) : signature(current) !== entered)) {
          throw new Error('The Workday prompt changed while returning to its parent.');
        }
        header.back.click();
        return waitForMenu(() => {
          const restored = nestedPopup(trigger);
          return restored && workdayPromptHeader(restored)?.title === parentTitle && signature(restored) === prior ? restored : undefined;
        });
      } };
    }
    const child = childOf(menu, key);
    if (!child && !comboListIds(branch.element).length && isWorkdayChoice(trigger)
      && branch.element.matches('[data-automation-id="promptBranchNode"]') && nestedPopup(trigger) === menu) {
      const prior = signature(menu);
      branch.element.click();
      const next = await waitForMenu(() => nestedPopup(trigger) === menu && backButton(menu) && signature(menu) !== prior ? menu : undefined);
      const entered = signature(next.menu);
      return { next, close: async () => {
        const back = backButton(next.menu);
        if (!revalidate() || nestedPopup(trigger) !== next.menu || !back || signature(next.menu) !== entered) {
          throw new Error('The menu changed while returning to its parent.');
        }
        back.click();
        return waitForMenu(() => signature(menu) === prior ? menu : undefined);
      } };
    }
    const opened = !child || !writable(child) || branch.element.getAttribute('aria-expanded') === 'false';
    if (opened) branch.element.click();
    const next = await waitForMenu(() => childOf(menu, key));
    return { next, close: async () => {
      if (!opened || !revalidate() || !writable(next.menu)) return parent;
      const current = refind(menu, key);
      if (current.element.getAttribute('aria-expanded') === 'true' && childOf(menu, key) === next.menu) {
        current.element.click();
        return waitForMenu(() => !writable(next.menu) ? menu : undefined);
      }
      return parent;
    } };
  }

  async function collect(initial: ConfirmedMenu, path: Path): Promise<ConfirmedMenu> {
    if (prompt && !ownsMenu(initial)) throw new Error('The associated menu changed.');
    const { menu } = initial;
    const view = signature(menu);
    const views = activeViews.get(menu) ?? new Set<string>();
    if (path.length > maxDepth || views.has(view)) throw new Error('The menu contains an unsupported or circular path.');
    if (menu.matches('[aria-multiselectable="true"]')) throw new Error('The menu permits multiple selections.');
    views.add(view);
    activeViews.set(menu, views);
    const pathKey = JSON.stringify(path);
    visitedPaths.set(pathKey, view);
    let entries = readItems(menu);
    const partial = entries.some(({ element }) => Number(element.getAttribute('aria-setsize')) > entries.length);
    if (prompt && (partial || isWorkdayVirtualizedList(menu))) {
      const verified = await readVirtualLeaves(menu, path.length === 0);
      entries = verified.entries;
      virtualPaths.set(pathKey, verified.census);
    } else if (partial) {
      throw new Error('The menu displays only a subset of its options.');
    }
    options += entries.length;
    if (options > maxItems) throw new Error('The menu has too many options to verify.');
    let current = initial;
    guard();
    for (const item of entries) {
      const nextPath = [...path, item.key];
      if (!item.branch) {
        const score = rank!(item);
        if (!score || score < bestRank) continue;
        if (score > bestRank) {
          bestRank = score;
          hits.length = 0;
        }
        hits.push(nextPath);
        continue;
      }
      if (++branches > maxBranches) throw new Error('The menu has too many branches to verify.');
      const { next, close } = await openBranch(current, item.key);
      let confirmed: ConfirmedMenu;
      try {
        confirmed = await collect(next, nextPath);
      } catch (error) {
        await close().catch(() => undefined);
        throw error;
      }
      const census = virtualPaths.get(JSON.stringify(nextPath));
      current = await close(confirmed, census && (current => verifiedVirtualStart(current, census)));
    }
    views.delete(view);
    return current;
  }

  if (search) {
    guard();
    const { menu, select } = search;
    if (!search.multiple && menu.matches('[aria-multiselectable="true"]')) throw new Error('The search menu permits multiple selections.');
    if (isWorkdayVirtualizedList(menu, search.portal)) {
      const { entries, census } = await readVirtualLeaves(menu, true);
      const choice = select(entries);
      const selected = entries.find(item => item === choice);
      if (!selected) return undefined;
      const result = await readVirtualLeaves(menu, true, { census, key: selected.key, id: selected.element.id });
      guard();
      return result.leaf;
    }

    const rows = readItems(menu);
    const resultNodes = menu.querySelectorAll('[role="option"]');
    if (!rows.length && !resultNodes.length && /^No Items$/i.test(labelText(menu))) return undefined;
    const slots = readVirtualSlice(menu, rows.length);
    if (!rows.length || rows.length > maxItems || resultNodes.length !== slots.length
      || slots.some(({ position }, index) => position !== index + 1)) throw new Error('The Workday search result count could not be verified.');
    guard();
    return select(slots.map(({ item }) => item));
  }

  if (prompt && (trigger as HTMLInputElement).value) throw new Error('Clear the Workday search to verify its full menu.');
  const root = await waitForMenu(() => nestedPopup(trigger));
  if (prompt && workdayPromptHeader(root.menu)) throw new Error('Return to the first category list before filling this Workday prompt.');
  let current = await collect(root, []);
  if (hits.length !== 1) throw new Error('No unique option matches this answer in the open menu.');
  guard();
  if (!ownsMenu(current)) throw new Error('The associated menu changed.');
  let reopenedTitle: string | undefined;
  const path: Path = [];
  for (const key of hits[0].slice(0, -1)) {
    if (signature(current.menu) !== visitedPaths.get(JSON.stringify(path))) throw new Error('The menu options changed.');
    const branch = await openBranch(current, key);
    current = branch.next;
    reopenedTitle = branch.workdayTitle;
    path.push(key);
  }
  if (prompt && !ownsMenu(current)) throw new Error('The associated menu changed.');
  const { menu } = current;
  const pathKey = JSON.stringify(path);
  const census = virtualPaths.get(pathKey);
  if (census ? !verifiedVirtualStart(menu, census, reopenedTitle) : signature(menu) !== visitedPaths.get(pathKey)) {
    throw new Error('The menu options changed.');
  }
  const key = hits[0].at(-1)!;
  const leaf = census ? (await readVirtualLeaves(menu, path.length === 0, { census, key })).leaf : refind(menu, key);
  guard();
  if (!leaf || leaf.branch || rank!(leaf) !== bestRank) throw new Error('The selected leaf changed.');
  return leaf;
}
