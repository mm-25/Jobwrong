import { appendWorkdaySkills, restoreWorkdaySkills, sameWorkdaySkillSelections, workdaySkillKey, workdaySkillSelections, workdaySkillsWidget, type WorkdaySkillSelection } from './workday-skills';
import { chooseWorkdaySchool, workdaySchoolStartsClosed, workdaySchoolWidget } from './workday-school';
import { workdaySchoolSearch, type WorkdaySchoolSearch } from './education-school';
import type { ResumeAttachment } from '../shared/types';
import { accessibleText, ashbyLocationMenu, canLoadComboChoices, choiceActivation, comboActivation, comboChoices, comboToggle, fieldIdentity, greenhouseMultiSelect, inspectField, isAshbyLocation, labelText, menuForId, normalize, reactSelectParts, visible, words, workdayListboxLabel, workdayMonthDisplay, writable, type Choice, type Field } from './discovery';
import { findNestedOption, nestedPopup, nestedTriggerSelector, optionWaitDeadline, usesNestedOptions } from './nested-options';
import { optionMatchRank, type SemanticMatching } from './semantic-options';
import { countryKey, formatRegion, phoneCountryOption } from './answer-formats';
import { associatedUploadGroup, attachmentFilename, uploadMayStart, waitForAttachment, type UploadGroup } from './file-upload';
import { workdayPrompt, workdayPromptClear, workdayPromptOption, workdayPromptSelection } from './workday-controls';
import { checkpointWorkdayDateSibling, committedWorkdayDatePart, sameWorkdayMonth, workdayDatePart, workdayDateSegments, workdayLegacyDatePart, workdayMonthNumber, workdayRequiredDateError } from './workday-date';
export { sameWorkdayMonth } from './workday-date';
import { completeUSPhone, greenhousePhoneWidget, sameGreenhousePhoneWidget, type GreenhousePhoneWidget } from './greenhouse-phone';
import { greenhouseLocationClear, greenhouseLocationMenu, greenhouseLocationOptions, greenhouseLocationSelection, greenhouseLocationStartsClosed, greenhouseLocationWidget, isGreenhouseCandidateLocation, matchingGreenhouseLocation, sameGreenhouseLocationWidget, type GreenhouseLocationWidget } from './greenhouse-location';

type State =
  | { kind: 'text'; value: string; greenhousePhone?: GreenhousePhoneWidget }
  | { kind: 'unsupported'; value: string }
  | { kind: 'combobox'; value: string; phoneCountry?: string; query?: string; chips?: HTMLElement[];
      greenhouseLocation?: GreenhouseLocationWidget; locationSelection?: Element; workdaySkills?: WorkdaySkillSelection[] }
  | { kind: 'file-receipt'; value: string; group: UploadGroup }
  | { kind: 'checkbox'; value: boolean }
  | { kind: 'select' | 'radio' | 'checkbox-group'; value: HTMLElement[] }
  | { kind: 'file'; value: File[] };

type ComboTarget = {
  comboAnswer: string;
  workdaySkills?: { widget: NonNullable<ReturnType<typeof workdaySkillsWidget>>; desired: string[] };
  workdaySchool?: { widget: NonNullable<ReturnType<typeof workdaySchoolWidget>>; plan: WorkdaySchoolSearch };
  choice?: Choice;
  phoneCountry?: string;
  semantic?: SemanticMatching;
  resolveAnswer?: (loaded: Field) => string | boolean | undefined;
  choiceRank?: (choice: Choice) => number;
  searchLocation?: 'ashby' | 'greenhouse';
  workdayListbox?: { id: string | null; menu?: HTMLElement };
};
type Revalidate = (expected?: State, afterOwnedWrite?: true) => boolean;
type OwnMutation = (mutate: () => void) => void;

export type Target = string | boolean | Choice[] | ResumeAttachment | ComboTarget;
type PreviewValue = string | string[] | boolean;

function checked(element: HTMLElement): boolean {
  if (element.matches('input')) return (element as HTMLInputElement).checked;
  return (element.getAttribute('aria-checked') ?? element.getAttribute('aria-pressed')) === 'true';
}

function greenhouseChips(valueContainer: HTMLElement): HTMLElement[] {
  return [...valueContainer.querySelectorAll<HTMLElement>(':scope > .select__multi-value')];
}

function greenhouseChipLabel(chip: HTMLElement): string {
  const labels = chip.querySelectorAll(':scope > .select__multi-value__label');
  return labels.length === 1 && visible(labels[0]) ? labelText(labels[0]) : '';
}

export function snapshot(field: Field): State {
  const { element, kind, peers } = field;
  if (field.unsupportedReason) {
    const value = element.getAttribute('aria-valuetext')
      || (element.getAttribute('aria-checked') === 'true' ? 'Yes' : '')
      || element.querySelector('[aria-checked="true"], [aria-selected="true"]')?.textContent
      || (element.hasAttribute('contenteditable') ? element.textContent : '') || '';
    return { kind: 'unsupported', value: value.trim() };
  }
  switch (kind) {
    case 'radio':
      return { kind, value: peers.filter(checked) };
    case 'checkbox':
      if (field.multiple && peers.length) return { kind: 'checkbox-group', value: peers.filter(checked) };
      return { kind, value: checked(element) };
    case 'select':
      return { kind, value: Array.from((element as HTMLSelectElement).options).filter((option) => option.selected) };
    case 'file': {
      const group = associatedUploadGroup(field);
      const filename = group && attachmentFilename(group);
      if (group && filename) return { kind: 'file-receipt', value: filename, group };
      return { kind, value: Array.from((element as HTMLInputElement).files ?? []) };
    }
    case 'combobox': {
      const skills = workdaySkillsWidget(element);
      const selectedSkills = skills && workdaySkillSelections(skills);
      if (skills && selectedSkills) return { kind, value: selectedSkills.map(item => item.label).join(', '),
        query: skills.input.value || undefined, workdaySkills: selectedSkills };
      const location = greenhouseLocationWidget(element);
      if (location) {
        const selected = greenhouseLocationSelection(location);
        return { kind, value: selected?.label ?? '', query: location.input.value || undefined,
          greenhouseLocation: location, locationSelection: selected?.element };
      }
      const multi = greenhouseMultiSelect(element);
      if (multi) {
        const chips = greenhouseChips(multi.valueContainer);
        return { kind, value: chips.map(greenhouseChipLabel).filter(Boolean).join(', '), chips,
          query: (element as HTMLInputElement).value || undefined };
      }
      const prompt = workdayPrompt(element);
      if (prompt) {
        return { kind, value: workdayPromptSelection(prompt), query: (element as HTMLInputElement).value || undefined };
      }
      const text = element.getAttribute('aria-valuetext') || (element.matches('input') ? (element as HTMLInputElement).value : '');
      const selected = field.choices.filter((choice) => choice.element.getAttribute('aria-selected') === 'true');
      const react = reactSelectParts(element);
      const rendered = react?.valueContainer.querySelectorAll(`:scope > .${react.valueClass}`);
      const display = rendered?.length === 1 ? rendered[0] : undefined;
      const renderedValue = display?.textContent?.trim();
      const value = text || renderedValue || (selected.length === 1 ? selected[0].label : '')
        || (element.matches('button') ? element.textContent?.trim() ?? '' : '');
      const dial = !text && renderedValue && compactDialCode.exec(renderedValue)?.[1];
      if (display && dial && isGreenhousePhoneCountry(field, react)) {
        const country = visibleFlagCountry(display);
        if (country && phoneCountryCaptionAgrees(display, country, dial)) {
          return { kind, value, phoneCountry: `${country} +${dial}` };
        }
      }
      return { kind, value: isPlaceholder(value) ? '' : value };
    }
    default:
      return { kind, value: (element as HTMLInputElement).value };
  }
}

function isPlaceholder(value: string): boolean {
  return /^(?:[-–—\s]*(?:please )?(?:select|choose)(?: (?:one|an option|a value|a country))?[.…\s-]*|not selected|[-–—\s]+)$/i.test(value);
}

export function sameState(a: State, b: State): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'file-receipt' && b.kind === 'file-receipt') return a.value === b.value && a.group.element === b.group.element;
  if (a.kind === 'combobox' && b.kind === 'combobox') {
    return (!!a.workdaySkills === !!b.workdaySkills) && (!a.workdaySkills || sameWorkdaySkillSelections(a.workdaySkills, b.workdaySkills!))
      && a.value === b.value && a.phoneCountry === b.phoneCountry && a.query === b.query
      && sameGreenhouseLocationWidget(a.greenhouseLocation, b.greenhouseLocation) && a.locationSelection === b.locationSelection
      && a.chips?.length === b.chips?.length && (!a.chips || a.chips.every((chip, i) => chip === b.chips?.[i]));
  }
  if (!Array.isArray(a.value) || !Array.isArray(b.value)) return a.value === b.value;
  const left: Array<HTMLElement | File> = a.value;
  const right: Array<HTMLElement | File> = b.value;
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function committedWorkdayMonth(element: HTMLElement, expected: string): boolean {
  return !!workdayMonthDisplay(element) && committedWorkdayDatePart(element, expected);
}

export function displayValue(field: Field, state = snapshot(field)): string {
  switch (state.kind) {
    case 'checkbox':
      return state.value ? 'Yes' : '';
    case 'select':
      return state.value.map((node) => {
        const option = node as HTMLOptionElement;
        return !option.value || (option.disabled && isPlaceholder(option.label)) ? '' : option.label;
      }).filter(Boolean).join(', ');
    case 'radio':
    case 'checkbox-group':
      return state.value.map((node) => field.choices.find((choice) => choice.element === node)?.label
        ?? (node as HTMLInputElement).value).filter(Boolean).join(', ');
    case 'file':
      return state.value.map((file) => file.name).join(', ');
    case 'combobox':
      return state.value || (state.greenhouseLocation ? state.query ?? '' : '');
    default:
      return state.value;
  }
}

function matchesAnswer(choice: Choice, answer: string): boolean {
  const key = normalize(answer);
  return !!key && (normalize(choice.label) === key || normalize(choice.value) === key);
}

function choiceRank(field: Field, choice: Choice, answer: string, semantic?: SemanticMatching): number {
  if (semantic === 'visible') return Number(normalize(choice.label) === normalize(answer));
  if (semantic) return optionMatchRank(field, choice, answer, typeof semantic === 'object' ? semantic : undefined);
  return Number(matchesAnswer(choice, answer));
}

function strongestChoices(choices: Choice[], rank: (choice: Choice) => number): Choice[] {
  const strongest: Choice[] = [];
  let best = 0;
  for (const choice of choices) {
    const value = rank(choice);
    if (!value || value < best) continue;
    if (value > best) {
      strongest.length = 0;
      best = value;
    }
    strongest.push(choice);
  }
  return strongest;
}

function optionIsLoading({ element }: Choice): boolean {
  return !!element.closest('[aria-busy="true"]');
}

function uniqueChoice(field: Field, answer: string, semantic: SemanticMatching = false): Choice | undefined {
  const matches = strongestChoices(field.choices, (choice) => choiceRank(field, choice, answer, semantic));
  return matches.length === 1 ? matches[0] : undefined;
}

function booleanValue(answer: string | boolean): boolean | undefined {
  if (typeof answer === 'boolean') return answer;
  return { yes: true, true: true, checked: true, no: false, false: false, unchecked: false }[normalize(answer)];
}

function acceptsFile(field: Field, resume: ResumeAttachment): boolean {
  const accept = field.element.getAttribute('accept')?.split(',').map(normalize).filter(Boolean) ?? [];
  const type = normalize(resume.type);
  const name = normalize(resume.name);
  return !accept.length || accept.some((entry) => entry.startsWith('.') ? name.endsWith(entry)
    : entry.endsWith('/*') ? type.startsWith(entry.slice(0, -1)) : type === entry);
}

function textFits(element: HTMLElement, value: string): boolean {
  const doc = element.ownerDocument;
  const probe = element.matches('textarea') ? doc.createElement('textarea') : doc.createElement('input');
  for (const attribute of ['type', 'min', 'max', 'step', 'pattern', 'maxlength', 'multiple']) {
    const setting = element.getAttribute(attribute);
    if (setting !== null) probe.setAttribute(attribute, setting);
  }
  probe.value = value;
  return probe.value === value && probe.validity.valid
    && (probe.maxLength < 0 || value.length <= probe.maxLength);
}

function workdayListboxLink(element: HTMLElement): ComboTarget['workdayListbox'] {
  if (!workdayListboxLabel(element)) return undefined;
  const id = element.getAttribute('aria-controls');
  return { id, menu: id ? menuForId(element, id) : undefined };
}

export function prepare(
  field: Field, answer?: string | boolean, resume?: ResumeAttachment, semantic: SemanticMatching = false,
  resolveAnswer?: ComboTarget['resolveAnswer'], choiceRank?: ComboTarget['choiceRank'], schoolSearch?: WorkdaySchoolSearch,
): { target?: Target; value?: PreviewValue; reason?: string } {
  if (field.unsupportedReason) return { reason: field.unsupportedReason };
  if (field.kind === 'file' && resume) {
    if (!acceptsFile(field, resume)) return { reason: 'The resume format is not accepted by this field.' };
    if (typeof field.element.ownerDocument.defaultView?.DataTransfer !== 'function') {
      return { reason: 'This browser cannot attach a local file to this field.' };
    }
    return { target: { ...resume }, value: resume.name };
  }
  if (answer === undefined || (typeof answer === 'string' && !answer.trim())) return {};
  const checkboxGroup = field.kind === 'checkbox' && field.multiple && field.peers.length > 1;
  if (field.kind === 'checkbox' && !checkboxGroup) {
    const value = booleanValue(answer);
    return value === undefined ? { reason: 'This checkbox requires an explicit Yes or No answer.' } : { target: value, value };
  }
  const value = typeof answer === 'boolean' ? (answer ? 'Yes' : 'No') : answer;
  if (isGreenhouseCandidateLocation(field.element)) {
    const location = greenhouseLocationWidget(field.element);
    const parts = locationParts(value);
    if (field.kind !== 'combobox' || !field.trustedLabel || !location || !greenhouseLocationStartsClosed(location)
      || location.input.value || location.valueContainer.querySelector('.select__single-value, .select__multi-value')) {
      return { reason: 'This location can be searched only when its original field is blank.' };
    }
    if (!parts || !textFits(location.input, parts.city)) return { reason: 'Save a complete city, state or region, and country to search this field.' };
    return { target: { comboAnswer: value, searchLocation: 'greenhouse' }, value, reason: 'Verifies the complete city, region, and country.' };
  }
  if (field.kind === 'combobox') {
    const skills = workdaySkillsWidget(field.element);
    if (skills) {
      const selected = workdaySkillSelections(skills);
      const desired = [...new Set(value.split(/[\n;]+/).map(value => value.trim()).filter(Boolean))];
      if (!selected || skills.input.value) return { reason: 'Finish the current skills search before Autofill.' };
      const missing = desired.filter(skill => !selected.some(item => workdaySkillKey(item.label) === workdaySkillKey(skill)));
      if (!missing.length) return { reason: 'All saved skills are already selected.' };
      return { target: { comboAnswer: value, workdaySkills: { widget: skills, desired: missing } }, value: missing,
        reason: 'Adds saved skills while retaining existing selections.' };
    }
    const school = workdaySchoolWidget(field.element);
    if (school) {
      const plan = schoolSearch ?? workdaySchoolSearch(value);
      if (!field.trustedLabel || !plan || !workdaySchoolStartsClosed(school)) return { reason: 'Start with an empty, closed school search field.' };
      return { target: { comboAnswer: value, workdaySchool: { widget: school, plan } }, value: plan.label,
        reason: 'Searches and verifies the saved school and campus.' };
    }
    const multi = greenhouseMultiSelect(field.element);
    if (multi && (greenhouseChips(multi.valueContainer).length || (field.element as HTMLInputElement).value || /[;\r\n]/.test(value))) {
      return { reason: 'Select additional answers in this Greenhouse field manually.' };
    }
    if (isAshbyLocation(field.element)) {
      if (!resolveAnswer || !locationParts(value) || !textFits(field.element, value)) return { reason: 'Save a complete city, state or region, and country to search this field.' };
      return { target: { comboAnswer: value, searchLocation: 'ashby' }, value, reason: 'Selects only one matching city, region, and country.' };
    }
    const nested = !multi && usesNestedOptions(field.element);
    if (choiceRank) {
      if (!nested || !workdayPrompt(field.element) || !canLoadComboChoices(field)) {
        return { reason: 'The associated Workday options could not be verified.' };
      }
      return {
        target: { comboAnswer: value, choiceRank },
        value,
        reason: 'Fills only if the complete menu has one best match.',
      };
    }
    const loading = field.choices.some(optionIsLoading);
    const choice = loading ? undefined : uniqueChoice(field, value, semantic);
    const workdayListbox = workdayListboxLink(field.element);
    if (choice && !nested) return { target: { comboAnswer: value, choice, semantic, workdayListbox }, value: choice.label };
    if (loading || ((nested || !field.choices.length) && canLoadComboChoices(field))) {
      return {
        target: { comboAnswer: value, semantic, workdayListbox, ...(resolveAnswer ? { resolveAnswer } : {}) },
        value: choice?.label ?? value,
        reason: 'Fills only if the menu has one best match.',
      };
    }
    return { reason: 'No unique option matches this answer.' };
  }
  if (field.kind === 'select' || field.kind === 'radio' || checkboxGroup) {
    const direct = uniqueChoice(field, value, semantic);
    if (direct) return { target: [direct], value: direct.label };
    if ((field.kind === 'select' && field.multiple) || checkboxGroup) {
      const parts = value.split(/[\n;]+/).map((part) => part.trim()).filter(Boolean);
      const choices = parts.map((part) => uniqueChoice(field, part, semantic));
      if (choices.length && choices.every((choice): choice is Choice => !!choice) && new Set(choices).size === choices.length) {
        return { target: choices, value: choices.map((choice) => choice.label) };
      }
    }
    return { reason: 'No unique option matches this answer.' };
  }

  const type = (field.element as HTMLInputElement).type;
  const formatted = type === 'month' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(0, 7) : value;
  if (!textFits(field.element, formatted) || (workdayMonthDisplay(field.element) && !workdayMonthNumber.test(formatted))) {
    return { reason: 'The answer does not match this field’s input format or limits.' };
  }
  return { target: formatted, value: formatted };
}

function emitChange(element: HTMLElement): void {
  const Event = element.ownerDocument.defaultView?.Event;
  if (!Event) return;
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function setText(element: HTMLElement, value: string): void {
  const win = element.ownerDocument.defaultView!;
  const prototype = element.matches('textarea') ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  // Frameworks can put a value tracker on the instance. Use the platform setter.
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
}

function setChecked(element: HTMLElement, checked: boolean): void {
  const prototype = element.ownerDocument.defaultView!.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'checked')!.set!.call(element, checked);
}

function setRadio(field: Field, selected: HTMLElement[], previouslyChecked: HTMLElement[]): void {
  const selection = selected[0];
  if (selection) {
    if (!checked(selection)) choiceActivation(selection)?.click();
    return;
  }
  // A native radio group can start empty. There is no click that restores that state.
  const former = previouslyChecked[0];
  if (former?.matches('input[type="radio"]') && checked(former) && field.peers.includes(former) && choiceActivation(former)) {
    setChecked(former, false);
    // Notify click-based form controllers without triggering radio activation again.
    const Event = former.ownerDocument.defaultView!.Event;
    former.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
    emitChange(former);
  }
}

function setCheckboxGroup(field: Field, from: HTMLElement[], to: HTMLElement[]): boolean {
  const updates = field.peers.filter((checkbox) => to.includes(checkbox) !== from.includes(checkbox));
  if (updates.some((checkbox) => !field.choices.some((choice) => choice.element === checkbox))) return false;
  const identity = fieldIdentity(field);
  const contextIdentity = fieldIdentity(field, false);
  const selected = new Set(from);
  const group = () => {
    const current = inspectField(field.element);
    if (!current || current.blocked || current.scope !== field.scope || current.row !== field.row) return undefined;
    return current;
  };
  const unchangedGroup = () => {
    const current = group();
    return current && fieldIdentity(current) === identity
      && current.peers.length === field.peers.length && current.peers.every((peer, i) => peer === field.peers[i]);
  };
  const canRollBack = () => {
    const current = group();
    return current && fieldIdentity(current, false) === contextIdentity
      && field.peers.every((peer) => current.peers.includes(peer))
      && field.choices.every((prior) => current.choices.some((choice) =>
        choice.element === prior.element && choice.label === prior.label && choice.value === prior.value));
  };
  const matchesSelection = () => field.peers.every((checkbox) => checked(checkbox) === selected.has(checkbox));
  const changed: HTMLElement[] = [];
  for (const checkbox of updates) {
    if (!unchangedGroup() || !matchesSelection()) break;
    choiceActivation(checkbox)?.click();
    if (checked(checkbox) !== to.includes(checkbox)) break;
    changed.push(checkbox);
    if (to.includes(checkbox)) selected.add(checkbox);
    else selected.delete(checkbox);
  }
  if (changed.length === updates.length && unchangedGroup() && matchesSelection()) return true;
  // New choices can appear after a click. Restore only the original, still-identifiable options.
  const partialFill = 'The page changed this checkbox group during fill. Review its selections on the application page.';
  for (const prior of changed.reverse()) {
    if (!canRollBack() || !matchesSelection()) throw new Error(partialFill);
    choiceActivation(prior)?.click();
    if (from.includes(prior)) selected.add(prior);
    else selected.delete(prior);
    if (!matchesSelection()) throw new Error(partialFill);
  }
  return false;
}

function setSelect(element: HTMLSelectElement, choices: HTMLElement[]): void {
  if (element.multiple) {
    for (const option of element.options) option.selected = choices.includes(option);
  } else {
    const index = [...element.options].findIndex((option) => option === choices[0]);
    const prototype = element.ownerDocument.defaultView!.HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'selectedIndex')!.set!.call(element, index);
  }
  emitChange(element);
}

function setFiles(element: HTMLInputElement, files: File[]): void {
  const win = element.ownerDocument.defaultView!;
  const carrier = new win.DataTransfer();
  for (const file of files) carrier.items.add(file);
  element.files = carrier.files;
  emitChange(element);
}

function buildFile(field: Field, resume: ResumeAttachment): File {
  const win = field.element.ownerDocument.defaultView!;
  const data = resume.dataUrl.match(/^data:[^,;]*;base64,([a-z0-9+/=]+)$/i)?.[1];
  if (!data || data.length > Math.ceil(2 * 1024 * 1024 / 3) * 4) throw new Error('Invalid local resume data.');
  const bytes = Uint8Array.from(win.atob(data), (char) => char.charCodeAt(0));
  if (bytes.length > 2 * 1024 * 1024) throw new Error('The local resume is larger than 2 MiB.');
  return new win.File([bytes], resume.name, { type: resume.type, lastModified: resume.lastModified });
}

async function settle(element: HTMLElement): Promise<void> {
  const win = element.ownerDocument.defaultView;
  if (!win || win.document.visibilityState !== 'visible' || !win.requestAnimationFrame) return;
  await new Promise<void>((resolve) => {
    const timeout = win.setTimeout(() => {
      win.cancelAnimationFrame(frame);
      resolve();
    }, 40);
    const frame = win.requestAnimationFrame(() => {
      win.clearTimeout(timeout);
      resolve();
    });
  });
}

function safeTrigger(element: HTMLElement): boolean {
  if (element.closest('a[href]')) return false;
  if (element.matches('input')) return /^(?:text|search)$/.test((element as HTMLInputElement).type);
  if (element.matches('button')) return (element as HTMLButtonElement).type === 'button';
  return !element.closest('button, input, label, [contenteditable="true"]');
}

function comboKey(element: HTMLElement, key: 'ArrowDown' | 'Escape', eventType: 'keydown' | 'keyup' = 'keydown'): void {
  const { KeyboardEvent } = element.ownerDocument.defaultView!;
  element.dispatchEvent(new KeyboardEvent(eventType, { key, code: key, bubbles: true, cancelable: true, composed: true }));
}

function greenhouseFlyout(element: HTMLElement, listId: string): HTMLButtonElement | undefined {
  const control = element.closest('.select__control');
  const shell = control?.parentElement?.parentElement;
  if (!control || !shell?.matches('.select-shell') || shell.querySelectorAll('[role="combobox"]').length !== 1) return undefined;
  const buttons = control.querySelectorAll<HTMLButtonElement>(':scope > .select__indicators > button[type="button"][aria-label="Toggle flyout"]');
  if (buttons.length !== 1) return undefined;
  const button = buttons[0];
  const link = button.getAttribute('aria-controls');
  const safe = accessibleText(button) === 'Toggle flyout' && button.matches(':not([role]), [role="button"]') && !button.closest('a[href], label')
    && !button.matches('[formaction], [formmethod], [formenctype], [formtarget], [formnovalidate], [popovertarget], [popovertargetaction], [command], [commandfor]');
  return safe && button.form === (element as HTMLInputElement).form && (!link || link === listId) && writable(button)
    ? button : undefined;
}

const compactDialCode = /^\+([1-9]\d{0,3})$/;

function isGreenhousePhoneCountry(field: Field, react = reactSelectParts(field.element)): boolean {
  const { element } = field;
  if (!react || !field.trustedLabel || field.multiple || words(field.label) !== 'country' || words(field.context) !== 'phone'
    || !element.matches('input#country.select__input[aria-autocomplete="list"]') || !greenhouseFlyout(element, react.listId)) return false;
  const form = (element as HTMLInputElement).form;
  const group = element.closest('fieldset');
  const phones = group?.querySelectorAll<HTMLInputElement>('input[type="tel"]');
  return !!form && phones?.length === 1 && phones[0].form === form && visible(phones[0]);
}

function verifiedGreenhouseUSPhone(field: Field): GreenhousePhoneWidget | undefined {
  const widget = greenhousePhoneWidget(field);
  const country = widget && inspectField(widget.country);
  if (!country || !isGreenhousePhoneCountry(country)) return undefined;
  const state = snapshot(country);
  return state.kind === 'combobox' && state.phoneCountry === 'US +1' ? widget : undefined;
}

function visibleFlagCountry(container: Element): string | undefined {
  const flags = container.querySelectorAll('.iti__flag');
  const flag = flags[0];
  if (flags.length !== 1 || flag.parentElement !== container || !visible(flag)) return undefined;
  if (flag.checkVisibility) {
    if (!flag.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return undefined;
  } else {
    const win = flag.ownerDocument.defaultView;
    for (let node: Element | null = flag; node; node = node.parentElement) {
      if (win?.getComputedStyle(node).opacity === '0') return undefined;
    }
  }
  const codes = [...flag.classList].flatMap(name => /^iti__([a-z]{2})$/.exec(name)?.[1] ?? []);
  return codes.length === 1 ? countryKey(codes[0]) : undefined;
}

function phoneCountryCaptionAgrees(display: Element, country: string, dial: string): boolean {
  return [accessibleText(display), display.getAttribute('aria-label')?.trim()].every(caption => {
    if (!caption) return true;
    const labeled = phoneCountryOption(caption);
    if (labeled) return countryKey(labeled.name) === country && labeled.code === dial;
    const code = compactDialCode.exec(caption)?.[1];
    return code ? code === dial : countryKey(caption) === country;
  });
}

function phoneCountryChoice(choice: Choice): string | undefined {
  const option = phoneCountryOption(choice.label);
  const caption = phoneCountryOption(labelText(choice.element));
  const country = option && countryKey(option.name);
  if (!option || !country || !caption || countryKey(caption.name) !== country || caption.code !== option.code) return undefined;
  if (choice.element.querySelector('.iti__flag') && visibleFlagCountry(choice.element) !== country) return undefined;
  return `${country} +${option.code}`;
}

async function openReactSelect(element: HTMLElement, listId: string, revalidate: Revalidate): Promise<boolean> {
  const root = element.getRootNode() as Document | ShadowRoot;
  const stillClosed = () => {
    if (!revalidate()) throw new Error('The field changed while opening its options.');
    return element.getAttribute('aria-expanded') === 'false';
  };
  if (!stillClosed()) return false;
  const flyout = greenhouseFlyout(element, listId);
  if (root.activeElement !== element) {
    element.focus({ preventScroll: true });
    await settle(element);
  }
  if (!stillClosed()) return !!flyout;
  if (root.activeElement !== element) throw new Error('Focus moved before the option menu could open.');
  // Select one opener before waiting for the asynchronous menu.
  if (flyout) {
    if (greenhouseFlyout(element, listId) !== flyout) throw new Error('The option menu control changed.');
    const win = element.ownerDocument.defaultView!;
    flyout.dispatchEvent(new win.MouseEvent('mouseup', { button: 0, buttons: 0, bubbles: true, cancelable: true, composed: true }));
  } else {
    comboKey(element, 'ArrowDown');
  }
  return !!flyout;
}

function locationParts(value: string): { city: string; region: string; country: string } | undefined {
  const parts = value.split(',').map(part => part.trim());
  if (parts.length !== 3 || value.length > 240 || parts.some(part => !words(part))) return undefined;
  const [city, region, countryLabel] = parts;
  const country = countryKey(countryLabel);
  return country && !/^(?:EU|UN|ZZ)$/.test(country) ? { city, region, country } : undefined;
}

function matchesLocation(field: Field, expected: NonNullable<ReturnType<typeof locationParts>>, label: string, element: HTMLElement,
  cityKey = words): boolean {
  const candidate = locationParts(label);
  if (!candidate || cityKey(candidate.city) !== cityKey(expected.city) || candidate.country !== expected.country) return false;
  if (words(candidate.region) === words(expected.region)) return true;
  const region = { element, label: candidate.region, value: '' };
  const equivalent = formatRegion({ ...field, choices: [region] }, expected.region, expected.country);
  return equivalent !== undefined && words(equivalent) === words(candidate.region);
}

async function chooseAshbyLocation(
  field: Field, location: string, before: State, revalidate: Revalidate, ownInput: (event: Event) => void, ownMutation: OwnMutation,
): Promise<State> {
  const { element } = field;
  const expectedLocation = locationParts(location);
  if (!expectedLocation || before.kind !== 'combobox' || before.value || (element as HTMLInputElement).value || !revalidate()) {
    throw new Error('This location can be searched only when its original field is blank.');
  }
  // Keep the typed search distinct from a full city, region, and country selection.
  const query = expectedLocation.city + ', ' + expectedLocation.region;
  const win = element.ownerDocument.defaultView!;
  const next = () => new Promise<void>(resolve => win.setTimeout(resolve, 25));
  const ownedQuery: State = { kind: 'combobox', value: query };
  const openedHere = element.getAttribute('aria-expanded') === 'false';
  const root = element.getRootNode() as Document | ShadowRoot;
  const oldMenus = openedHere ? new Set(root.querySelectorAll('[role="listbox"]')) : undefined;
  let menu: HTMLElement | undefined;
  let queried = false;
  let selected = false;
  function writeQuery(value: string) {
    const event = new win.Event('input', { bubbles: true, composed: true });
    ownInput(event);
    setText(element, value);
    element.dispatchEvent(event);
  }
  try {
    if (openedHere) {
      const toggle = comboActivation(element);
      if (!toggle || !writable(toggle)) throw new Error('The location search menu could not be opened.');
      toggle.click();
    }
    const menuExpired = optionWaitDeadline(element);
    while (true) {
      if (!revalidate()) throw new Error('The location field changed before the search.');
      const linked = ashbyLocationMenu(element);
      if (linked && writable(linked) && !oldMenus?.has(linked)) {
        menu = linked;
        break;
      }
      if (menuExpired()) throw new Error('The associated location search menu did not open.');
      await next();
    }
    queried = true;
    writeQuery(query);

    const resultsExpired = optionWaitDeadline(element);
    while (true) {
      if (!revalidate(ownedQuery) || ashbyLocationMenu(element) !== menu || !writable(menu)) {
        throw new Error('The location field or its menu changed during the search.');
      }
      const choices = comboChoices(element).filter(({ element }) => writable(element));
      const matches = menu.closest('[aria-busy="true"]') || choices.some(optionIsLoading)
        ? [] : choices.filter(choice => {
          const rendered = choice.element.innerText ?? choice.element.textContent ?? '';
          return matchesLocation(field, expectedLocation, choice.label, choice.element)
            && matchesLocation(field, expectedLocation, rendered, choice.element);
        });
      if (matches.length > 1 || resultsExpired()) throw new Error('No unique result matched the saved city, region, and country.');
      if (matches.length === 1) {
        ownMutation(() => matches[0].element.click());
        await settle(element);
        const state = snapshot({ ...field, choices: comboChoices(element) });
        if (element.isConnected && element.getAttribute('aria-expanded') === 'false'
          && state.kind === 'combobox' && matchesLocation(field, expectedLocation, state.value, element)) {
          selected = true;
          return state;
        }
        throw new Error('The application did not retain the selected location.');
      }
      await next();
    }
  } finally {
    if (!selected) {
      if (queried && revalidate(ownedQuery)) writeQuery('');
      if (openedHere && menu && ashbyLocationMenu(element) === menu && revalidate()) comboKey(element, 'Escape');
    }
  }
}

async function chooseGreenhouseLocation(
  field: Field, location: string, before: State, revalidate: Revalidate,
  ownInput: (event: Event) => void, ownMutation: OwnMutation,
): Promise<State> {
  const widget = before.kind === 'combobox' ? before.greenhouseLocation : undefined;
  const expected = locationParts(location);
  if (!widget || !expected || before.kind !== 'combobox' || before.value || before.query
    || widget.valueContainer.querySelector('.select__single-value, .select__multi-value')
    || !greenhouseLocationStartsClosed(widget) || !revalidate()) {
    throw new Error('This location can be searched only when its original field is blank.');
  }
  const { input } = widget;
  const query = expected.city;
  const ownedQuery = { ...before, query };
  const win = input.ownerDocument.defaultView!;
  const owns = (state: State, afterClick?: true) => sameGreenhouseLocationWidget(widget, greenhouseLocationWidget(input))
    && revalidate(state, afterClick);
  const focused = () => (input.getRootNode() as Document | ShadowRoot).activeElement === input;
  const tick = () => new Promise<void>(resolve => win.setTimeout(resolve, 25));
  const matches = (label: string) => matchesLocation(field, expected, label, input, normalize);
  const writeQuery = (value: string) => {
    const event = new win.InputEvent('input', { inputType: value ? 'insertText' : 'deleteContentBackward', data: value || null,
      bubbles: true, composed: true });
    ownInput(event);
    ownMutation(() => {
      setText(input, value);
      input.dispatchEvent(event);
    });
  };
  let menu: HTMLElement | undefined;
  let clicked = false;
  let committed = false;
  try {
    input.focus({ preventScroll: true });
    await settle(input);
    if (!focused() || !owns(before)) throw new Error('The location field changed before the search.');
    writeQuery(query);
    if (!focused() || !owns(ownedQuery)) throw new Error('The location field changed during the search.');
    // This Greenhouse control opens on keyup, independently of React Select’s input change.
    ownMutation(() => comboKey(input, 'ArrowDown', 'keyup'));
    const expired = optionWaitDeadline(input, 4000, 8000);
    let option: Choice | undefined;
    while (!option) {
      if (!focused() || !owns(ownedQuery)) throw new Error('The location field changed during the search.');
      const linked = greenhouseLocationMenu(widget);
      if (menu && menu !== linked) throw new Error('The associated location menu changed during the search.');
      if (linked) {
        menu = linked;
        const choices = greenhouseLocationOptions(widget, menu, query);
        if (choices) {
          option = matchingGreenhouseLocation(choices, matches);
          if (!option) throw new Error('No verified search result matches the saved city, region, and country.');
          break;
        }
      }
      if (expired()) throw new Error('The location search results could not be verified.');
      await tick();
    }
    const selected = option;
    clicked = true;
    ownMutation(() => selected.element.click());
    const commitExpired = optionWaitDeadline(input);
    do {
      await settle(input);
      const state = snapshot(field);
      if (state.kind !== 'combobox' || !owns(state, true) || (state.query !== undefined && state.query !== query)
        || (state.value && normalize(state.value) !== normalize(selected.label))) break;
      if (!state.query && state.locationSelection && greenhouseLocationStartsClosed(widget) && matches(state.value)) {
        committed = true;
        return state;
      }
      if (!commitExpired()) await tick();
    } while (!commitExpired());
    throw new Error('The application did not retain the selected location.');
  } finally {
    const afterClick = clicked ? true : undefined;
    if (!committed && owns(ownedQuery, afterClick)) {
      const linked = greenhouseLocationMenu(widget);
      writeQuery('');
      const current = greenhouseLocationMenu(widget);
      const openWithoutMenu = input.getAttribute('aria-expanded') === 'true' && !input.hasAttribute('aria-controls')
        && !widget.shell.querySelector('.select__menu');
      if (focused() && owns(before, afterClick) && ((linked && linked === current) || openWithoutMenu)) {
        ownMutation(() => comboKey(input, 'Escape', 'keyup'));
      }
    }
  }
}

async function chooseCombo(
  field: Field, target: ComboTarget, before: State, revalidate: Revalidate, ownMutation: OwnMutation = mutate => mutate(),
): Promise<State> {
  const { element } = field;
  const { choice, comboAnswer, semantic, resolveAnswer } = target;
  const win = element.ownerDocument.defaultView!;
  const prompt = workdayPrompt(element);
  if (target.choiceRank && !prompt) throw new Error('The associated Workday prompt changed.');
  const multi = greenhouseMultiSelect(element);
  if (multi && (before.kind !== 'combobox' || before.query || before.chips?.length)) {
    throw new Error('The Greenhouse multi-select already has a value.');
  }
  const wasClosed = prompt ? !nestedPopup(element) : element.getAttribute('aria-expanded') === 'false';
  const nested = !multi && usesNestedOptions(element);
  const react = reactSelectParts(element);
  const phonePicker = isGreenhousePhoneCountry(field, react);
  let workdayListbox = workdayListboxLink(element);
  const originalListbox = target.workdayListbox;
  if (originalListbox && (!workdayListbox || originalListbox.id !== workdayListbox.id
    || (originalListbox.menu && originalListbox.menu !== workdayListbox.menu))) {
    throw new Error('The associated Workday listbox changed after the preview.');
  }
  function revalidateMenu(): boolean {
    if (!revalidate()) return false;
    if (!workdayListbox) return true;
    const linked = workdayListboxLink(element);
    if (!linked || (workdayListbox.id !== null && linked.id !== workdayListbox.id)
      || (workdayListbox.menu && linked.menu !== workdayListbox.menu)) return false;
    workdayListbox = linked;
    return true;
  }
  const rank = (item: Choice) => target.phoneCountry
    ? Number(phonePicker && phoneCountryChoice(item) === target.phoneCountry)
    : choiceRank(field, item, comboAnswer, semantic);
  const currentMatches = () => {
    const choices = comboChoices(element).filter((item) => writable(item.element));
    if (!choices.length || choices.some(optionIsLoading)) return [];
    if (!resolveAnswer) return strongestChoices(choices, rank);
    const loaded = { ...field, choices };
    const resolved = resolveAnswer(loaded);
    if (resolved === undefined) return [];
    const answer = typeof resolved === 'boolean' ? (resolved ? 'Yes' : 'No') : resolved;
    return strongestChoices(choices, (item) => choiceRank(loaded, item, answer, semantic));
  };
  async function commit(selected: Choice): Promise<State> {
    if (!revalidateMenu()) throw new Error('The field or its menu changed before committing the option.');
    if (multi) {
      if (normalize(labelText(selected.element)) !== normalize(selected.label)) {
        throw new Error('The Greenhouse option caption changed.');
      }
      ownMutation(() => selected.element.click());
      const expired = optionWaitDeadline(element);
      while (true) {
        const state = snapshot(field);
        if (greenhouseMultiSelect(element)?.valueContainer !== multi.valueContainer || !revalidate(state)) {
          throw new Error('The Greenhouse field changed before its selection committed.');
        }
        if (state.kind !== 'combobox' || state.query) break;
        if (state.chips?.length === 1 && normalize(state.value) === normalize(selected.label)) return state;
        if (state.chips?.length || expired()) break;
        await new Promise<void>(resolve => win.setTimeout(resolve, 25));
      }
      throw new Error('The application did not retain the selected Greenhouse option.');
    }
    if (prompt) {
      const option = workdayPromptOption(selected.element, prompt);
      if (!option || option.branch || !nestedPopup(element)?.contains(selected.element)) {
        throw new Error('The selected Workday option changed.');
      }
      if (before.kind === 'combobox' && matchesAnswer(selected, before.value)) return before;
      ownMutation(() => option.activation.click());
      const expired = optionWaitDeadline(element);
      while (true) {
        const state = snapshot(field);
        if (!revalidate(state) || workdayPrompt(element) !== prompt) throw new Error('The Workday prompt changed before its selection committed.');
        if (state.kind === 'combobox' && matchesAnswer(selected, state.value)) return state;
        if (expired()) throw new Error('The application did not retain the selected Workday option.');
        await new Promise<void>(resolve => win.setTimeout(resolve, 25));
      }
    }
    const phoneChoice = phonePicker ? phoneCountryChoice(selected) : undefined;
    if (phonePicker && selected.element.querySelector('.iti__flag') && !phoneChoice) {
      throw new Error('The phone country option disagrees with its displayed flag or code.');
    }
    const alreadyMatches = before.kind === 'combobox' && (phonePicker && compactDialCode.test(before.value)
      ? !!phoneChoice && before.phoneCountry === phoneChoice : matchesAnswer(selected, before.value));
    if (alreadyMatches && selected.element.getAttribute('aria-selected') === 'true') return before;
    const wasOpen = element.getAttribute('aria-expanded') === 'true';
    ownMutation(() => selected.element.click());
    await settle(element);
    const choices = comboChoices(element);
    const state = snapshot({ ...field, choices });
    // Existing search text is not evidence that the widget committed the selection.
    const confirmed = !alreadyMatches || (wasOpen && element.getAttribute('aria-expanded') === 'false')
      || choices.some((item) => item.label === selected.label && item.value === selected.value
        && item.element.getAttribute('aria-selected') === 'true');
    if (confirmed && state.kind === 'combobox') {
      if (phonePicker && compactDialCode.test(state.value)) {
        if (phoneChoice && state.phoneCountry === phoneChoice && element.getAttribute('aria-expanded') === 'false'
          && reactSelectParts(element)?.valueContainer === react?.valueContainer && revalidate(state)) return state;
      } else if (matchesAnswer(selected, state.value)) return state;
    }
    throw new Error('The page did not retain the planned answer.');
  }
  const writablePopup = () => {
    const popup = nestedPopup(element);
    return popup && writable(popup);
  };
  let activation: HTMLElement | undefined;
  let closeOnKeyUp = false;
  try {
    if ((nested ? (wasClosed || !writablePopup()) : !currentMatches().length) && element.getAttribute('aria-expanded') !== 'true') {
      activation = comboActivation(element);
      if (!activation) throw new Error('The associated option cannot be reached safely.');
      if (activation === element && wasClosed && react) {
        closeOnKeyUp = await openReactSelect(element, react.listId, revalidate);
      } else {
        if (prompt) activation.focus({ preventScroll: true });
        if (!prompt || (!writablePopup() && revalidate())) activation.click();
        await settle(element);
        if (activation === element && wasClosed && element.getAttribute('aria-expanded') === 'false' && revalidate()) {
          comboKey(element, 'ArrowDown');
        }
      }
    }
    const expired = optionWaitDeadline(element);
    let observedOpen = !wasClosed;
    while (true) {
      if (!revalidateMenu()) throw new Error('The field changed while opening its options.');
      observedOpen ||= element.getAttribute('aria-expanded') === 'true';
      if (!multi && (target.choiceRank || usesNestedOptions(element))) {
        const selected = await findNestedOption(element, target.choiceRank ?? rank, revalidateMenu);
        if (choice && (selected.label !== choice.label || selected.value !== choice.value)) {
          throw new Error('The available choices have changed.');
        }
        return await commit(selected);
      }
      const candidates = currentMatches();
      const [selected] = candidates;
      const plannedChoice = !choice || (selected?.label === choice.label && selected.value === choice.value);
      if (candidates.length === 1 && plannedChoice && (choice || element.getAttribute('aria-expanded') !== 'false')) {
        return await commit(selected);
      }
      if (candidates.length > 1 || expired()) {
        throw new Error(react && !observedOpen ? 'The associated option menu did not open.'
          : 'No unique option matches this answer in the open menu.');
      }
      await new Promise<void>((resolve) => win.setTimeout(resolve, 25));
    }
  } catch (error) {
    if (activation && wasClosed && (element.getAttribute('aria-expanded') === 'true' || (prompt && writablePopup())) && revalidate()) {
      if (usesNestedOptions(element) && activation === element && activation.matches('button') && comboActivation(element) === activation) activation.click();
      else if (activation === element) comboKey(element, 'Escape', closeOnKeyUp ? 'keyup' : 'keydown');
      else if (comboToggle(element) === activation) activation.click();
    }
    throw error;
  }
}

export function comboClearButton(field: Field): HTMLElement | undefined {
  const { element } = field;
  if (isGreenhouseCandidateLocation(element)) {
    const location = greenhouseLocationWidget(element);
    return location && greenhouseLocationClear(location);
  }
  const multi = greenhouseMultiSelect(element);
  if (multi) {
    const chips = greenhouseChips(multi.valueContainer);
    if (chips.length !== 1) return undefined;
    const chip = chips[0];
    const label = greenhouseChipLabel(chip);
    const removers = chip.querySelectorAll(':scope > .select__multi-value__remove[role="button"]');
    const remover = removers[0];
    if (!label || removers.length !== 1 || normalize(accessibleText(remover)) !== normalize(`Remove ${label}`)) return undefined;
    const buttons = remover.querySelectorAll<HTMLButtonElement>(':scope > button[type="button"][aria-label="Remove selection"]');
    const button = buttons[0];
    return buttons.length === 1 && button.form === (element as HTMLInputElement).form && writable(button) && safeTrigger(button)
      && !button.matches('[formaction], [formmethod], [formenctype], [formtarget], [formnovalidate], [popovertarget], [popovertargetaction], [command], [commandfor]')
      && accessibleText(button) === 'Remove selection' ? button : undefined;
  }
  const prompt = workdayPrompt(element);
  if (prompt) return workdayPromptClear(prompt);
  const parent = element.parentElement;
  const triggers = '[role="combobox"], button[aria-haspopup="listbox"], ' + nestedTriggerSelector;
  if (!parent || parent.querySelectorAll(triggers).length !== 1) return undefined;
  const hasOtherControl = Array.from(parent.querySelectorAll('input:not([type="hidden"]), select, textarea'))
    .some((control) => control !== element);
  const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>(':scope > button[type="button"][aria-label]'))
    .filter((button) => {
      if (!writable(button) || !safeTrigger(button) || button.closest('label')) return false;
      const label = button.getAttribute('aria-label')!.trim();
      if (!hasOtherControl && /^(?:clear|remove) (?:the )?(?:current )?(?:selection|selected option)$/i.test(label)) return true;
      const controls = (button.getAttribute('aria-controls') ?? '').trim().split(/\s+/);
      return !!element.id && controls.includes(element.id)
        && /^(?:clear|remove)(?: (?:the )?(?:current )?(?:selection|value|selected option))?$/i.test(label);
    });
  return buttons.length === 1 ? buttons[0] : undefined;
}

function refindChoices(field: Field, planned: Choice[]): Choice[] {
  return planned.map(({ label, value }) => {
    const matches = field.choices.filter((choice) => choice.label === label && choice.value === value);
    if (matches.length !== 1) throw new Error('The available choices have changed.');
    return matches[0];
  });
}

function samePressedGroup(field: Field): boolean {
  if (!field.pressedChoice) return true;
  const live = inspectField(field.element);
  return !!live?.pressedChoice && fieldIdentity(live) === fieldIdentity(field)
    && live.peers.length === field.peers.length && live.peers.every((peer, index) => peer === field.peers[index]);
}

interface WorkdayDateEdit {
  field: Field;
  value: string;
  revalidate: Revalidate;
  ownMutation: OwnMutation;
}

export async function writeWorkdayDateParts(edits: readonly WorkdayDateEdit[]): Promise<State[] | undefined> {
  if (!edits.length || edits.length > 2) return undefined;
  const { element } = edits[0].field;
  const segments = workdayDateSegments(element);
  if (!segments) return undefined;
  const { group, month, year } = segments;
  const targets = new Map(edits.map(({ field, value }) => [field.element, value]));
  if (targets.size !== edits.length || edits.some(({ field, value }) =>
    (field.element !== month && field.element !== year) || !textFits(field.element, value))) return undefined;
  const monthValue = targets.get(month) ?? month.value;
  const yearValue = targets.get(year) ?? year.value;
  if ((monthValue || yearValue) && (!workdayMonthNumber.test(monthValue) || !/^(?:19\d{2}|[2-9]\d{3})$/.test(yearValue))) return undefined;
  if (!committedWorkdayDatePart(month, month.value) || !committedWorkdayDatePart(year, year.value)
    || edits.some(edit => !edit.revalidate())) return undefined;
  const repair = !!monthValue && !!workdayRequiredDateError(month);
  if (!repair && edits.every(({ field, value }) => committedWorkdayDatePart(field.element, value))) {
    return edits.map(edit => snapshot(edit.field));
  }
  const monthSection = month.parentElement;
  const yearSection = year.parentElement;
  const sameSegments = () => {
    const current = workdayDateSegments(element);
    return current?.group === group && current.month === month && current.year === year
      && month.parentElement === monthSection && year.parentElement === yearSection;
  };
  const retainedSibling = edits.length === 1 && checkpointWorkdayDateSibling(workdayDatePart(element)!, element);
  const root = element.getRootNode() as Document | ShadowRoot;
  const original = new Map<HTMLElement, string>([[month, month.value], [year, year.value]]);
  const expected = new Map(original);
  const valid = () => sameSegments() && (edits.length === 2 || retainedSibling && retainedSibling())
    && month.value === expected.get(month) && year.value === expected.get(year)
    && edits.every(edit => edit.revalidate(snapshot(edit.field), true));
  const focusedSegment = () => {
    const active = root.activeElement;
    return active === month ? month : active === year ? year : undefined;
  };
  const updateSegment = async ({ field, ownMutation }: WorkdayDateEdit, value: string, refresh: boolean) => {
    if (!valid()) return false;
    const input = field.element as HTMLInputElement;
    const part = workdayDatePart(input)!;
    const digits = part.month && value ? String(Number(value)) : value;
    if (!refresh && input.value === digits) return true;
    const siblingUnchanged = checkpointWorkdayDateSibling(part, input);
    if (!siblingUnchanged) return false;
    const section = input.parentElement!;
    const activated = () => root.activeElement === input && section.tabIndex === 0;
    ownMutation(() => section.click());
    await settle(input);
    if (!activated() || !siblingUnchanged() || !valid()) return false;

    const steps = Array.from(digits, (_, index) => digits.slice(0, index + 1));
    if (!digits || (refresh && input.value === digits)) steps.unshift('');
    for (const next of steps) {
      if (input.value === next) continue;
      if (!activated() || !valid()) return false;
      expected.set(input, next);
      ownMutation(() => {
        setText(input, next);
        const { Event } = input.ownerDocument.defaultView!;
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      });
      await settle(input);
      if (!siblingUnchanged()) throw new Error('Workday changed the other segment while applying this date. Review both date segments.');
      if (!valid()) return false;
    }
    return true;
  };
  const close = () => {
    const active = focusedSegment();
    if (!active || !valid()) return false;
    edits[edits.length - 1].ownMutation(() => active.blur());
    return true;
  };
  for (const edit of edits) {
    if (await updateSegment(edit, edit.value, repair)) continue;
    // Roll back an intermediate owned value only while the same date remains
    // focused and neither segment nor its edit revision has changed.
    if (focusedSegment() && valid()) {
      for (const prior of [...edits].reverse()) {
        const value = original.get(prior.field.element)!;
        if (value === expected.get(prior.field.element)) continue;
        if (!await updateSegment(prior, value, false)) return undefined;
      }
      if (Boolean(month.value) === Boolean(year.value)
        && committedWorkdayDatePart(month, original.get(month)!) && committedWorkdayDatePart(year, original.get(year)!)) {
        close();
        await settle(element);
      }
    }
    return undefined;
  }
  // Workday serializes the date when focus leaves the entire widget. Leaving
  // midway through a blank pair can make it read the month back as a year.
  if (!close()) return undefined;
  await settle(element);
  if (!valid() || !committedWorkdayDatePart(month, monthValue) || !committedWorkdayDatePart(year, yearValue)
    || (repair && workdayRequiredDateError(month))) return undefined;
  return edits.map(edit => snapshot(edit.field));
}

async function writeWorkdayDatePart(
  field: Field, value: string, revalidate: Revalidate, ownMutation: OwnMutation, refresh = false,
): Promise<State | undefined> {
  const { element } = field;
  if (workdayDateSegments(element)) return (await writeWorkdayDateParts([{ field, value, revalidate, ownMutation }]))?.[0];
  const part = workdayLegacyDatePart(element);
  const siblingUnchanged = part && checkpointWorkdayDateSibling(part, element);
  if (!part || !siblingUnchanged || !revalidate()) return undefined;
  const root = element.getRootNode() as Document | ShadowRoot;
  ownMutation(() => element.focus({ preventScroll: true }));
  await settle(element);
  if (root.activeElement !== element || workdayLegacyDatePart(element)?.group !== part.group || !siblingUnchanged() || !revalidate()) return undefined;
  ownMutation(() => {
    try {
      const input = element as HTMLInputElement;
      if (refresh) {
        // Reset the site's tracker without dispatching the transient blank value.
        input.value = '';
      }
      setText(input, value);
      emitChange(input);
    } finally {
      element.blur();
    }
  });
  await settle(element);
  if (!siblingUnchanged()) throw new Error('Workday changed the other segment while applying this date. Review both date segments.');
  const state = snapshot(field);
  return element.isConnected && workdayLegacyDatePart(element)?.group === part.group && committedWorkdayDatePart(element, value) ? state : undefined;
}

export async function applyTarget(
  field: Field, target: Target, before: State, revalidate: Revalidate, ownInput: (event: Event) => void, ownMutation: OwnMutation,
): Promise<State | undefined> {
  if (field.unsupportedReason) return undefined;
  const { element } = field;
  const usPhone = typeof target === 'string' && completeUSPhone(target);
  const greenhousePhone = usPhone ? verifiedGreenhouseUSPhone(field) : undefined;
  let expected: State;
  if (typeof target === 'string') {
    if (!textFits(element, target)) return undefined;
    const date = workdayDatePart(element);
    if (date) {
      const requiredError = workdayRequiredDateError(element);
      if (before.kind === 'text') {
        if (committedWorkdayDatePart(element, target) && !requiredError) return before;
        const sameValue = date.month ? sameWorkdayMonth(before.value, target) : before.value === target;
        if (before.value && sameValue && requiredError) {
          return writeWorkdayDatePart(field, before.value, revalidate, ownMutation, true);
        }
      }
      return writeWorkdayDatePart(field, target, revalidate, ownMutation);
    }
    if (before.kind === 'text' && before.value === target) return before;
    setText(element, target);
    emitChange(element);
    expected = { kind: 'text', value: target };
  } else if (typeof target === 'boolean') {
    if (before.kind === 'checkbox' && before.value === target) return before;
    // Native activation lets controlled checkboxes observe the change in their click handler.
    choiceActivation(element)?.click();
    expected = { kind: 'checkbox', value: target };
  } else if (!Array.isArray(target) && 'comboAnswer' in target) {
    if (target.workdaySkills) {
      const { widget, desired } = target.workdaySkills;
      const skillState = (query: string, selections: WorkdaySkillSelection[]): State => ({ kind: 'combobox',
        value: selections.map(item => item.label).join(', '), query: query || undefined, workdaySkills: selections });
      const selected = await appendWorkdaySkills(widget, desired,
        (query, selections, afterOwnedWrite) => revalidate(skillState(query, selections), afterOwnedWrite), ownMutation);
      return selected && !widget.input.value ? skillState('', selected) : undefined;
    }
    if (target.workdaySchool) return chooseWorkdaySchool(target.workdaySchool.widget, target.workdaySchool.plan, revalidate, ownInput, ownMutation);
    if (target.searchLocation === 'ashby') return chooseAshbyLocation(field, target.comboAnswer, before, revalidate, ownInput, ownMutation);
    if (target.searchLocation === 'greenhouse') return chooseGreenhouseLocation(field, target.comboAnswer, before, revalidate, ownInput, ownMutation);
    return chooseCombo(field, target, before, revalidate, ownMutation);
  } else if (!Array.isArray(target)) {
    if (before.kind === 'file-receipt') return undefined;
    const group = associatedUploadGroup(field);
    if (group && !uploadMayStart(group)) return undefined;
    const file = buildFile(field, target);
    setFiles(element as HTMLInputElement, [file]);
    await settle(element);
    const state = snapshot(field);
    if (group?.kind !== 'workday' && element.isConnected && sameState(state, { kind: 'file', value: [file] })) return state;
    if (group && await waitForAttachment(group, file.name)) return { kind: 'file-receipt', value: file.name, group };
    return undefined;
  } else {
    const choices = refindChoices(field, target);
    const nodes = choices.map((choice) => choice.element);
    if (field.kind === 'radio') {
      if (sameState(before, { kind: 'radio', value: nodes })) return before;
      if (field.pressedChoice && !revalidate()) return undefined;
      setRadio(field, nodes, before.kind === 'radio' ? before.value : []);
      expected = { kind: 'radio', value: nodes };
    } else if (field.kind === 'checkbox' && before.kind === 'checkbox-group') {
      expected = { kind: 'checkbox-group', value: field.peers.filter((peer) => nodes.includes(peer)) };
      if (sameState(before, expected)) return before;
      if (!revalidate() || !setCheckboxGroup(field, before.value, expected.value)) return undefined;
    } else {
      const select = element as HTMLSelectElement;
      expected = { kind: 'select', value: Array.from(select.options).filter((option) => nodes.includes(option)) };
      if (sameState(before, expected)) return before;
      setSelect(select, expected.value);
    }
  }
  await settle(element);
  const state = snapshot(field);
  if (greenhousePhone) {
    const sameWidget = sameGreenhousePhoneWidget(greenhousePhone, verifiedGreenhouseUSPhone(field));
    return state.kind === 'text' && sameWidget && completeUSPhone(state.value) === usPhone && revalidate(state, true)
      ? { ...state, greenhousePhone } : undefined;
  }
  return element.isConnected && samePressedGroup(field) && sameState(state, expected) ? state : undefined;
}

export async function restore(field: Field, initial: Field, before: State, after: State, revalidate: Revalidate,
  ownMutation: OwnMutation): Promise<boolean> {
  const { element } = field;
  const greenhousePhone = after.kind === 'text' ? after.greenhousePhone : undefined;
  if (greenhousePhone && (!sameGreenhousePhoneWidget(greenhousePhone, verifiedGreenhouseUSPhone(field)) || !revalidate())) return false;
  switch (before.kind) {
    case 'unsupported':
    case 'file-receipt':
      return false;
    case 'text':
      if (workdayDatePart(element)) return !!await writeWorkdayDatePart(field, before.value, revalidate, ownMutation);
      setText(element, before.value);
      emitChange(element);
      break;
    case 'checkbox':
      if (checked(element) !== before.value) choiceActivation(element)?.click();
      break;
    case 'checkbox-group':
      if (after.kind !== 'checkbox-group' || !revalidate() || !setCheckboxGroup(field, after.value, before.value)) return false;
      break;
    case 'select':
      if (!before.value.every((choice) => choice.closest('select') === element)) return false;
      setSelect(element as HTMLSelectElement, before.value);
      break;
    case 'radio':
      if (after.kind !== 'radio' || before.value.some((choice) => !field.peers.includes(choice) || !choiceActivation(choice))) return false;
      if (field.pressedChoice && (!before.value.length || !revalidate())) return false;
      setRadio(field, before.value, after.value);
      break;
    case 'file':
      if (after.kind !== 'file') return false;
      setFiles(element as HTMLInputElement, before.value);
      break;
    case 'combobox': {
      if (before.workdaySkills) {
        const widget = workdaySkillsWidget(element);
        if (!widget || after.kind !== 'combobox' || !after.workdaySkills) return false;
        return restoreWorkdaySkills(widget, before.workdaySkills, after.workdaySkills,
          (query, selections, owned) => revalidate({ kind: 'combobox', value: selections.map(item => item.label).join(', '),
            query: query || undefined, workdaySkills: selections }, owned), ownMutation);
      }
      const location = before.greenhouseLocation;
      if (location) {
        if (before.value || before.query || after.kind !== 'combobox' || !after.locationSelection
          || !sameGreenhouseLocationWidget(location, after.greenhouseLocation)
          || !sameGreenhouseLocationWidget(location, greenhouseLocationWidget(element)) || !revalidate()) return false;
        const clear = greenhouseLocationClear(location);
        if (!clear) return false;
        // The verified indicator clears on its primary mousedown. Its click handler only prevents default.
        const { MouseEvent } = element.ownerDocument.defaultView!;
        ownMutation(() => clear.dispatchEvent(new MouseEvent('mousedown', {
          button: 0, buttons: 1, bubbles: true, cancelable: true, composed: true,
        })));
        await settle(element);
        if (!revalidate(before, true) || location.valueContainer.querySelector('.select__single-value, .select__multi-value')) return false;
        if (greenhouseLocationMenu(location) && element.ownerDocument.activeElement === element) {
          ownMutation(() => comboKey(element, 'Escape', 'keyup'));
          await settle(element);
        }
        return greenhouseLocationStartsClosed(location) && revalidate(before, true);
      }
      if (before.value) {
        if (!before.phoneCountry && compactDialCode.test(before.value) && isGreenhousePhoneCountry(field)) return false;
        const choice = before.phoneCountry ? undefined : uniqueChoice(initial, before.value);
        if (!choice && !before.phoneCountry && initial.choices.length && !usesNestedOptions(element)) return false;
        await chooseCombo(field, { comboAnswer: before.value, choice, phoneCountry: before.phoneCountry }, after, revalidate);
      } else {
        const clear = comboClearButton(field);
        if (!clear) return false;
        clear.click();
      }
      break;
    }
  }
  await settle(element);
  const liveField = field.kind === 'combobox' ? { ...field, choices: comboChoices(element) } : field;
  if (greenhousePhone && before.kind === 'text') {
    const state = snapshot(liveField);
    const originalNumber = completeUSPhone(before.value);
    return state.kind === 'text' && sameGreenhousePhoneWidget(greenhousePhone, verifiedGreenhouseUSPhone(liveField))
      && revalidate(state, true) && (sameState(state, before) || (!!originalNumber && completeUSPhone(state.value) === originalNumber));
  }
  return element.isConnected && samePressedGroup(field) && sameState(snapshot(liveField), before);
}
