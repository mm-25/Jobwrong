import { labelText, menuForId, visible, workdayMonthDisplay } from './discovery';

const dateGroup = '[role="group"][data-automation-id="dateInputWrapper"]';
const dateField = '[data-automation-id="formField-startDate"], [data-automation-id="formField-endDate"]';
export const workdayMonthNumber = /^(?:0?[1-9]|1[0-2])$/;
const yearNumber = /^\d{4}$/;
const dateInput = 'input:not([type="hidden"]), select, textarea, [contenteditable]:not([contenteditable="false"])';

export function sameWorkdayMonth(a: string, b: string): boolean {
  if (!a || !b) return a === b;
  return workdayMonthNumber.test(a) && workdayMonthNumber.test(b) && Number(a) === Number(b);
}

export function workdayDatePart(element: Element) {
  const month = element.getAttribute('data-automation-id') === 'dateSectionMonth-input';
  const part = month ? 'Month' : 'Year';
  if (!element.matches(`input[role="spinbutton"][aria-label="${part}"][data-automation-id="dateSection${part}-input"]`)) return undefined;
  const group = element.closest<HTMLElement>(dateGroup);
  if (!group || !/--(?:startDate|endDate)$/.test(group.id)) return undefined;
  const id = `${group.id}-dateSection${part}`;
  if (element.id !== `${id}-input` || element.parentElement?.id !== id
    || menuForId(element, element.id) !== element) return undefined;
  const monthInput = month ? element : menuForId(element, `${group.id}-dateSectionMonth-input`);
  if (!monthInput || monthInput.closest(dateGroup) !== group || !workdayMonthDisplay(monthInput)) return undefined;
  const display = menuForId(element, `${id}-display`);
  if (!display?.matches(`div[data-automation-id="dateSection${part}-display"][aria-hidden="true"]`)
    || display.parentElement !== element.parentElement) return undefined;
  return { group, display, month };
}

export function workdayDateSegments(element: Element) {
  const part = workdayDatePart(element);
  if (!part) return undefined;
  const { group } = part;
  if (group.querySelectorAll(dateInput).length !== 2) return undefined;
  const month = menuForId(element, `${group.id}-dateSectionMonth-input`) as HTMLInputElement | undefined;
  const year = menuForId(element, `${group.id}-dateSectionYear-input`) as HTMLInputElement | undefined;
  if (!month || !year || workdayDatePart(year)?.group !== group || workdayDatePart(month)?.group !== group) return undefined;
  const matches = (input: HTMLInputElement, max: string) => input.matches('input:is(:not([type]), [type="text"])')
    && input.parentElement?.matches('div[tabindex="0"], div[tabindex="-1"]')
    && input.getAttribute('aria-valuemin') === '1' && input.getAttribute('aria-valuemax') === max;
  if (!matches(month, '12') || !matches(year, '9999') || month.form !== year.form
    || month.parentElement!.tabIndex === year.parentElement!.tabIndex) return undefined;
  return { group, month, year };
}

export function workdayLegacyDatePart(element: Element) {
  const part = workdayDatePart(element);
  if (!part) return undefined;
  const inputs = [...part.group.querySelectorAll(dateInput)];
  return inputs.length === 2 && inputs.every(input => workdayDatePart(input)?.group === part.group
    && !input.parentElement?.hasAttribute('tabindex')) ? part : undefined;
}

export function checkpointWorkdayDateSibling(part: NonNullable<ReturnType<typeof workdayDatePart>>, element: Element): (() => boolean) | undefined {
  const { group, month } = part;
  const sibling = menuForId(element, `${group.id}-dateSection${month ? 'Year' : 'Month'}-input`) as HTMLInputElement | undefined;
  if (!sibling) return undefined;
  const read = () => {
    const siblingPart = workdayDatePart(sibling);
    if (siblingPart?.group !== group || siblingPart.month === month) return undefined;
    return [sibling.value, sibling.getAttribute('aria-valuenow'), sibling.getAttribute('aria-valuetext'), labelText(siblingPart.display)];
  };
  const original = read();
  if (!original) return undefined;
  return () => {
    const current = read();
    return !!current && current.every((value, index) => value === original[index]);
  };
}

export function committedWorkdayDatePart(element: HTMLElement, expected: string): boolean {
  const part = workdayDatePart(element);
  if (!part || part.display.matches('[hidden], [inert]')) return false;
  const style = part.display.ownerDocument.defaultView?.getComputedStyle(part.display);
  if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
    || style.contentVisibility === 'hidden') return false;
  const value = (element as HTMLInputElement).value;
  const valueText = element.getAttribute('aria-valuetext');
  const valueNow = element.getAttribute('aria-valuenow');
  const rendered = labelText(part.display);
  if (!expected) {
    const placeholder = part.month ? 'MM' : 'YYYY';
    return !value && valueText === placeholder && valueNow === null && rendered === placeholder;
  }
  if (!part.month) return yearNumber.test(expected) && [value, valueText, valueNow, rendered].every(partValue => partValue === expected);
  return sameWorkdayMonth(value, expected) && valueText !== null && sameWorkdayMonth(valueText, expected)
    && valueNow !== null && sameWorkdayMonth(valueNow, expected) && rendered === String(Number(expected)).padStart(2, '0');
}

export function workdayRequiredDateError(element: HTMLElement): HTMLElement | undefined {
  const part = workdayDatePart(element);
  const group = part?.group;
  const wrapper = group?.closest(dateField);
  if (!group || !wrapper) return undefined;
  const error = menuForId(element, `error1-${group.id}`);
  const direction = wrapper.getAttribute('data-automation-id') === 'formField-startDate' ? 'From' : 'To';
  const message = new RegExp(`^(?:Error:\\s*)?The field ${direction} is required and must have a value\\.?$`, 'i');
  return error?.matches('[data-automation-id="inputAlert"]') && error.closest(dateField) === wrapper
    && visible(error) && message.test(labelText(error)) ? error : undefined;
}
