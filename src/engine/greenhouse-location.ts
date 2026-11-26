import { accessibleText, canClickOption, labelText, menuForId, normalize, visible, writable, type Choice } from './discovery';

const origin = 'https://job-boards.greenhouse.io';
const inputId = 'candidate-location';
const listId = 'react-select-candidate-location-listbox';
const optionIdPrefix = 'react-select-candidate-location-option-';
const plainOptionAttributes = new Set(['id', 'class', 'role', 'tabindex', 'aria-disabled', 'aria-selected']);

export interface GreenhouseLocationWidget {
  input: HTMLInputElement;
  form: HTMLFormElement;
  label: HTMLLabelElement;
  container: Element;
  shell: HTMLElement;
  control: Element;
  valueContainer: Element;
  inputContainer: Element;
}

export function isGreenhouseCandidateLocation(element: Element): boolean {
  return element.ownerDocument.location?.origin === origin && element.matches(`input#${inputId}`);
}

export function greenhouseLocationWidget(element: Element): GreenhouseLocationWidget | undefined {
  if (!isGreenhouseCandidateLocation(element)
    || !element.matches('input.select__input[type="text"][autocomplete="off"][role="combobox"][aria-autocomplete="list"][aria-haspopup="true"]:is([aria-expanded="false"], [aria-expanded="true"])')
    || element.hasAttribute('aria-owns') || element.closest('label, a[href]')) return undefined;
  const input = element as HTMLInputElement;
  const form = input.form;
  if (!form?.matches('form#application-form') || input.closest('form') !== form
    || input.ownerDocument.querySelectorAll('form#application-form').length !== 1
    || input.ownerDocument.querySelectorAll(`#${inputId}`).length !== 1) return undefined;
  try {
    if (new URL(form.getAttribute('action') || input.ownerDocument.URL, input.ownerDocument.baseURI).origin !== origin) return undefined;
  } catch { return undefined; }

  const inputContainer = input.parentElement;
  const valueContainer = inputContainer?.parentElement;
  const control = valueContainer?.parentElement;
  const shell = control?.parentElement?.parentElement;
  const container = shell?.parentElement;
  if (!inputContainer?.matches('.select__input-container') || !valueContainer?.matches('.select__value-container')
    || !control?.matches('.select__control') || !shell?.matches('.select-shell') || !container?.matches('.select > .select__container')
    || shell.querySelectorAll('[role="combobox"]').length !== 1) return undefined;
  const labels = container.querySelectorAll<HTMLLabelElement>(':scope > label');
  const label = labels[0];
  if (labels.length !== 1 || label.control !== input || label.id !== `${inputId}-label` || !visible(label)
    || input.ownerDocument.querySelectorAll(`#${inputId}-label`).length !== 1
    || input.getAttribute('aria-labelledby') !== label.id || normalize(labelText(label)) !== 'location (city)'
    || (input.hasAttribute('aria-label') && normalize(input.getAttribute('aria-label')!) !== 'location (city)')) return undefined;
  return { input, form, label, container, shell, control, valueContainer, inputContainer };
}

export function sameGreenhouseLocationWidget(left?: GreenhouseLocationWidget, right?: GreenhouseLocationWidget): boolean {
  return left === right || !!left && !!right && left.input === right.input && left.form === right.form
    && left.label === right.label && left.container === right.container && left.shell === right.shell
    && left.control === right.control && left.valueContainer === right.valueContainer && left.inputContainer === right.inputContainer;
}

export function greenhouseLocationMenu(widget: GreenhouseLocationWidget): HTMLElement | undefined {
  if (widget.input.getAttribute('aria-expanded') !== 'true' || widget.input.getAttribute('aria-controls') !== listId) return undefined;
  const list = menuForId(widget.input, listId);
  const shape = ':scope > .select__menu > .select__menu-list[role="listbox"][aria-multiselectable="false"]';
  const menus = widget.shell.querySelectorAll(shape);
  return list && menus.length === 1 && menus[0] === list && writable(list) ? list : undefined;
}

export function greenhouseLocationStartsClosed(widget: GreenhouseLocationWidget): boolean {
  return widget.input.getAttribute('aria-expanded') === 'false' && !widget.input.hasAttribute('aria-controls')
    && !widget.input.ownerDocument.getElementById(listId) && !widget.shell.querySelector('.select__menu');
}

export function greenhouseLocationOptions(widget: GreenhouseLocationWidget, menu: HTMLElement, query: string): Choice[] | undefined {
  if (menu.closest('[aria-busy="true"]')) return undefined;
  const announcements = widget.shell.querySelectorAll(':scope > [role="log"][aria-live="polite"] > span#aria-results');
  if (announcements.length !== 1) return undefined;
  const announced = /^(\d{1,3}) results? available for search term (.+)\.$/.exec(labelText(announcements[0]));
  if (!announced || announced[2] !== query || Number(announced[1]) > 100) return undefined;
  const options = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
  if (options.length !== Number(announced[1])
    || options.some((option, index) => option.parentElement !== menu || !option.matches('div.select__option') || option.id !== optionIdPrefix + index
      || !writable(option) || !canClickOption(option) || option.querySelector('button, input, select, a[href], [contenteditable="true"]'))) {
    return undefined;
  }
  return options.map(element => ({ element, label: labelText(element), value: '' }));
}

function agreesWithDisplayedCaption(element: HTMLElement, label: string): boolean {
  const displayed = element.innerText ?? label;
  return !!label && normalize(displayed) === normalize(label)
    && element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false
    && [accessibleText(element), element.getAttribute('aria-label'), element.getAttribute('aria-description'), element.getAttribute('title')]
    .every(caption => !caption || normalize(caption) === normalize(label));
}

export function matchingGreenhouseLocation(choices: Choice[], matches: (label: string) => boolean): Choice | undefined {
  const candidates = choices.filter(choice => matches(choice.label));
  if (!candidates.length || candidates.some(choice => !agreesWithDisplayedCaption(choice.element, choice.label))) return undefined;
  const first = candidates[0];
  if (candidates.length === 1) return first;
  // Positional IDs may distinguish repeated copies of the same complete visible location.
  return candidates.every(({ element, label }) => normalize(label) === normalize(first.label) && !element.childElementCount
    && element.getAttributeNames().every(attribute => plainOptionAttributes.has(attribute))) ? first : undefined;
}

export function greenhouseLocationSelection(widget: GreenhouseLocationWidget): { element: Element; label: string } | undefined {
  const values = widget.valueContainer.querySelectorAll<HTMLElement>(':scope > .select__single-value');
  if (values.length !== 1 || widget.valueContainer.querySelector('.select__multi-value') || !visible(values[0])) return undefined;
  const element = values[0];
  const label = labelText(element);
  return agreesWithDisplayedCaption(element, label) ? { element, label } : undefined;
}

export function greenhouseLocationClear(widget: GreenhouseLocationWidget): HTMLButtonElement | undefined {
  if (!greenhouseLocationSelection(widget) || widget.input.value || widget.input.getAttribute('aria-expanded') !== 'false') return undefined;
  const controls = widget.control.querySelectorAll<HTMLButtonElement>(
    ':scope > .select__indicators > div > button[type="button"][aria-label="Clear selections"][data-testid="clear-selection"]',
  );
  const button = controls[0];
  return controls.length === 1 && button.form === widget.form && writable(button) && canClickOption(button)
    && accessibleText(button) === 'Clear selections' && !button.closest('label, a[href]')
    && !button.matches('[formaction], [formmethod], [formenctype], [formtarget], [formnovalidate], [popovertarget], [popovertargetaction], [command], [commandfor]')
    ? button : undefined;
}
