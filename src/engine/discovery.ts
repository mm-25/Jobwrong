import { insideWorkdaySkillsUI, workdaySkillsWidget, workdaySkillSelections } from './workday-skills';
import type { FieldKind } from '../shared/types';
import { nestedChoices, nestedPopup, nestedTriggerSelector, usesNestedOptions, workdayLocalWrapper, workdayPromptSelector } from './nested-options';
import { insideWorkdayPromptUI, isWorkdayChoice, isWorkdayPromptInput, workdayPrompt, workdayPromptSingleSelection } from './workday-controls';
import { workdayEducationRow, workdayExperienceRow, workdayResumeInput } from './workday-structure';

export type NativeControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export type Control = NativeControl | HTMLElement;
export type SectionKind = 'employment' | 'education';

export interface Choice {
  element: HTMLElement;
  label: string;
  value: string;
}

type ResumeAlternative =
  | { type: 'file'; element: HTMLInputElement }
  | { type: 'text'; element: HTMLTextAreaElement };

export interface Field {
  element: Control;
  scope: Node;
  peers: HTMLElement[];
  kind: FieldKind;
  label: string;
  metadata: string[];
  context: string;
  autocomplete: string;
  choices: Choice[];
  row?: Element;
  section?: SectionKind;
  rowIndex?: string;
  resumeAlternative?: ResumeAlternative;
  unsupportedReason?: string;
  blocked: boolean;
  trustedLabel: boolean;
  required: boolean;
  multiple: boolean;
  pressedChoice?: boolean;
}

interface Label {
  text: string;
  trusted: boolean;
  required: boolean;
}

const controlSelector = 'input, select, textarea, [role="combobox"], ' + nestedTriggerSelector;
const manualSelector = '[role="textbox"], [role="checkbox"], [role="switch"], [role="radio"], [role="radiogroup"], [role="listbox"], [aria-haspopup="listbox"], [contenteditable="true" i], [contenteditable=""], [contenteditable="plaintext-only" i]';
const fieldContainerSelector = '.field, .form-field, .application-question, .ashby-application-form-field-entry, [data-automation-id^="formField-"], [data-field-path]';
const choiceGroupSelector = 'fieldset, [role="radiogroup"], [role="group"], .application-question';
const ashbyPressedGroup = '.ashby-application-form-input-yesno';
const pressedGroupSelector = `fieldset, [role="group"], ${ashbyPressedGroup}`;
const excludedInputs = new Set(['button', 'color', 'hidden', 'image', 'range', 'reset', 'submit']);
const excludedAutocomplete = /(?:^|\s)(?:new-password|current-password|one-time-code|username)(?:$|\s)/i;
const forbiddenPurpose = /\b(?:password|passcode|sign in|log in|verification code|security question|security answer|signature|sign here|electronically sign|(?:type|enter) (?:your )?(?:(?:full|legal) )*name to (?:sign|confirm)|applicant initials|agree|acknowledge|acknowledgment|acknowledgement|attest|certif(?:y|ication)|consent|terms and conditions|privacy policy|privacy notice|terms of (?:use|service)|opt in|opt out)\b/i;
const dataHandling = /\b(?:data (?:processing|protection|privacy) (?:notice|statement|policy)|(?:(?:personal|candidate|applicant) (?:data|information)) (?:processing|sharing|storage|collection|retention|transfer|disclosure)|(?:collect(?:ion)?|process(?:ing)?|retain|retention|stor(?:e|age)|shar(?:e|ing)|disclos(?:e|ure)|transfer) (?:of )?(?:your )?(?:personal|candidate|applicant) (?:information|data))\b/i;
const ignoredLabelChildren = 'input, select, textarea, button, [role="listbox"], [role="option"], [aria-hidden="true"], [hidden], script, style';
const requiredMarker = /\s*[*✱∗✳]+\s*$/u;

export const normalize = (text: string): string => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const withoutQuestionNumber = (text: string): string => text.replace(/^\s*\d{1,3}[.)]\s+/u, '');
export const normalizeQuestion = (text: string): string => normalize(withoutQuestionNumber(text)).replace(/\s*[(\[]required[)\]]$/i, '').replace(/[\s*?:]+$/g, '');
export const words = (text: string): string => normalize(text.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^\p{L}\p{N}]+/gu, ' '));

function textOf(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export function labelText(element: Element, includeRequiredMarker = false): string {
  function collect(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
    if (node !== element && node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(ignoredLabelChildren)) {
      if (includeRequiredMarker && (node as Element).matches('[aria-hidden="true"]:not([hidden])')
        && /^[*✱∗✳]+$/u.test(textOf(node as Element))) return '*';
      return '';
    }
    return Array.from(node.childNodes).map(collect).join('');
  }
  return collect(element).replace(/\s+/g, ' ').trim();
}

function findById(element: Element, id: string): Element | null {
  const root = element.getRootNode() as Document | ShadowRoot;
  return root.getElementById?.(id) ?? null;
}

function referencedText(element: Element, attribute: string, includeRequiredMarker = false): string {
  const ids = element.getAttribute(attribute)?.trim();
  if (!ids) return '';
  const prompt = attribute === 'aria-describedby' ? workdayPrompt(element) : undefined;
  const skills = attribute === 'aria-describedby' ? workdaySkillsWidget(element as HTMLElement) : undefined;
  const date = attribute === 'aria-describedby' ? workdayDateLabel(element) : undefined;
  const multi = attribute === 'aria-describedby' ? greenhouseMultiSelect(element) : undefined;
  return ids.split(/\s+/)
    .filter(Boolean)
    .map((id) => findById(element, id))
    .filter((reference): reference is Element => !!reference && reference !== element)
    .flatMap((label) => {
      const text = labelText(label, includeRequiredMarker);
      if ((prompt ?? skills?.container)?.contains(label) && label.matches('[data-automation-id="promptAriaInstruction"][aria-hidden="true"]')
        && label.closest('[data-automation-id="multiselectInputContainer"]') === element.closest('[data-automation-id="multiselectInputContainer"]')) {
        if (/^(?:expanded|collapsed|minimized|\d+ items? selected)$/i.test(text)) return [];
        const selectedSkills = skills && workdaySkillSelections(skills);
        if (selectedSkills?.length && text === `${selectedSkills.length} ${selectedSkills.length === 1 ? 'item' : 'items'} selected, ${selectedSkills.map(item => item.label).join(', ')}`) return [];
        if (text.startsWith('1 item selected, ')) {
          const selected = prompt && workdayPromptSingleSelection(prompt);
          if (selected && text === `1 item selected, ${selected}`) return [];
        }
      }
      if (multi && label.parentElement === multi.valueContainer && label.id === `react-select-${element.id}-placeholder`
        && label.matches('.select__placeholder') && /^select(?:\.\.\.|…)?$/i.test(text)) return [];
      if (date && label === date.group.previousElementSibling && label.id === date.helpId
        && label.matches('div[aria-hidden="true"]') && /^current value is (?:MM|0?[1-9]|1[0-2])\/(?:YYYY|\d{1,4})$/i.test(text)) {
        const help = date.group.nextElementSibling;
        // Workday uses the same ID for the live value and the static keyboard help surrounding this date group.
        if (help?.id === date.helpId && help.matches('div[hidden]')) return [labelText(help, includeRequiredMarker)];
      }
      return [text];
    }).filter(Boolean).join(' ');
}

export function accessibleText(element: Element): string {
  return referencedText(element, 'aria-labelledby') || element.getAttribute('aria-label')?.trim() || '';
}

function nativeLabels(element: Element, includeRequiredMarker = false): string {
  return Array.from((element as HTMLInputElement).labels ?? [])
    .map((label) => labelText(label, includeRequiredMarker)).filter(Boolean).join(' ');
}

export function workdayListboxLabel(element: Element): HTMLElement | undefined {
  if (!element.matches('button[type="button"][aria-haspopup="listbox"]')) return undefined;
  const wrapper = workdayLocalWrapper(element as HTMLElement);
  if (!wrapper) return undefined;
  const labels = Array.from((element as HTMLButtonElement).labels ?? []).filter(label =>
    label.control === element && label.closest('[data-automation-id^="formField-"]') === wrapper && visible(label));
  if (labels.length) return labels.length === 1 ? labels[0] : undefined;
  // Workday questionnaire dropdowns put the question in a legend and announce
  // only the current selection on the button. Keep the same owned menu path.
  const fieldset = element.closest('fieldset');
  if (fieldset?.parentElement !== wrapper) return undefined;
  const legends = fieldset.querySelectorAll<HTMLLegendElement>(':scope > legend');
  if (legends.length !== 1 || !visible(legends[0]) || !labelText(legends[0])
    || legends[0].querySelector('input, textarea, select, button, [contenteditable]')) return undefined;
  const controls = [...fieldset.querySelectorAll<HTMLElement>(controlSelector + ', button[aria-haspopup="listbox"]')].filter(control => kindOf(control) && visible(control)
    && !control.closest('[role="listbox"], [role="option"]'));
  if (controls.length !== 1 || controls[0] !== element) return undefined;
  const accessible = words(accessibleText(element)).replace(/ (?:required|optional)$/, '');
  if (accessible && accessible !== words(labelText(element))
    && accessible !== words(labelText(legends[0]))) return undefined;
  return legends[0];
}

function workdayDateLabel(element: Element): (Label & { group: Element; helpId: string }) | undefined {
  if (!isWorkdayChoice(element) || !element.matches('input[role="spinbutton"]')) return undefined;
  const part = /^dateSection(Month|Year)-input$/.exec(element.getAttribute('data-automation-id') ?? '')?.[1];
  if (!part || element.getAttribute('aria-label') !== part) return undefined;
  const group = element.closest('[role="group"][data-automation-id="dateInputWrapper"]');
  const field = group?.closest('[data-automation-id="formField-startDate"], [data-automation-id="formField-endDate"]');
  const fieldset = group?.closest('fieldset');
  if (!group || !field || !fieldset || (!field.contains(fieldset) && !fieldset.contains(field))) return undefined;
  const direction = field.getAttribute('data-automation-id') === 'formField-startDate' ? 'From' : 'To';
  const legend = fieldset.querySelector(':scope > legend');
  const caption = legend && labelText(legend, true);
  if (!caption || caption.replace(requiredMarker, '') !== direction) return undefined;
  const suffix = `--${direction === 'From' ? 'startDate' : 'endDate'}-dateSection${part}-input`;
  if (!element.id.endsWith(suffix)) return undefined;
  const helpId = 'helpText-' + element.id.slice(0, -`-dateSection${part}-input`.length);
  return { text: `${direction} ${part}`, trusted: true, required: requiredMarker.test(caption), group, helpId };
}

export function workdayMonthDisplay(element: Element): HTMLElement | undefined {
  const part = element.parentElement;
  if (!part || !element.matches('input[data-automation-id="dateSectionMonth-input"]')
    || element.id !== `${part.id}-input` || !workdayDateLabel(element)) return undefined;
  const displays = part.querySelectorAll<HTMLElement>(':scope > div[data-automation-id="dateSectionMonth-display"][aria-hidden="true"]');
  return displays.length === 1 && displays[0].id === `${part.id}-display` ? displays[0] : undefined;
}

function groupLabel(element: Element, includeRequiredMarker = false): string {
  const heading = element.querySelector(':scope > legend, :scope > .application-label, :scope > [data-automation-id="questionLabel"]');
  return (includeRequiredMarker ? referencedText(element, 'aria-labelledby', true) : accessibleText(element))
    || element.getAttribute('aria-label')?.trim() || (heading ? labelText(heading, includeRequiredMarker) : '');
}

function resumeAlternativeFor(element: Element): ResumeAlternative | undefined {
  if (!element.matches('input[type="file"], textarea')) return undefined;
  const wrapper = element.closest('.field');
  const label = wrapper?.querySelector<HTMLLabelElement>(':scope > label[for]');
  if (!wrapper || !label?.htmlFor || !/^(?:(?:resume|résumé)(?: cv)?|cv)$/.test(words(labelText(label)))) return undefined;
  const file = label.control;
  if (!file?.matches('input[type="file"]') || file.closest('.field') !== wrapper) return undefined;
  const texts = Array.from(wrapper.querySelectorAll('textarea')).filter((text) =>
    text.closest('.field') === wrapper && !accessibleText(text) && !nativeLabels(text)
    && /^or paste as text[.:]?$/i.test(textOf(text.previousElementSibling)));
  if (texts.length !== 1) return undefined;
  if (element === file) return { type: 'text', element: texts[0] };
  if (element === texts[0]) return { type: 'file', element: file as HTMLInputElement };
  return undefined;
}

function leverFieldLabel(element: Control, kind: FieldKind): Label | undefined {
  const field = element.closest('.application-field');
  const wrapper = field?.parentElement;
  const question = wrapper?.closest('li.application-question');
  if (!field || !wrapper || !question || (wrapper !== question && wrapper.parentElement !== question)) return undefined;
  const captions = wrapper.querySelectorAll(':scope > .application-label');
  if (captions.length !== 1 || !visible(captions[0])) return undefined;
  const controls = [...field.querySelectorAll<NativeControl>('input, select, textarea')].filter(control => kindOf(control));
  const name = (element as HTMLInputElement).name;
  const optionGroup = (kind === 'radio' || kind === 'checkbox') && !!name
    && controls.every(control => kindOf(control) === kind && control.name === name);
  if (!controls.includes(element as NativeControl) || (controls.length !== 1 && !optionGroup)) return undefined;
  const caption = labelText(captions[0], true);
  if (!caption) return undefined;
  return { text: caption.replace(requiredMarker, ''), trusted: true, required: requiredMarker.test(caption) || field.matches('.required-field') };
}

function attachmentPurpose(text: string): 'Resume/CV' | 'Cover Letter' | undefined {
  const key = words(text);
  if (/^(?:(?:attach|upload) (?:your )?)?(?:resume(?: or)? cv|résumé(?: or)? cv|resume|résumé|cv|curriculum vitae)(?: file| upload| upload input)?$/.test(key)) return 'Resume/CV';
  if (/^(?:(?:attach|upload) (?:your )?)?cover letter(?: file| upload| upload input)?$/.test(key)) return 'Cover Letter';
  return undefined;
}

function attachmentLabel(element: Control, visibleLabel: string): Label | undefined {
  const names = [accessibleText(element), visibleLabel || nativeLabels(element, true)].filter(Boolean);
  if (!names.length || names.some(name => !/^(?:attach|upload|choose file|browse)$/.test(words(name)))) return undefined;
  const wrapper = element.closest('.file-upload');
  if (wrapper && wrapper.querySelectorAll('input[type="file"]').length !== 1) return undefined;
  const headings = wrapper ? [...wrapper.children].filter(heading => !heading.contains(element) && visible(heading)).map(heading => labelText(heading, true)) : [];
  const evidence = [...headings, ...metadataFor(element), referencedText(element, 'aria-describedby')];
  const purposes = new Set(evidence.map(attachmentPurpose).filter(Boolean));
  if (purposes.size !== 1) return undefined;
  const [text] = purposes;
  return { text: text!, trusted: true, required: [...headings, ...names].some(name => requiredMarker.test(name)) };
}

function optionalResumeParser(element: Control): boolean {
  if (!element.matches('input[type="file"]') || element.matches('[required], [aria-required="true"]')
    || accessibleText(element) || nativeLabels(element)) return false;
  const parser = element.closest('.ashby-application-form-autofill-input-root');
  const application = parser?.closest('[role="tabpanel"], form');
  if (!parser || !application || parser.querySelectorAll('input[type="file"]').length !== 1) return false;
  const titles = parser.querySelectorAll('.ashby-application-form-autofill-input-title');
  if (titles.length !== 1 || !visible(titles[0]) || requiredMarker.test(labelText(titles[0], true))
    || parser.matches('[required], [aria-required="true"]') || words(labelText(titles[0])) !== 'autofill from resume') return false;
  // This is a preprocessing action, not a second application attachment. Keep
  // uncertain uploads in the review list when the dedicated attachment is absent.
  const attachments = [...application.querySelectorAll<HTMLInputElement>(
    '.ashby-application-form-field-entry[data-field-path="_systemfield_resume"] input[type="file"]',
  )].filter(input => !parser.contains(input) && input.closest('[role="tabpanel"], form') === application
    && (writable(input) || !!visibleAssociatedLabel(input)) && attachmentPurpose(nativeLabels(input)) === 'Resume/CV');
  return attachments.length === 1;
}

function labelFor(element: Element, kind: FieldKind, isPasteAlternative: boolean, checkboxGroup: Element | null, lever?: Label): Label {
  const workdayDate = workdayDateLabel(element);
  if (workdayDate) return workdayDate;
  if (kind === 'radio' || checkboxGroup) {
    const fieldset = checkboxGroup ?? element.closest(choiceGroupSelector);
    const group = fieldset && groupLabel(fieldset, true);
    if (group) return { text: group.replace(requiredMarker, ''), trusted: true, required: requiredMarker.test(group) || !!lever?.required };
    if (lever) return lever;
    if (element.matches(manualSelector)) {
      const caption = accessibleText(element) || (element.matches('[role="radio"]') ? labelText(element) : '');
      return { text: caption.replace(requiredMarker, ''), trusted: !!caption, required: requiredMarker.test(caption) };
    }
    return { text: '', trusted: false, required: false };
  }

  const closestField = element.closest(fieldContainerSelector);
  const fieldLabel = closestField?.querySelector(':scope > label, :scope > .application-label, :scope > [data-automation-id="formFieldLabel"]');
  const accessible = accessibleText(element);
  const native = nativeLabels(element);
  const workdayListbox = workdayListboxLabel(element);
  const text = (workdayListbox && labelText(workdayListbox)) || accessible || lever?.text || native || (fieldLabel && labelText(fieldLabel))
    || (element.matches('[role="checkbox"], [role="switch"], [aria-haspopup="listbox"]:not([aria-expanded])')
      ? labelText(element) : '')
    || element.getAttribute('title')?.trim() || element.getAttribute('placeholder')?.trim() || '';
  const labelForId = fieldLabel?.getAttribute('for');
  const wrapperRequired = fieldLabel && requiredMarker.test(labelText(fieldLabel, true))
    && (labelForId ? labelForId === element.id : (!accessible && !native)
      || Array.from(closestField!.querySelectorAll<HTMLElement>(controlSelector)).filter((control) => kindOf(control)).length === 1);
  const required = [
    referencedText(element, 'aria-labelledby', true), element.getAttribute('aria-label') ?? '',
    nativeLabels(element, true),
  ].some((label) => requiredMarker.test(label)) || !!wrapperRequired || !!lever?.required
    || !!workdayListbox && requiredMarker.test(labelText(workdayListbox, true));
  const caption = text.replace(requiredMarker, '');
  return {
    text: isPasteAlternative ? caption + ' (paste as text)' : caption,
    trusted: !!text,
    required: !isPasteAlternative && required,
  };
}

const workdayPreferredNames = {
  firstName: { label: /^(?:preferred )?(?:first|given) name$/, caption: 'Preferred First Name' },
  middleName: { label: /^(?:preferred )?(?:middle|additional) name$/, caption: 'Preferred Middle Name' },
  lastName: { label: /^(?:(?:preferred )?(?:last|family) name|(?:preferred )?surname)$/, caption: 'Preferred Last Name' },
};

function workdayPreferredNameLabel(element: Control, label: Label): string | false | undefined {
  if (!element.matches('input') || !element.closest('[data-automation-id="applyFlowPage"]')) return undefined;
  const name = element.getAttribute('name');
  const wrapper = element.parentElement?.closest('[data-automation-id^="formField-"]');
  const wrapperId = wrapper?.getAttribute('data-automation-id');
  const identifiers = [element.id, name, wrapperId, element.getAttribute('data-automation-id')];
  if (!identifiers.some(value => /(?:^|-)preferredName(?:--|$)/i.test(value ?? ''))) return undefined;
  const part = /^name--preferredName--(firstName|middleName|lastName)$/.exec(element.id)?.[1] as keyof typeof workdayPreferredNames | undefined;
  if (!part || !element.matches('input:is([type="text"], :not([type]))') || name !== 'preferredName--' + part
    || !wrapper || wrapperId !== 'formField-' + name) return false;
  const native = Array.from((element as HTMLInputElement).labels ?? [])
    .filter(partLabel => partLabel.control === element && visible(partLabel));
  if (native.length !== 1 || !wrapper.contains(native[0])) return false;
  const preferred = workdayPreferredNames[part];
  const aria = [element.getAttribute('aria-label') ?? '', referencedText(element, 'aria-labelledby'), accessibleText(native[0])];
  return label.trusted && preferred.label.test(words(label.text)) && preferred.label.test(words(labelText(native[0])))
    && aria.every(caption => !caption.trim() || preferred.label.test(words(caption))) ? preferred.caption : false;
}

export function metadataFor(element: Element): string[] {
  const automationId = element.getAttribute('data-automation-id');
  const searchBox = isWorkdayPromptInput(element) && automationId === 'searchBox';
  const info = [element.getAttribute('name'), element.id, searchBox ? undefined : automationId, element.getAttribute('data-field-path'),
    element.closest('[data-field-path]')?.getAttribute('data-field-path')];
  return info.filter((x): x is string => !!x);
}

function scopeOf(element: Element): Node {
  return (element as HTMLInputElement).form ?? element.closest('form') ?? element.getRootNode();
}

function radioGroup(elements: HTMLInputElement[], radio: HTMLInputElement): HTMLInputElement[] {
  return radio.name ? elements.filter((other) => other.name === radio.name && scopeOf(other) === scopeOf(radio)) : [radio];
}

function allControls(root: Document | ShadowRoot | Element): Control[] {
  const elements = [...root.querySelectorAll<HTMLElement>(`${controlSelector}, ${manualSelector}, ${pressedGroupSelector}`)];
  for (const host of root.querySelectorAll('*')) {
    if (host.shadowRoot && !insideExtensionUI(host)) elements.push(...allControls(host.shadowRoot));
  }
  return elements;
}

function composedParent(element: Element): Element | null {
  return element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null;
}

function insideExtensionUI(element: Element): boolean {
  for (let node: Element | null = element; node; node = composedParent(node)) {
    if (node.matches('[data-jobright-local-ui="true"]')) return true;
  }
  return false;
}

function fieldContext(element: Element): string {
  const context = new Set([referencedText(element, 'aria-describedby')]);
  const checkboxSelector = 'input[type="checkbox"], [role="checkbox"]';
  if (element.matches(checkboxSelector)) {
    const wrapper = element.closest(fieldContainerSelector);
    if (wrapper) {
      const checkboxes = [...wrapper.querySelectorAll(checkboxSelector)]
        .filter((checkbox) => checkbox.closest(fieldContainerSelector) === wrapper);
      if (checkboxes.length === 1 && checkboxes[0] === element) {
        for (const caption of wrapper.querySelectorAll<HTMLElement>(':scope > label, :scope > .legal')) {
          if (visible(caption) && (!caption.matches('label') || !(caption as HTMLLabelElement).control || (caption as HTMLLabelElement).control === element)) context.add(labelText(caption));
        }
      }
    }
  }
  for (let node: Element | null = element; node && !node.matches('main, [role="main"], body'); node = composedParent(node)) {
    if (node.matches('fieldset, [role="radiogroup"], [role="group"]')) {
      context.add(groupLabel(node));
    } else if (node.matches('section, [role="region"]')) {
      const heading = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role="heading"]');
      context.add(accessibleText(node) || (heading ? labelText(heading) : ''));
    }
  }
  return [...context].filter(Boolean).join(' ');
}

export function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = composedParent(node)) {
    if (node.matches('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden') return false;
  }
  return true;
}

export function writable(element: Element): boolean {
  return element.isConnected && !element.matches(':disabled, [readonly], [aria-readonly="true"]')
    && !element.closest('[aria-disabled="true"]') && visible(element);
}

function visibleAssociatedLabel(element: Control): HTMLLabelElement | undefined {
  if (!element.matches('input[type="file"], input[type="radio"], input[type="checkbox"]') || !element.isConnected || !element.parentElement
    || element.matches(':disabled, [readonly], [inert]')
    || element.closest('[aria-disabled="true"], [aria-readonly="true"]') || !visible(element.parentElement)) return undefined;
  const input = element as HTMLInputElement;
  if (!input.form) return undefined;
  const labels = Array.from(input.labels ?? []).filter((label) => label.control === input
    && label.closest('form') === input.form && visible(label) && !!labelText(label));
  return labels.length === 1 ? labels[0] : undefined;
}

export function choiceActivation(element: HTMLElement): HTMLElement | undefined {
  if (writable(element)) return element;
  const label = visibleAssociatedLabel(element);
  return label && !label.closest('a[href]') ? label : undefined;
}

function ariaChoiceButton(element: Element, role: 'checkbox' | 'radio'): boolean {
  return element.matches(`button[type="button"][role="${role}"]:is([aria-checked="true"], [aria-checked="false"])`)
    && !element.closest('a[href], label, [contenteditable="true"]');
}

function customRadioPeers(element: Control): HTMLElement[] {
  if (!element.matches('[role="radiogroup"]') || !groupLabel(element)) return [];
  const peers = [...element.querySelectorAll<HTMLElement>('[role="radio"]')]
    .filter((peer) => peer.closest('[role="radiogroup"]') === element);
  return peers.length > 1 && peers.every((peer) => ariaChoiceButton(peer, 'radio')
    && (accessibleText(peer) || labelText(peer))) && peers.filter((peer) => peer.getAttribute('aria-checked') === 'true').length <= 1
    ? peers : [];
}

function pressedOption(button: HTMLButtonElement): boolean {
  const safeType = button.type === 'button'
    || (!button.hasAttribute('type') && !button.form && !button.closest('form'));
  return safeType && writable(button) && !button.closest('a[href], label, [contenteditable="true"]')
    && button.matches(':is([aria-pressed="true"], [aria-pressed="false"]):is(:not([role]), [role="button"])')
    && !button.matches('[aria-checked], [formaction], [formmethod], [formenctype], [formtarget], [formnovalidate], [popovertarget], [command], [commandfor]');
}

function pressedChoices(element: Element): { label: Label; peers: HTMLButtonElement[] } | undefined {
  if (!element.matches(pressedGroupSelector) || element.matches('[aria-multiselectable="true"]')
    || element.closest('nav, [role="toolbar"]') || !element.querySelector('button[aria-pressed]')) return undefined;
  const peers = [...element.querySelectorAll<HTMLButtonElement>('button')];
  if (peers.length !== 2 || peers.some((button) => button.closest(pressedGroupSelector) !== element || !pressedOption(button))
    || peers.filter((button) => button.getAttribute('aria-pressed') === 'true').length > 1) return undefined;
  const captions = peers.map((button) => {
    const accessible = normalize(accessibleText(button));
    // Text can be visible even when it is excluded from the accessible name.
    const rendered = normalize(button.innerText ?? button.textContent ?? '');
    if (accessible && rendered && accessible !== rendered) return '';
    return accessible || normalize(labelText(button));
  });
  if (!captions.includes('yes') || !captions.includes('no')) return undefined;
  if (peers.some((button, index) => button.hasAttribute('data-option')
    && normalize(button.getAttribute('data-option')!) !== captions[index])) return undefined;

  const ashby = element.matches(ashbyPressedGroup);
  const otherControls = [...element.querySelectorAll('input:not([type="hidden"]), select, textarea, a[href], [tabindex], [contenteditable], [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"]')]
    .filter((control) => !peers.some((button) => button === control));
  // Ashby renders a hidden checkbox to validate the two-option question.
  if (otherControls.length && !(ashby && otherControls.length === 1
    && otherControls[0].matches('input[type="checkbox"]') && !visible(otherControls[0]))) return undefined;

  const wrapper = ashby ? element.closest('.ashby-application-form-field-entry') : null;
  if (wrapper && wrapper.querySelectorAll(ashbyPressedGroup).length !== 1) return undefined;
  const directLabels = wrapper ? wrapper.querySelectorAll(':scope > label, :scope > .application-label')
    : element.querySelectorAll(':scope > legend');
  if (directLabels && directLabels.length > 1) return undefined;
  const caption = directLabels?.[0] && visible(directLabels[0]) ? labelText(directLabels[0], true) : '';
  const names = [referencedText(element, 'aria-labelledby', true), element.getAttribute('aria-label')?.trim(), caption]
    .filter((name): name is string => !!name);
  const first = names[0];
  if (!first || names.some((name) => normalizeQuestion(name) !== normalizeQuestion(first))) return undefined;
  return { label: { text: first.replace(requiredMarker, ''), trusted: true, required: names.some((name) => requiredMarker.test(name)) }, peers };
}

function kindOf(element: Control): FieldKind | undefined {
  if (element.matches('select')) return 'select';
  if (element.matches('input')) {
    const input = element as HTMLInputElement;
    if (excludedInputs.has(input.type)) return undefined;
    if (input.type === 'radio' || input.type === 'checkbox' || input.type === 'file') return input.type;
    if (input.type === 'password') return 'text';
  }
  if (element.matches('[role="combobox"]') || isWorkdayPromptInput(element)) return 'combobox';
  if (element.matches('[aria-haspopup="listbox"], [aria-haspopup="tree"]')
    || (element.matches(workdayPromptSelector) && isWorkdayChoice(element))) return 'combobox';
  if (element.matches('input, textarea')) return 'text';
  if (element.matches('[role="radio"], [role="radiogroup"]')) return 'radio';
  if (element.matches('[role="checkbox"], [role="switch"]')) return 'checkbox';
  if (element.matches('[role="listbox"]')) return 'combobox';
  if (element.matches(manualSelector)) return 'text';
  return undefined;
}

function isManualWidget(element: Control): boolean {
  return element.matches(manualSelector) && !element.matches('select, [role="combobox"]')
    && (!element.matches('input, textarea') || element.matches('[aria-haspopup="listbox"]'));
}

function duplicatesControl(element: Control): boolean {
  if (element.matches('[role="radio"]') && element.closest('[role="radiogroup"]')) return true;
  if (Array.from(element.querySelectorAll<HTMLElement>(controlSelector)).some((child) =>
    !!kindOf(child) && (writable(child) || !!visibleAssociatedLabel(child)))) return true;
  if (!element.matches('[role="listbox"]')) return false;
  if (element.parentElement?.closest('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="tree"]')
   ) return true;
  // A standalone listbox needs its own accessible question and keyboard entry point.
  const tabbableOption = Array.from(element.querySelectorAll<HTMLElement>('[role="option"][tabindex]'))
    .some((option) => option.tabIndex >= 0 && visible(option));
  if (!accessibleText(element) || (element.tabIndex < 0 && !tabbableOption)) return true;
  if (!element.id) return false;
  const root = element.getRootNode() as Document | ShadowRoot;
  return Array.from(root.querySelectorAll('[role="combobox"][aria-controls], [role="combobox"][aria-owns], [aria-haspopup="listbox"][aria-controls], [aria-haspopup="listbox"][aria-owns]'))
    .some((trigger) => trigger !== element && comboListIds(trigger).includes(element.id));
}

function sectionHeading(node: Element): string {
  const directHeading = node.querySelector(':scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > [role="heading"]');
  // A question can mention employment or education without being a history row.
  // Require a section title, including the numbered/structured ATS variants.
  const sectionTitle = /^(?:(?:your|previous|prior|current|additional) )?(?:work experience|employment(?: history)?|work history|job history|professional experience|education(?: history)?|academic history)(?: (?:section|details|information|record|entry|item|row|\d+))*$/;
  return [
    node.getAttribute('data-automation-id'), node.getAttribute('data-section'), node.id, accessibleText(node), textOf(directHeading),
  ].filter((value): value is string => !!value).map(words).filter(value => sectionTitle.test(value)).join(' ');
}

const recordSelector = 'fieldset, [role="group"], section, article, [data-section], [data-automation-id], [data-employment], [data-education]';
const explicitRecord = /\b(?:entry|item|row|record|\d+)\b/;
const sectionWords: [SectionKind, RegExp][] = [
  ['employment', /\b(?:work experience|employment|work history|job history|professional experience)\b/],
  ['education', /\b(?:education|academic history|education history)\b/],
];

function findSection(element: Element, metadata: string[]): Pick<Field, 'row' | 'section' | 'rowIndex'> {
  const workday = workdayExperienceRow(element);
  if (workday) return { row: workday.row, section: 'employment', rowIndex: workday.index };
  const education = workdayEducationRow(element);
  if (education) return { row: education.row, section: 'education', rowIndex: education.index };
  for (let node = element.parentElement; node && !node.matches('form, body'); node = node.parentElement) {
    if (!node.matches(recordSelector)) continue;
    const heading = sectionHeading(node);
    const section = sectionWords.find(([, pattern]) => pattern.test(heading))?.[0];
    if (section) {
      const indexed = /(?:employment|work.?experience|education)(?:\[|[._-])(\d+)(?=\]|[._-]|$)/i;
      const rowIndex = explicitRecord.test(heading) ? undefined : metadata.map((x) => x.match(indexed)?.[1]).find(Boolean);
      return { row: node, section, rowIndex };
    }
  }
  const indexed = /(employment|work.?experience|education)(?:\[|[._-])(\d+)(?=\]|[._-]|$)/i;
  const index = metadata.map((x) => x.match(indexed)).find(Boolean);
  if (!index) return {};
  const section = /^education$/i.test(index[1]) ? 'education' : 'employment';
  return { row: (element as HTMLInputElement).form ?? element.ownerDocument.body, section, rowIndex: index[2] };
}

export function canClickOption(element: HTMLElement): boolean {
  if (element.closest('a[href], label')) return false;
  if (element.matches('button')) return (element as HTMLButtonElement).type === 'button';
  return !element.closest('button, input, [contenteditable="true"]');
}

export function comboListIds(element: Element): string[] {
  return [...new Set([element.getAttribute('aria-controls'), element.getAttribute('aria-owns')]
    .filter(Boolean).join(' ').trim().split(/\s+/).filter(Boolean))];
}

export function samePopupScope(trigger: Element, menu: Element): boolean {
  const form = menu.closest('form');
  return menu.isConnected && menu.getRootNode() === trigger.getRootNode() && (!form || form === scopeOf(trigger));
}

export function menuForId(origin: Element, id: string, trigger = origin): HTMLElement | undefined {
  const root = origin.getRootNode() as Document | ShadowRoot;
  const escaped = id.replace(/["\\]/g, '\\$&');
  const matches = root.querySelectorAll<HTMLElement>(`[id="${escaped}"]`);
  return matches.length === 1 && samePopupScope(trigger, matches[0]) ? matches[0] : undefined;
}

export function greenhouseMultiSelect(element: Element): { valueContainer: HTMLElement; shell: Element; listId: string } | undefined {
  if (!element.matches('input.select__input[type="text"][role="combobox"][aria-autocomplete="list"][aria-haspopup="true"]:is([aria-expanded="false"],[aria-expanded="true"])')
    || !/^\d+$/.test(element.id)) return undefined;
  const form = (element as HTMLInputElement).form;
  if (!form?.matches('form#application-form') || element.closest('form') !== form) return undefined;
  const valueContainer = element.closest<HTMLElement>('.select__value-container--is-multi, .select__value-container--is-multi--has-value');
  const control = valueContainer?.parentElement;
  const shell = control?.parentElement?.parentElement;
  const container = shell?.parentElement;
  if (!valueContainer || !control?.matches('.select__control') || !shell?.matches('.select-shell')
    || !container?.matches('.select > .select__container') || container.querySelectorAll('[role="combobox"]').length !== 1) return undefined;
  const labels = container.querySelectorAll<HTMLLabelElement>(':scope > label');
  const label = labels[0];
  if (labels.length !== 1 || label.control !== element || label.id !== `${element.id}-label`
    || element.getAttribute('aria-labelledby') !== label.id || !visible(label)) return undefined;
  return { valueContainer, shell, listId: `react-select-${element.id}-listbox` };
}

export function reactSelectParts(element: Element): { valueContainer: HTMLElement; valueClass: string; listId: string } | undefined {
  const multi = greenhouseMultiSelect(element);
  if (multi) return { ...multi, valueClass: 'select__multi-value' };
  if (!element.matches('input[role="combobox"][aria-expanded]:is([aria-haspopup="true"],[aria-haspopup="listbox"])')
    || !/^[a-zA-Z0-9_-]+$/.test(element.id)) return undefined;
  const inputClass = [...element.classList].find(name => /^[a-zA-Z_][a-zA-Z0-9_-]*__input$/.test(name));
  const prefix = inputClass?.slice(0, -'__input'.length);
  if (!prefix) return undefined;
  const valueContainer = element.closest<HTMLElement>(`.${prefix}__value-container`);
  const control = valueContainer?.closest(`.${prefix}__control`);
  if (!valueContainer || !control || control.querySelectorAll('[role="combobox"]').length !== 1) return undefined;
  const listId = /^react-select-.+-input$/.test(element.id)
    ? element.id.replace(/-input$/, '-listbox') : `react-select-${element.id}-listbox`;
  return { valueContainer, valueClass: prefix + '__single-value', listId };
}

function ashbyLocationToggle(element: Element): HTMLButtonElement | undefined {
  if (!element.matches('input.ashby-application-form-input-autocomplete[role="combobox"][aria-autocomplete="list"][aria-haspopup="listbox"]:is([aria-expanded="false"],[aria-expanded="true"])')
    || !/^(?:text|search)$/.test((element as HTMLInputElement).type) || element.closest('a[href], label')) return undefined;
  const wrapper = element.closest('.ashby-application-form-field-entry[data-field-path="_systemfield_location"]');
  if (!wrapper || wrapper.querySelectorAll('[role="combobox"]').length !== 1 || !element.parentElement) return undefined;
  const labels = wrapper.querySelectorAll('label[for="_systemfield_location"]');
  if (labels.length !== 1 || words(labelText(labels[0])) !== 'location') return undefined;
  const captions = [referencedText(element, 'aria-labelledby'), element.getAttribute('aria-label') ?? '', nativeLabels(element)];
  if (captions.some(caption => caption.trim() && !/^(?:current )?location$/.test(words(caption)))) return undefined;
  const buttons = element.parentElement.querySelectorAll<HTMLButtonElement>(':scope > button');
  if (buttons.length !== 1) return undefined;
  const button = buttons[0];
  const safeType = button.type === 'button' || (!button.hasAttribute('type') && !button.form && !button.closest('form'));
  return safeType && !button.closest('a[href], label') && !button.matches(':disabled, [aria-disabled="true"], [formaction], [formmethod], [popovertarget], [command], [commandfor]')
    ? button : undefined;
}

export function isAshbyLocation(element: Element): boolean {
  return !!ashbyLocationToggle(element);
}

function ashbyLocationListId(id: string): boolean {
  return /^(?::[a-zA-Z0-9_-]+:|_r_[a-zA-Z0-9]+_)$/.test(id);
}

export function ashbyLocationMenu(element: HTMLElement): HTMLElement | undefined {
  const id = element.getAttribute('aria-controls');
  if (!isAshbyLocation(element) || !id || !ashbyLocationListId(id)
    || element.getAttribute('aria-expanded') !== 'true' || element.hasAttribute('aria-owns')) return undefined;
  const list = menuForId(element, id);
  return list?.matches('[role="listbox"]:not([aria-multiselectable="true"])') ? list : undefined;
}

function comboLists(element: Element): HTMLElement[] {
  if (isAshbyLocation(element)) {
    const list = ashbyLocationMenu(element as HTMLElement);
    return list ? [list] : [];
  }
  const ids = comboListIds(element);
  const multi = greenhouseMultiSelect(element);
  if (multi) {
    const list = ids.length === 1 && ids[0] === multi.listId ? menuForId(element, multi.listId) : undefined;
    return list?.matches('[role="listbox"][aria-multiselectable="true"]') && multi.shell.contains(list) ? [list] : [];
  }
  const react = reactSelectParts(element);
  if (react && (ids.length !== 1 || ids[0] !== react.listId)) return [];
  return ids.map((id) => menuForId(element, id))
    .filter((list): list is HTMLElement => !!list?.matches('[role="listbox"]'));
}

export function comboToggle(element: HTMLElement): HTMLButtonElement | undefined {
  const parent = element.parentElement;
  if (!parent || parent.querySelectorAll('[role="combobox"]').length !== 1) return undefined;
  const names = [element.id, element.getAttribute('name') ?? '', accessibleText(element), nativeLabels(element)].map(words);
  const ids = comboListIds(element);
  const toggles = Array.from(parent.querySelectorAll<HTMLButtonElement>(':scope > button[type="button"]')).filter((button) => {
    if (button === element || !writable(button) || button.closest('a[href], label') || button.matches('[role]')) return false;
    if (button.hasAttribute('aria-expanded') && ids.includes(button.getAttribute('aria-controls') ?? '')) return true;
    const target = words(accessibleText(button)).match(/^toggle (.+) options$/)?.[1];
    return !!target && names.includes(target);
  });
  return toggles.length === 1 ? toggles[0] : undefined;
}

export function comboActivation(element: HTMLElement): HTMLElement | undefined {
  if (element.closest('a[href]')) return undefined;
  const location = ashbyLocationToggle(element);
  if (location) return location;
  const toggle = comboToggle(element);
  if (toggle) return toggle;
  if (element.matches('input')) return /^(?:text|search)$/.test((element as HTMLInputElement).type) ? element : undefined;
  if (element.matches('button')) return (element as HTMLButtonElement).type === 'button' ? element : undefined;
  return element.closest('button, input, label, [contenteditable="true"]') ? undefined : element;
}

export function canLoadComboChoices(field: Field): boolean {
  const { element } = field;
  if (isWorkdayPromptInput(element)) return !!workdayPrompt(element) && !!comboActivation(element);
  const ids = comboListIds(element);
  if (isAshbyLocation(element)) {
    return (element.getAttribute('aria-expanded') === 'false' && !ids.length) || !!ashbyLocationMenu(element);
  }
  if (usesNestedOptions(element)) {
    const popup = nestedPopup(element);
    const localWrapper = !ids.length && workdayLocalWrapper(element);
    const associated = ids.length === 1 ? (!findById(element, ids[0]) || !!popup) : localWrapper;
    return !!associated && !!comboActivation(element) && (element.hasAttribute('aria-expanded') || !!localWrapper || !!popup);
  }
  const react = reactSelectParts(element);
  if (react && element.getAttribute('aria-expanded') === 'false') {
    return (!ids.length || (ids.length === 1 && ids[0] === react.listId))
      && !findById(element, react.listId) && comboActivation(element) === element;
  }
  const workday = isWorkdayChoice(element);
  return element.getAttribute('aria-expanded') === 'false' && ids.length > 0 && ids.every((id) => {
    const list = menuForId(element, id);
    return !findById(element, id) || (!!list?.matches('[role="listbox"]') && (workday || !list.querySelector('[role="option"]')));
  }) && !!comboActivation(element);
}

export function comboChoices(element: HTMLElement): Choice[] {
  // A Workday prompt displays only one category at a time. Its complete choice set is resolved during fill.
  if (isWorkdayPromptInput(element)) return [];
  const multi = greenhouseMultiSelect(element);
  if (!multi && usesNestedOptions(element)) return nestedChoices(element);
  const options = new Set<HTMLElement>();
  for (const list of comboLists(element)) {
    const selector = isWorkdayChoice(element) ? '[role="option"], :scope > li:not(#select-one)' : '[role="option"]';
    for (const option of list.querySelectorAll<HTMLElement>(selector)) {
      if (option.id === 'select-one' || option.closest(':disabled, [aria-disabled="true"]') || !canClickOption(option)) continue;
      if (multi && (!option.id.startsWith(`react-select-${element.id}-option-`) || option.closest('[role="listbox"]') !== list)) continue;
      options.add(option);
    }
  }
  return [...options].map((option) => ({
    element: option,
    label: accessibleText(option) || textOf(option),
    value: multi ? '' : option.getAttribute('data-value') ?? '',
  })).filter((option) => !!option.label);
}

function choicesFor(element: Control, kind: FieldKind, peers: HTMLElement[]): Choice[] {
  if (kind === 'select') {
    return [...(element as HTMLSelectElement).options]
      .filter((option) => !option.disabled && !option.closest('optgroup:disabled') && !!option.value.trim())
      .map((option) => ({ element: option, label: option.label.trim(), value: option.value }));
  }
  if (kind === 'radio' || (kind === 'checkbox' && peers.length > 1)) {
    return peers.filter(choiceActivation).map((option) => ({
      element: option,
      label: accessibleText(option) || nativeLabels(option) || (option.matches('input') ? (option as HTMLInputElement).value : labelText(option)),
      value: option.getAttribute('value') ?? option.getAttribute('data-value') ?? '',
    }));
  }
  return kind === 'combobox' ? comboChoices(element) : [];
}

export function inspectField(element: Control, knownRadios?: HTMLInputElement[]): Field | undefined {
  if (insideExtensionUI(element) || optionalResumeParser(element)) return undefined;
  if (element.matches('input[type="checkbox"]') && element.closest(ashbyPressedGroup)?.querySelector('button[aria-pressed]')
    && !visible(element)) return undefined;
  const writableControl = writable(element);
  const associatedLabel = writableControl ? undefined : visibleAssociatedLabel(element);
  const workdayUpload = workdayResumeInput(element);
  const accessibleWorkdayUpload = workdayUpload && writable(workdayUpload.trigger) && visible(workdayUpload.wrapper)
    && element.isConnected && !element.matches(':disabled, [readonly]')
    && !element.closest('[inert], [aria-disabled="true"], [aria-readonly="true"]');
  if ((!associatedLabel && !writableControl && !accessibleWorkdayUpload) || element.closest('[role="option"], [role="treeitem"]')
    || element.closest('[data-automation-id="activeListContainer"]') || insideWorkdayPromptUI(element) || insideWorkdaySkillsUI(element)) return undefined;
  const combo = element.closest('[role="combobox"]');
  if (combo && combo !== element) return undefined;
  const pressed = pressedChoices(element);
  const kind = pressed ? 'radio' : kindOf(element);
  if (!kind) return undefined;
  const lever = leverFieldLabel(element, kind);
  const ariaRadios = customRadioPeers(element);
  const ariaCheckbox = ariaChoiceButton(element, 'checkbox');
  const accessiblePopup = kind === 'combobox' && element.matches('button[type="button"]')
    && ((element.matches('[aria-haspopup="tree"][aria-expanded], [aria-haspopup="listbox"][aria-expanded]') && comboListIds(element).length === 1)
      || !!workdayLocalWrapper(element));
  const widget = isManualWidget(element);
  if (widget && duplicatesControl(element)) return undefined;
  const manual = widget && !ariaRadios.length && !ariaCheckbox && !accessiblePopup;
  const scope = scopeOf(element);
  const input = element as HTMLInputElement;
  const checkboxContainer = !manual && kind === 'checkbox' && input.name ? element.closest(choiceGroupSelector) : null;
  const checkboxes = checkboxContainer && (groupLabel(checkboxContainer) || lever) ? Array.from(checkboxContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter((checkbox) => checkbox.name === input.name && scopeOf(checkbox) === scope && checkbox.closest(choiceGroupSelector) === checkboxContainer) : [];
  const checkboxGroup = checkboxes.length > 1 ? checkboxContainer : null;
  const peers = pressed?.peers ?? (ariaRadios.length ? ariaRadios : !manual && kind === 'radio' ? radioGroup(knownRadios ?? [
    ...(input.form ? Array.from(input.form.elements).filter((node): node is HTMLInputElement => node.matches('input[type="radio"]'))
      : (element.getRootNode() as Document | ShadowRoot).querySelectorAll<HTMLInputElement>('input[type="radio"]')),
  ], input) : checkboxGroup ? checkboxes : []);
  const resumeAlternative = resumeAlternativeFor(element);
  const caption = associatedLabel && (kind === 'file' || (kind === 'checkbox' && !checkboxGroup)) && labelText(associatedLabel, true);
  const upload = accessibleWorkdayUpload ? { text: 'Resume/CV', trusted: true, required: false }
    : kind === 'file' && !lever ? attachmentLabel(element, caption || '') : undefined;
  const label = pressed?.label ?? upload ?? (caption && !lever
    ? { text: caption.replace(requiredMarker, ''), trusted: true, required: requiredMarker.test(caption) }
    : labelFor(element, kind, resumeAlternative?.type === 'file', checkboxGroup, lever));
  const preferredName = workdayPreferredNameLabel(element, label);
  const metadata = metadataFor(element);
  const autocomplete = element.getAttribute('autocomplete') ?? '';
  const choices = manual ? [] : choicesFor(element, kind, peers);
  const context = fieldContext(element);
  const blockEvidence = [label.text, context, ...metadata,
    ...(associatedLabel ? [accessibleText(element), nativeLabels(element)] : []),
    ...peers.flatMap((peer) =>
    [accessibleText(peer), nativeLabels(peer), referencedText(peer, 'aria-describedby'), ...metadataFor(peer)]),
    ...choices.map((choice) => choice.label),
  ].map(words).join(' ');
  return {
    element, scope, peers, kind, label: preferredName || withoutQuestionNumber(label.text) || words(metadata[0] ?? autocomplete) || 'Unlabeled field',
    context, metadata, autocomplete,
    choices, resumeAlternative,
    unsupportedReason: preferredName === false ? 'Complete this preferred-name field on the application page.'
      : manual ? 'Complete this custom field on the application page.' : undefined,
    blocked: element.matches('input[type="password"]') || excludedAutocomplete.test(autocomplete)
      || forbiddenPurpose.test(blockEvidence) || dataHandling.test(blockEvidence)
      || ((kind === 'checkbox' || !!pressed) && [label.text, nativeLabels(element), ...peers.flatMap((peer) => [nativeLabels(peer), accessibleText(peer)])]
        .some((text) => words(text) === 'i accept')),
    trustedLabel: label.trusted,
    pressedChoice: !!pressed,
    required: label.required || [element, ...peers, checkboxGroup].some((control) => control?.matches('[required], [aria-required="true"]')),
    multiple: !!checkboxGroup || !!workdaySkillsWidget(element) || element.matches('select[multiple], [aria-multiselectable="true"]')
      || (kind === 'combobox' && (!!greenhouseMultiSelect(element) || !!nestedPopup(element)?.matches('[aria-multiselectable="true"]')
        || comboLists(element).some((list) => list.matches('[aria-multiselectable="true"]')))),
    ...findSection(element, metadata),
  };
}

export function discover(doc: Document, form?: HTMLFormElement): Field[] {
  const pages = form ? [] : [...doc.querySelectorAll('[data-automation-id="applyFlowPage"]')].filter(visible);
  const all = allControls(form ?? (pages.length === 1 ? pages[0] : doc));
  const radios = all.filter((element): element is HTMLInputElement => element.matches('input[type="radio"]'));
  const seen = new Set<Element>();
  const fields: Field[] = [];
  for (const element of all) {
    if (seen.has(element)) continue;
    const field = inspectField(element, radios);
    if (field) {
      field.peers.forEach((peer) => seen.add(peer));
      fields.push(field);
    }
  }
  return fields;
}

export function fieldIdentity(field: Field, includeChoices = true): string {
  const reactListId = field.kind === 'combobox' ? reactSelectParts(field.element)?.listId : undefined;
  const ashbyLocation = field.kind === 'combobox' && isAshbyLocation(field.element);
  const workdayListbox = field.kind === 'combobox' && workdayListboxLabel(field.element);
  const workdayPromptId = field.kind === 'combobox' && workdayPrompt(field.element)?.id;
  return JSON.stringify([
    field.label, field.context, field.kind, field.metadata, field.autocomplete, field.blocked, field.required, field.trustedLabel, field.multiple, field.unsupportedReason,
    ['type', 'role', 'accept', 'aria-haspopup', 'aria-controls', 'aria-owns', 'maxLength', 'min', 'max', 'step', 'pattern', 'multiple']
      .map((attribute) => {
        const value = field.element.getAttribute(attribute);
        if (attribute === 'aria-controls' && ashbyLocation && (!value || ashbyLocationListId(value))) return 'ashby-system-location-listbox';
        if (attribute === 'aria-controls' && workdayListbox) {
          const menu = value && menuForId(field.element, value);
          if (value === null || (field.element.hasAttribute('aria-expanded') && /^[^\s]+$/.test(value)
            && !field.element.hasAttribute('aria-owns') && (!findById(field.element, value) || (menu && menu.matches('ul[role="listbox"]'))))) {
            return 'workday-listbox';
          }
        }
        // A recognized React Select adds its own association when the list opens.
        return attribute === 'aria-controls' && reactListId && (!value || value === reactListId) ? reactListId : value;
      }),
    field.section, field.rowIndex, field.pressedChoice, workdayPromptId, !!workdayMonthDisplay(field.element),
    includeChoices ? field.choices.map(({ label, value }) => [label, value]) : [],
  ]);
}
