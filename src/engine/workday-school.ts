import { comboActivation, normalize, writable, type Choice } from './discovery';
import { selectWorkdaySchool, type WorkdaySchoolSearch } from './education-school';
import { findNestedOption, optionWaitDeadline } from './nested-options';
import {
  workdayPrompt, workdayPromptClear, workdayPromptMenu, workdayPromptOption, workdayPromptPortal, workdayPromptSearchMenu,
  workdayPromptSelection, workdayPromptSelectionReceipt,
} from './workday-controls';
import { workdayEducationRow } from './workday-structure';

type SchoolState = { kind: 'combobox'; value: string; query?: string };
type SearchResult = { selected: SchoolState } | { menu: HTMLElement; portal: HTMLElement; choice: Choice | undefined };

export function workdaySchoolWidget(element: HTMLElement) {
  if (!/^education-\d+--school$/.test(element.id) || !element.matches('input')) return undefined;
  const wrapper = element.closest('[data-automation-id="formField-school"]');
  const identity = workdayEducationRow(element);
  const container = workdayPrompt(element);
  if (!wrapper || !identity || !container || !identity.row.contains(wrapper) || !wrapper.contains(container)
    || comboActivation(element) !== element || !writable(element)) return undefined;
  const input = element as HTMLInputElement;
  return { input, wrapper, container, group: identity.group, row: identity.row, form: input.form };
}

type WorkdaySchoolWidget = NonNullable<ReturnType<typeof workdaySchoolWidget>>;

function associatedPortals(widget: WorkdaySchoolWidget): Element[] {
  const root = widget.input.getRootNode() as Document | ShadowRoot;
  return [...root.querySelectorAll('[data-automation-id="responsiveMonikerPrompt"][data-associated-widget]')]
    .filter(portal => portal.getAttribute('data-associated-widget') === widget.container.id);
}

export function workdaySchoolStartsClosed(widget: WorkdaySchoolWidget): boolean {
  return !widget.input.value && !widget.container.querySelector('[data-automation-id="selectedItem"]')
    && !associatedPortals(widget).length;
}

export async function chooseWorkdaySchool(
  widget: WorkdaySchoolWidget, plan: WorkdaySchoolSearch,
  revalidate: (expected: SchoolState, afterOwnedWrite?: true) => boolean,
  ownInput: (event: Event) => void, ownMutation: (mutate: () => void) => void,
): Promise<SchoolState> {
  const { input, container } = widget;
  const win = input.ownerDocument.defaultView!;
  const root = input.getRootNode() as Document | ShadowRoot;
  const tick = () => new Promise<void>(resolve => win.setTimeout(resolve, 25));
  const queryFit = (query: string) => !!query && query.length <= 160 && !/[\r\n]/.test(query)
    && (input.maxLength < 0 || query.length <= input.maxLength);
  const blank: SchoolState = { kind: 'combobox', value: '' };
  const activeElement = () => root.activeElement;
  const inputFocused = () => activeElement() === input;
  const focusInput = () => ownMutation(() => input.focus({ preventScroll: true }));
  let applicantInteracted = false;
  const trackInteraction = (event: Event) => { if (event.isTrusted) applicantInteracted = true; };
  const ownsFocus = (menu?: HTMLElement) => {
    const active = activeElement();
    if (active === input) return true;
    if (!active || !menu?.contains(active)) return false;
    if (active === menu) return true;
    const item = active.closest<HTMLElement>('[role="option"][data-automation-id="menuItem"]');
    const option = item && menu.contains(item) ? workdayPromptOption(item, container) : undefined;
    return !!option && !option.branch && (active === item || option.activation.contains(active));
  };
  const owns = (expected: SchoolState, afterOwnedWrite?: true) => {
    const current = workdaySchoolWidget(input);
    return !applicantInteracted && current?.container === container && current.wrapper === widget.wrapper && current.group === widget.group
      && current.row === widget.row && current.form === widget.form && revalidate(expected, afterOwnedWrite);
  };
  const writeQuery = (query: string) => {
    const event = new win.InputEvent('input', { inputType: query ? 'insertText' : 'deleteContentBackward',
      data: query || null, bubbles: true, composed: true });
    ownInput(event);
    ownMutation(() => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, query);
      input.dispatchEvent(event);
    });
  };
  const key = (key: 'Enter' | 'Escape' | 'Tab', type: 'keydown' | 'keyup') => {
    ownMutation(() => input.dispatchEvent(new win.KeyboardEvent(type, {
      key, code: key, keyCode: { Enter: 13, Escape: 27, Tab: 9 }[key], bubbles: true, composed: true, cancelable: true,
    })));
  };

  if (!workdaySchoolStartsClosed(widget) || !owns(blank) || !queryFit(plan.query)) {
    throw new Error('The Workday school search field is no longer blank or available.');
  }

  let expected = blank;
  let ownedPortal: HTMLElement | undefined;
  let clicked = false;
  let committed = false;

  async function verifySiteSelection(label: string, query: string): Promise<SchoolState> {
    const expired = optionWaitDeadline(input);
    const review = 'Workday selected a school during the search. Review the current selection.';
    while (true) {
      const state: SchoolState = { kind: 'combobox', value: workdayPromptSelection(container) };
      if (input.value) state.query = input.value;
      if (state.value !== label || (state.query && state.query !== query) || !owns(state, true)) break;
      const active = activeElement();
      const list = active?.closest('[role="listbox"][data-automation-id="selectedItemList"]');
      const selectedFocus = !!list && container.contains(list) && list.getAttribute('data-uxi-multiselect-id') === container.id;
      if (!state.query && !associatedPortals(widget).length && (inputFocused() || selectedFocus)
        && workdayPromptSelectionReceipt(container) === label) {
        if (selectWorkdaySchool(plan, [{ label }], !!plan.campusName)) {
          committed = true;
          return state;
        }
        const clear = workdayPromptClear(container);
        if (!clear) break;
        ownMutation(() => clear.click());
        await tick();
        if (!container.querySelector('[data-automation-id="selectedItem"]') && owns(blank, true)) {
          throw new Error('Workday selected a school during the search that differed from the saved school. The selection was cleared.');
        }
        break;
      }
      if (expired() || (active && active !== input.ownerDocument.body && !selectedFocus
        && !ownsFocus(workdayPromptMenu(input, container)))) break;
      await tick();
    }
    throw new Error(review);
  }

  async function search(query: string, qualifiedOnly: boolean): Promise<SearchResult> {
    const previousMenu = workdayPromptMenu(input, container);
    const previousSearchMenu = workdayPromptSearchMenu(input, container);
    if (!ownsFocus(previousMenu) || !owns(expected) || workdayPromptPortal(input, container) !== ownedPortal || !queryFit(query)) {
      throw new Error('The Workday school field changed before searching.');
    }
    if (!inputFocused()) focusInput();
    if (!inputFocused() || !owns(expected) || workdayPromptPortal(input, container) !== ownedPortal) {
      throw new Error('The Workday school input could not be refocused for the search.');
    }
    writeQuery(query);
    expected = { ...blank, query };
    if (!inputFocused() || !owns(expected) || workdayPromptPortal(input, container) !== ownedPortal) {
      throw new Error('The Workday school field changed during search entry.');
    }
    key('Enter', 'keydown');
    if (inputFocused() && owns(expected)) key('Enter', 'keyup');
    const expired = optionWaitDeadline(input, 5000, 10000);
    let transitioned = false;
    while (true) {
      const currentMenu = workdayPromptMenu(input, container);
      // Workday may select its only result itself when the original Enter search finishes.
      const siteSelection = workdayPromptSelection(container);
      if (siteSelection) return { selected: await verifySiteSelection(siteSelection, query) };
      if (!ownsFocus(currentMenu) || !owns(expected) || associatedPortals(widget).length > 1) {
        throw new Error('The Workday school field changed during the search.');
      }
      const portal = workdayPromptPortal(input, container);
      if (portal) ownedPortal = portal;
      const menu = workdayPromptSearchMenu(input, container);
      transitioned ||= portal?.matches('[aria-busy="true"]') || currentMenu !== previousMenu
        || (!!menu && menu !== previousSearchMenu);
      if (transitioned && menu && portal) {
        const choice = await findNestedOption(input, undefined, () => ownsFocus(menu) && owns(expected), {
          menu, portal, query, allowResultsHeader: true, select: choices => selectWorkdaySchool(plan, choices, qualifiedOnly),
        });
        return { menu, portal, choice };
      }
      if (expired()) throw new Error('The Workday school search results could not be verified.');
      await tick();
    }
  }

  root.addEventListener('keydown', trackInteraction, true);
  root.addEventListener('pointerdown', trackInteraction, true);
  try {
    focusInput();
    if (!inputFocused() || !owns(blank)) throw new Error('The Workday school field changed before opening.');
    if (!workdayPromptMenu(input, container)) ownMutation(() => input.click());
    const openExpired = optionWaitDeadline(input);
    while (!workdayPromptMenu(input, container)) {
      if (!inputFocused() || !owns(blank) || openExpired()) throw new Error('The Workday school prompt could not be opened.');
      await tick();
    }
    ownedPortal = workdayPromptPortal(input, container);
    if (!ownedPortal) throw new Error('The Workday school prompt could not be verified.');
    const campus = plan.campusQuery;
    let result = await search(campus && queryFit(campus) ? campus : plan.query, !!campus && queryFit(campus));
    if ('selected' in result) return result.selected;
    if (!result.choice && campus && campus !== plan.query && queryFit(campus)) {
      result = await search(plan.query, false);
      if ('selected' in result) return result.selected;
    }
    const { choice, menu, portal } = result;
    if (!choice || !ownsFocus(menu) || !owns(expected) || workdayPromptPortal(input, container) !== portal
      || workdayPromptSearchMenu(input, container) !== menu || !menu.contains(choice.element)) {
      throw new Error('No verified Workday search result matches the saved school and campus.');
    }
    const option = workdayPromptOption(choice.element, container);
    if (!option || option.branch || option.label !== choice.label) throw new Error('The selected Workday school result changed.');
    clicked = true;
    ownMutation(() => option.activation.click());
    const commitExpired = optionWaitDeadline(input);
    while (true) {
      const state: SchoolState = { kind: 'combobox', value: workdayPromptSelection(container) };
      if (input.value) state.query = input.value;
      if (!owns(state, true) || (state.query && state.query !== expected.query)
        || (state.value && normalize(state.value) !== normalize(choice.label))) break;
      const receipt = workdayPromptSelectionReceipt(container);
      if (!state.query && receipt === choice.label && associatedPortals(widget).length === 0) {
        committed = true;
        return state;
      }
      if (commitExpired()) break;
      await tick();
    }
    throw new Error('The application did not retain the selected Workday school.');
  } finally {
    const afterClick = clicked ? true : undefined;
    try {
      if (!committed && ownedPortal && workdayPromptPortal(input, container) === ownedPortal
        && ownsFocus(workdayPromptMenu(input, container)) && owns(expected, afterClick)) {
        if (expected.query) writeQuery('');
        if (workdayPromptPortal(input, container) === ownedPortal
          && ownsFocus(workdayPromptMenu(input, container)) && owns(blank, afterClick)) {
          if (!inputFocused()) focusInput();
          if (inputFocused() && owns(blank, afterClick) && workdayPromptPortal(input, container) === ownedPortal) {
            // The desktop Workday prompt closes its search on Tab and can leave a focused, minimized placeholder.
            key('Tab', 'keydown');
            await tick();
            if (inputFocused() && owns(blank, true) && workdayPromptPortal(input, container) === ownedPortal) {
              key('Escape', 'keydown');
            }
            const current = workdayPromptPortal(input, container);
            if (inputFocused() && owns(blank, true)
              && (!current || (container.contains(current) && current.dataset.automationMode === 'reactminimized'))) {
              ownMutation(() => input.blur());
            }
          }
        }
      }
    } catch {
      // Cleanup must not replace the original search error.
    } finally {
      root.removeEventListener('keydown', trackInteraction, true);
      root.removeEventListener('pointerdown', trackInteraction, true);
    }
  }
}
