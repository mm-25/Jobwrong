import { canClickOption, labelText, menuForId, normalize, samePopupScope, visible, writable, type Choice } from './discovery';
import { findNestedOption, optionWaitDeadline } from './nested-options';

const inputSelector = 'input#skills--skills[data-uxi-widget-type="selectinput"][data-uxi-multiselect-id][enterkeyhint="search"]';
const containerSelector = '[data-automation-id="multiSelectContainer"]';
const portalSelector = '[data-automation-id="responsiveMonikerPrompt"][data-associated-widget][data-automation-type="multiSelectPrompt"][data-uxi-prompt-type="multiselect"]';
const menuSelector = '[role="listbox"][data-automation-id="activeListContainer"]';
const selectionListSelector = '[role="listbox"][data-automation-id="selectedItemList"]';
const selectionSelector = '[role="option"][data-automation-id="selectedItem"]';
const optionSelector = '[role="option"][data-automation-id="menuItem"]';

export type WorkdaySkillsWidget = {
  input: HTMLInputElement;
  container: HTMLElement;
  wrapper: HTMLElement;
  page: HTMLElement;
  form: HTMLFormElement | null;
};
export type WorkdaySkillSelection = { id: string; label: string; element: HTMLElement };
type OwnsSkills = (query: string, selections: WorkdaySkillSelection[], afterOwnedWrite?: true) => boolean;
type OwnMutation = (write: () => void) => void;

export function workdaySkillsWidget(element: HTMLElement): WorkdaySkillsWidget | undefined {
  if (!element.matches(inputSelector) || (element as HTMLInputElement).type !== 'text' || !writable(element)) return undefined;
  const input = element as HTMLInputElement;
  const wrapper = input.closest<HTMLElement>('[data-automation-id="formField-skills"]');
  const page = input.closest<HTMLElement>('[data-automation-id="applyFlowMyExpPage"]');
  const container = input.closest<HTMLElement>(containerSelector);
  const labels = Array.from(input.labels ?? []);
  if (!page || !wrapper || wrapper.getAttribute('data-fkit-id') !== input.id || !page.contains(wrapper)
    || labels.length !== 1 || !wrapper.contains(labels[0]) || labels[0].htmlFor !== input.id
    || !visible(labels[0]) || normalize(labelText(labels[0])) !== 'type to add skills'
    || !container?.id || !wrapper.contains(container) || !container.querySelector('[data-automation-id="promptSelectionLabel"]')
    || container.id !== input.getAttribute('data-uxi-multiselect-id') || menuForId(input, container.id) !== container
    || menuForId(input, input.id) !== input || container.querySelectorAll('input[data-uxi-widget-type="selectinput"]').length !== 1) return undefined;
  return { input, container, wrapper, page, form: input.form };
}

export function insideWorkdaySkillsUI(element: Element): boolean {
  const portal = element.closest(portalSelector);
  const selectionList = element.closest(selectionListSelector);
  if (!portal && !selectionList) return false;
  const root = element.getRootNode() as Document | ShadowRoot;
  const input = root.getElementById?.('skills--skills') as HTMLElement | null;
  const widget = input && workdaySkillsWidget(input);
  if (!widget) return false;
  if (portal) return portal.getAttribute('data-associated-widget') === widget.container.id && samePopupScope(widget.input, portal);
  return !!selectionList && selectionList.closest(containerSelector) === widget.container
    && selectionList.getAttribute('data-uxi-multiselect-id') === widget.container.id;
}

function stillOwnsWidget(widget: WorkdaySkillsWidget): boolean {
  const current = workdaySkillsWidget(widget.input);
  return current?.container === widget.container && current.wrapper === widget.wrapper && current.page === widget.page
    && current.form === widget.form;
}

function caption(root: HTMLElement): string {
  const nodes = root.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"]');
  if (nodes.length !== 1 || !visible(nodes[0])) return '';
  const node = nodes[0];
  const label = labelText(node);
  return label && label === node.getAttribute('data-automation-label') ? label : '';
}

export function workdaySkillSelections(widget: WorkdaySkillsWidget): WorkdaySkillSelection[] | undefined {
  if (!stillOwnsWidget(widget)) return undefined;
  const { container } = widget;
  const lists = [...container.querySelectorAll<HTMLElement>(selectionListSelector)]
    .filter(list => list.closest(containerSelector) === container && visible(list));
  if (lists.length > 1) return undefined;
  if (!lists.length) return container.querySelector(selectionSelector) ? undefined : [];
  const list = lists[0];
  if (list.getAttribute('data-uxi-multiselect-id') !== container.id) return undefined;
  const selections = [...list.querySelectorAll<HTMLElement>(selectionSelector)];
  const seen = new Set<string>();
  const result: WorkdaySkillSelection[] = [];
  for (const element of selections) {
    const id = /^pill-(REMOTE_SKILL-[\w-]+)$/.exec(element.id)?.[1];
    const label = caption(element);
    if (!id || seen.has(id) || !label || !visible(element) || element.closest(selectionListSelector) !== list
      || normalize(element.getAttribute('aria-label') ?? '') !== normalize(`${label}, press delete to clear value.`)) return undefined;
    seen.add(id);
    result.push({ id, label, element });
  }
  return result;
}

export function sameWorkdaySkillSelections(left: WorkdaySkillSelection[], right: WorkdaySkillSelection[]): boolean {
  return left.length === right.length && left.every((selection, index) => {
    const other = right[index];
    return selection.id === other.id && selection.label === other.label && selection.element === other.element;
  });
}

export function workdaySkillKey(label: string): string {
  const cleaned = label.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const acronym = /\s+\(([A-Z][A-Z0-9]{1,7})\)$/.exec(cleaned);
  if (!acronym) return normalize(cleaned);
  const name = cleaned.slice(0, acronym.index);
  const initials = name.split(/[\s-]+/).map(word => word[0] ?? '').join('').toUpperCase();
  const userExperience = normalize(name) === 'user experience' && acronym[1] === 'UX';
  return normalize(initials === acronym[1] || userExperience ? name : cleaned);
}

function skillPortal(widget: WorkdaySkillsWidget): HTMLElement | undefined {
  const { input, container } = widget;
  const root = input.getRootNode() as Document | ShadowRoot;
  const portals = [...root.querySelectorAll<HTMLElement>(portalSelector)].filter(portal =>
    portal.getAttribute('data-associated-widget') === container.id && samePopupScope(input, portal) && writable(portal));
  return portals.length === 1 ? portals[0] : undefined;
}

function skillMenu(widget: WorkdaySkillsWidget): HTMLElement | undefined {
  const portal = skillPortal(widget);
  const menus = portal?.querySelectorAll<HTMLElement>(menuSelector);
  const menu = menus?.length === 1 ? menus[0] : undefined;
  return menu && writable(menu) && menu.closest(portalSelector) === portal
    && !!menu.closest('[data-uxi-multiselectlist-issearch="true"]') ? menu : undefined;
}

type SkillChoice = Choice & { activation: HTMLInputElement; id: string; branch: false };

function skillOption(element: HTMLElement, widget: WorkdaySkillsWidget): SkillChoice | undefined {
  const id = /^menuItem-(REMOTE_SKILL-[\w-]+)$/.exec(element.id)?.[1];
  const leaves = element.querySelectorAll<HTMLElement>('[data-automation-id="promptLeafNode"]');
  const leaf = leaves[0];
  if (!id || leaves.length !== 1 || leaf.getAttribute('data-uxi-multiselect-id') !== widget.container.id
    || leaf.getAttribute('data-uxi-multiselectlistitem-hassidecharm') !== 'false' || !canClickOption(leaf) || !writable(leaf)) return undefined;
  const boxes = leaf.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-automation-id="checkboxPanel"]');
  const activation = boxes[0];
  const label = caption(leaf);
  const selected = leaf.getAttribute('data-uxi-multiselectlistitem-isselected');
  if (!label || boxes.length !== 1 || (selected !== 'true' && selected !== 'false')
    || activation.matches(':disabled') || activation.getAttribute('aria-checked') !== selected
    || normalize(element.getAttribute('aria-label') ?? '') !== normalize(`${label} ${selected === 'true' ? '' : 'not '}checked`)) return undefined;
  return { id, label, element, activation, value: id, branch: false };
}

function tick(input: HTMLInputElement): Promise<void> {
  return new Promise(resolve => input.ownerDocument.defaultView!.setTimeout(resolve, 20));
}

function keys(element: HTMLElement, key: 'Enter' | 'Escape') {
  const { KeyboardEvent } = element.ownerDocument.defaultView!;
  const root = element.getRootNode() as Document | ShadowRoot;
  const options = { key, code: key, keyCode: key === 'Enter' ? 13 : 27, bubbles: true, cancelable: true, composed: true };
  element.dispatchEvent(new KeyboardEvent('keydown', options));
  if (element.isConnected && root.activeElement === element) element.dispatchEvent(new KeyboardEvent('keyup', options));
}

function queryInput(input: HTMLInputElement, value: string) {
  const { HTMLInputElement, Event } = input.ownerDocument.defaultView!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

async function chooseSkill(widget: WorkdaySkillsWidget, query: string, validate: () => boolean): Promise<SkillChoice | undefined> {
  const { input, container } = widget;
  const expired = optionWaitDeadline(input, 1500, 4000);
  const key = workdaySkillKey(query);
  while (validate() && !expired()) {
    const menu = skillMenu(widget);
    const portal = skillPortal(widget);
    if (menu && portal && !menu.closest('[aria-busy="true"]') && menu.querySelector(optionSelector)) {
      const choice = await findNestedOption(input, undefined, validate, {
        menu, query, container, portal, multiple: true,
        currentMenu: () => skillMenu(widget),
        readOption: element => skillOption(element, widget),
        select: choices => {
          const matches = choices.filter(({ label }) => workdaySkillKey(label) === key);
          return matches.length === 1 ? matches[0] : undefined;
        },
      }).catch(() => undefined);
      return choice && skillMenu(widget) === menu && menu.contains(choice.element)
        ? skillOption(choice.element, widget) : undefined;
    }
    await tick(input);
  }
  return undefined;
}

export async function appendWorkdaySkills(
  widget: WorkdaySkillsWidget, desired: string[], owns: OwnsSkills, ownMutation: OwnMutation,
): Promise<WorkdaySkillSelection[] | undefined> {
  const { input } = widget;
  const initial = workdaySkillSelections(widget);
  if (!initial || input.value || skillPortal(widget) || !owns('', initial)) return undefined;

  let selections = initial;
  const present = new Set(initial.map(({ label }) => workdaySkillKey(label)));
  const queries = new Map<string, string>();
  for (const raw of desired) {
    const label = raw.trim();
    const key = workdaySkillKey(label);
    if (key && label.length <= 150 && !present.has(key) && !queries.has(key)) queries.set(key, label);
    if (queries.size === 40) break;
  }
  const runExpired = optionWaitDeadline(input, 30000, 60000);
  for (const [key, query] of queries) {
    if (present.has(key)) continue;
    if (runExpired() || !owns('', selections, true) || skillPortal(widget)) break;

    const root = input.getRootNode() as Document | ShadowRoot;
    ownMutation(() => input.focus({ preventScroll: true }));
    if (root.activeElement !== input || !owns('', selections, true)) break;
    let currentQuery = query;
    let results: { portal: HTMLElement; menu: HTMLElement } | undefined;
    const searchFocus = (allowClosed = false): HTMLElement | undefined => {
      const portal = skillPortal(widget);
      const menu = skillMenu(widget);
      const focused = root.activeElement;
      if (results && (results.portal !== portal || results.menu !== menu)) {
        return allowClosed && !portal && focused === input ? input : undefined;
      }
      if (!results && portal && menu) results = { portal, menu };
      if (focused === input) return input;
      return focused === results?.menu ? results.menu : undefined;
    };
    try {
      ownMutation(() => {
        queryInput(input, query);
        if (input.value === query && root.activeElement === input) keys(input, 'Enter');
      });

      const ownSearch = () => !runExpired() && !!searchFocus() && owns(query, selections, true);
      const option = await chooseSkill(widget, query, ownSearch);
      if (!option || selections.some(({ id }) => id === option.id) || !ownSearch()
        || skillOption(option.element, widget)?.activation !== option.activation
        || option.activation.getAttribute('aria-checked') !== 'false') continue;

      ownMutation(() => option.activation.click());
      const expired = optionWaitDeadline(input, 350, 1000);
      while (!expired()) {
        const live = workdaySkillSelections(widget);
        if (!live || !owns(input.value, live, true) || (input.value && input.value !== query)) break;
        if (live.length === selections.length + 1) {
          const additional = live.find(({ id }) => id === option.id);
          const remaining = live.filter(({ id }) => id !== option.id);
          if (additional?.label === option.label && sameWorkdaySkillSelections(selections, remaining)) {
            selections = live;
            present.add(workdaySkillKey(option.label));
            currentQuery = input.value;
          }
          break;
        }
        if (!sameWorkdaySkillSelections(selections, live)) break;
        await tick(input);
      }
    } finally {
      if (searchFocus(true) && owns(currentQuery, selections, true)) {
        const portal = skillPortal(widget);
        ownMutation(() => {
          if (currentQuery) queryInput(input, '');
          const focused = searchFocus(true);
          if (focused && owns('', selections, true) && portal && portal === skillPortal(widget)) keys(focused, 'Escape');
          if (root.activeElement === input && owns('', selections, true)) input.blur();
        });
      }
    }
  }
  return selections === initial ? undefined : selections;
}

function skillClear(selection: WorkdaySkillSelection): HTMLElement | undefined {
  const options = selection.element.querySelectorAll<HTMLElement>(
    ':scope > div[data-automation-id="DELETE_charm"][role="presentation"][aria-hidden="true"][tabindex="-1"]',
  );
  const charm = options[0];
  if (options.length !== 1 || !canClickOption(charm) || charm.matches('[hidden], [inert], [aria-disabled="true"]')) return undefined;
  const style = charm.ownerDocument.defaultView?.getComputedStyle(charm);
  return style && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' ? charm : undefined;
}

export async function restoreWorkdaySkills(
  widget: WorkdaySkillsWidget, before: WorkdaySkillSelection[], after: WorkdaySkillSelection[],
  owns: OwnsSkills, ownMutation: OwnMutation,
): Promise<boolean> {
  const { input } = widget;
  const added = after.filter(selection => !before.some(({ id }) => selection.id === id));
  if (!added.length || !owns('', after) || !sameWorkdaySkillSelections(before, after.filter(selection => !added.includes(selection)))) return false;
  const removals = added.reverse().map(selection => ({ selection, clear: skillClear(selection) }));
  if (removals.some(({ clear }) => !clear)) return false;
  let current = after;
  for (const { selection, clear } of removals) {
    if (!clear || skillClear(selection) !== clear || !owns('', current, true)
      || !sameWorkdaySkillSelections(current, workdaySkillSelections(widget) ?? [])) return false;
    const next = current.filter(item => item !== selection);
    ownMutation(() => clear.click());
    const expired = optionWaitDeadline(input, 350, 1000);
    while (!owns('', next, true)) {
      if (expired() || !owns('', current, true)) return false;
      await tick(input);
    }
    current = next;
  }
  return sameWorkdaySkillSelections(before, current);
}
