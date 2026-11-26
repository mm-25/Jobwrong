import { canClickOption, labelText, menuForId, normalize, samePopupScope, visible, writable, type Choice } from './discovery';

const workdayRoot = '[data-automation-id="applyFlowPage"], [data-automation-id="applyFlowMyInfoPage"], [data-automation-id="applyFlowMyExpPage"]';

const promptContainer = '[data-automation-id="multiSelectContainer"]';
const promptInput = 'input[data-uxi-widget-type="selectinput"][data-uxi-multiselect-id][enterkeyhint="search"]';
const promptPortal = '[data-automation-id="responsiveMonikerPrompt"][data-associated-widget][data-automation-type="singleSelectPrompt"][data-uxi-prompt-type="singleselect"]';
const activeList = '[role="listbox"][data-automation-id="activeListContainer"]';
const selectedList = '[role="listbox"][data-automation-id="selectedItemList"]';
const selectedItem = '[role="option"][data-automation-id="selectedItem"]';
const promptItem = '[role="option"][data-automation-id="menuItem"]';
const promptHeadings = '[data-automation-id="multiSelectHeader"], [data-automation-id="promptTitle"], [data-automation-id="backButton"]';
const searchView = '[data-uxi-widget-type="multiselectlist"][data-uxi-multiselectlist-isresponsive="false"][data-uxi-multiselectlist-issearch="true"]';

export function isWorkdayChoice(element: Element): boolean {
  return !!element.closest(workdayRoot) || /(?:^|\.)myworkdayjobs\.com$/i.test(element.ownerDocument.location?.hostname ?? '');
}

export function isWorkdayPromptInput(element: Element): boolean {
  return isWorkdayChoice(element) && element.matches(promptInput) && (element as HTMLInputElement).type === 'text';
}

export function workdayPrompt(element: Element): HTMLElement | undefined {
  if (!isWorkdayPromptInput(element)) return undefined;
  const inputContainer = element.closest('[data-automation-id="multiselectInputContainer"]');
  const container = inputContainer?.closest<HTMLElement>(promptContainer);
  const field = element.closest('[data-automation-id^="formField-"]');
  if (!container?.id || !field?.contains(container) || container.id !== element.getAttribute('data-uxi-multiselect-id')
    || menuForId(element, container.id) !== container
    || !inputContainer?.querySelector('[data-automation-id="promptSelectionLabel"]')) return undefined;
  const inputs = container.querySelectorAll(promptInput);
  return inputs.length === 1 && inputs[0] === element ? container : undefined;
}

export function insideWorkdayPromptUI(element: Element): boolean {
  return isWorkdayChoice(element) && !!element.closest(`${promptPortal}, ${selectedList}`);
}

export function workdayPromptMenu(input: HTMLElement, container: HTMLElement): HTMLElement | undefined {
  const root = input.getRootNode() as Document | ShadowRoot;
  const portals = [...root.querySelectorAll(promptPortal)].filter(portal =>
    portal.getAttribute('data-associated-widget') === container.id && samePopupScope(input, portal) && writable(portal));
  if (portals.length !== 1) return undefined;
  const menus = portals[0].querySelectorAll<HTMLElement>(activeList);
  return menus.length === 1 && samePopupScope(input, menus[0]) && writable(menus[0]) ? menus[0] : undefined;
}

export function workdayPromptPortal(input: HTMLElement, container: HTMLElement): HTMLElement | undefined {
  const root = input.getRootNode() as Document | ShadowRoot;
  const portals = [...root.querySelectorAll<HTMLElement>('[data-automation-id="responsiveMonikerPrompt"][data-associated-widget]')]
    .filter(portal => portal.getAttribute('data-associated-widget') === container.id && samePopupScope(input, portal) && visible(portal));
  return portals.length === 1 ? portals[0] : undefined;
}

export function workdayPromptSearchMenu(input: HTMLElement, container: HTMLElement): HTMLElement | undefined {
  const menu = workdayPromptMenu(input, container);
  const view = menu?.closest(searchView);
  const portal = workdayPromptPortal(input, container);
  if (!view || !menu || !portal?.contains(view) || menu.closest('[aria-busy="true"]')) return undefined;
  if (portal.querySelector(promptHeadings) && !workdaySearchResultsHeader(menu, portal)) return undefined;
  return menu;
}

function workdaySearchResultsHeader(menu: HTMLElement, portal: Element): { element: Element; count: number } | undefined {
  const view = menu.closest(searchView);
  const headings = portal.querySelectorAll(promptHeadings);
  const [element, title] = headings;
  if (view?.parentElement !== portal || headings.length !== 2 || element.parentElement !== portal
    || !element.matches('div[data-automation-id="multiSelectHeader"][data-uxi-widget-type="multiselectlistheader"][data-uxi-multiselectlistheader-clickable="false"]')
    || element.getAttribute('data-uxi-multiselect-id') !== portal.getAttribute('data-associated-widget') || !visible(element)
    || element.children.length !== 2 || element.firstElementChild !== title
    || !title.matches('div[data-automation-id="promptTitle"][aria-hidden="true"][title]:not([hidden], [inert])')) return undefined;
  const caption = labelText(title);
  const countElement = element.lastElementChild!;
  const count = /^\(([1-9]\d*)\)$/.exec(labelText(countElement));
  if (normalize(caption) !== 'search results' || caption !== title.getAttribute('title')
    || !countElement.matches('div') || !visible(countElement) || !count) return undefined;
  const total = Number(count[1]);
  const mounted = menu.querySelector(promptItem);
  return Number.isSafeInteger(total) && total > 1 && mounted?.getAttribute('aria-setsize') === count[1]
    ? { element, count: total } : undefined;
}

function workdayVirtualizedContent(menu: HTMLElement, portal = menu.closest(promptPortal)): HTMLElement | undefined {
  if (!menu.matches(`${activeList}.ReactVirtualized__Grid.ReactVirtualized__List`) || !portal?.contains(menu)
    || menu.clientHeight <= 0 || menu.scrollHeight <= menu.clientHeight) return undefined;
  const containers = menu.querySelectorAll<HTMLElement>(':scope > .ReactVirtualized__Grid__innerScrollContainer[role="presentation"]');
  if (containers.length !== 1) return undefined;
  const style = menu.ownerDocument.defaultView?.getComputedStyle(menu);
  return /^(?:auto|scroll)$/.test(style?.overflowY || style?.overflow.trim().split(/\s+/).at(-1) || '') ? containers[0] : undefined;
}

export function isWorkdayVirtualizedList(menu: HTMLElement, portal?: Element): boolean {
  return !!workdayVirtualizedContent(menu, portal);
}

export function workdayVirtualizedView(menu: HTMLElement, portal = menu.closest(promptPortal), allowResultsHeader = false) {
  const content = workdayVirtualizedContent(menu, portal);
  if (!portal || !content) return undefined;
  const header = workdayPromptHeader(menu);
  const resultsHeader = allowResultsHeader ? workdaySearchResultsHeader(menu, portal) : undefined;
  // A malformed category must not be treated as a headerless root.
  if (!header && !resultsHeader && portal.querySelector(promptHeadings)) {
    return undefined;
  }
  return { menu, portal, content, header, resultsHeader, label: menu.getAttribute('aria-label') };
}

export function workdayPromptHeader(menu: HTMLElement): { title: string; back: HTMLElement } | undefined {
  const portal = menu.closest(promptPortal);
  const headers = portal?.querySelectorAll('[data-automation-id="multiSelectHeader"]');
  if (headers?.length !== 1) return undefined;
  const header = headers[0];
  const titles = header.querySelectorAll<HTMLElement>('[data-automation-id="promptTitle"]');
  const buttons = header.querySelectorAll<HTMLElement>('span[data-automation-id="backButton"]');
  if (titles.length !== 1 || buttons.length !== 1 || !writable(buttons[0]) || !canClickOption(buttons[0])) return undefined;
  const titleNode = titles[0];
  const title = labelText(titleNode);
  if (!title) return undefined;
  // Workday renders the category heading visually while excluding it from the accessibility tree.
  if (!visible(titleNode)) {
    const style = titleNode.ownerDocument.defaultView?.getComputedStyle(titleNode);
    if (!header.matches('[data-uxi-widget-type="multiselectlistheader"][data-uxi-multiselectlistheader-clickable="true"]')
      || header.getAttribute('data-uxi-multiselect-id') !== portal?.getAttribute('data-associated-widget')
      || titleNode.parentElement !== header || !titleNode.matches('div[aria-hidden="true"][title]:not([hidden], [inert])')
      || !visible(header) || normalize(titleNode.title) !== normalize(title) || !style
      || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') return undefined;
  }
  return { title, back: buttons[0] };
}

function promptCaption(item: HTMLElement): string {
  const captions = item.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"]');
  return captions.length === 1 && visible(captions[0]) ? labelText(captions[0]) : '';
}

export function workdayPromptOption(item: HTMLElement, container: HTMLElement): (Choice & { activation: HTMLElement; branch: boolean }) | undefined {
  if (!item.matches(promptItem)) return undefined;
  const nodes = item.querySelectorAll<HTMLElement>('[data-automation-id="promptLeafNode"][data-uxi-multiselect-id]');
  const activation = nodes[0];
  if (nodes.length !== 1 || activation.getAttribute('data-uxi-multiselect-id') !== container.id
    || !writable(activation) || !canClickOption(activation)) return undefined;
  const label = promptCaption(activation);
  const name = item.getAttribute('aria-label')?.replace(/\s+(?:not )?checked$/i, '') ?? '';
  if (!label || normalize(label) !== normalize(name)) return undefined;
  return { element: item, label, value: '', activation, branch: activation.getAttribute('data-uxi-multiselectlistitem-hassidecharm') === 'true' };
}

function promptSelections(container: HTMLElement): HTMLElement[] {
  const lists = [...container.querySelectorAll(selectedList)].filter(list => list.closest(promptContainer) === container
    && list.getAttribute('data-uxi-multiselect-id') === container.id && visible(list));
  return lists.flatMap(list => [...list.querySelectorAll<HTMLElement>(selectedItem)]
    .filter(item => item.closest(selectedList) === list && visible(item)));
}

export function workdayPromptSelection(container: HTMLElement): string {
  return promptSelections(container).map(promptCaption).filter(Boolean).join(', ');
}

export function workdayPromptSingleSelection(container: HTMLElement): string {
  const selections = promptSelections(container);
  return selections.length === 1 ? promptCaption(selections[0]) : '';
}

export function workdayPromptSelectionReceipt(container: HTMLElement): string {
  const selections = promptSelections(container);
  if (selections.length !== 1) return '';
  const [selection] = selections;
  const caption = promptCaption(selection);
  return caption && normalize(selection.getAttribute('aria-label') ?? '') === normalize(`${caption}, press delete to clear value.`) ? caption : '';
}

export function workdayPromptClear(container: HTMLElement): HTMLElement | undefined {
  const selections = promptSelections(container);
  if (selections.length !== 1) return undefined;
  const [selection] = selections;
  const caption = promptCaption(selection);
  if (!caption || normalize(selection.getAttribute('aria-label') ?? '') !== normalize(`${caption}, press delete to clear value.`)
    || !writable(selection)) return undefined;
  const buttons = selection.querySelectorAll<HTMLElement>(':scope > div[data-automation-id="DELETE_charm"][role="presentation"][aria-hidden="true"][tabindex="-1"]');
  const charm = buttons[0];
  if (buttons.length !== 1 || !canClickOption(charm) || charm.matches('[hidden], [inert], [aria-disabled="true"]')) return undefined;
  // Workday exposes the equivalent Delete action on the token and hides its visual icon from assistive technology.
  const style = charm.ownerDocument.defaultView?.getComputedStyle(charm);
  return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse' ? charm : undefined;
}
