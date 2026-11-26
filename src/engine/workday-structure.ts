const experienceRoleSelector = '[role="group"][aria-labelledby="Work-Experience-section"]';
export const workdayExperienceSelector = `[data-automation-id="workExperienceSection"], ${experienceRoleSelector}`;
export const workdayExperiencePageSelector = '[data-automation-id="applyFlowMyExpPage"], [data-automation-id="myExperiencePage"], form[data-automation-id="candidateApplicationForm"]';

const experienceRowSelector = '[data-automation-id^="workExperience-"], [role="group"][aria-labelledby^="Work-Experience-"][aria-labelledby$="-panel"]';
const experienceRowId = /^workExperience-((?:0|[1-9]\d*))$/;
const experiencePanelId = /^Work-Experience-([1-9]\d*)-panel$/;
const resumeSectionSelector = '[role="group"][aria-labelledby="Resume/CV-section"]';
const resumeWrapperSelector = '[data-automation-id="attachments-FileUpload"]';
const resumeInputSelector = 'input[type="file"][multiple][data-automation-id="file-upload-input-ref"]';

function hasLocalHeading(group: Element, headingId: string, caption: string): boolean {
  const headings = group.querySelectorAll(`:is(h4, h5, [role="heading"])[id="${headingId}"]`);
  return headings.length === 1 && headings[0].textContent?.trim().replace(/\s+/g, ' ') === caption;
}

export function isWorkdayExperienceGroup(group: Element): boolean {
  if (!group.matches(workdayExperienceSelector)) return false;
  if (!group.matches(experienceRoleSelector)) return true;
  return !!group.closest('[data-automation-id="applyFlowMyExpPage"]')
    && hasLocalHeading(group, 'Work-Experience-section', 'Work Experience');
}

export function workdayExperienceRow(element: Element): { group: Element; row: Element; index: string } | undefined {
  const group = element.closest(workdayExperienceSelector);
  if (!group || !isWorkdayExperienceGroup(group)) return undefined;
  for (let row = element.closest(experienceRowSelector); row && row.closest(workdayExperienceSelector) === group;
    row = row.parentElement?.closest(experienceRowSelector) ?? null) {
    const automation = experienceRowId.exec(row.getAttribute('data-automation-id') ?? '');
    if (automation) return { group, row, index: automation[1] };
    const panel = experiencePanelId.exec(row.getAttribute('aria-labelledby') ?? '');
    if (panel && hasLocalHeading(row, panel[0], 'Work Experience ' + panel[1])) return { group, row, index: panel[1] };
  }
  return undefined;
}

export function workdayExperienceRows(group: Element): { row: Element; index: string }[] {
  return [...group.querySelectorAll(experienceRowSelector)].flatMap(element => {
    const identity = workdayExperienceRow(element);
    return identity?.group === group && identity.row === element ? [identity] : [];
  });
}

export type WorkdayRepeatKind = 'education' | 'websites';

const repeatSections = {
  education: { title: 'Education', heading: 'Education-section', panel: /^Education-([1-9]\d*)-panel$/ },
  websites: { title: 'Websites', heading: 'Websites-section', panel: /^Websites-([1-9]\d*)-panel$/ },
};
const repeatPageSelector = '[data-automation-id="applyFlowMyExpPage"]';

export function workdayRepeatSelector(kind: WorkdayRepeatKind): string {
  return `[role="group"][aria-labelledby="${repeatSections[kind].heading}"]`;
}

export function workdayRepeatPage(group: Element, kind: WorkdayRepeatKind): Element | undefined {
  const section = repeatSections[kind];
  const page = group.closest(repeatPageSelector);
  if (!group.matches(workdayRepeatSelector(kind)) || !page
    || group.ownerDocument.querySelectorAll(repeatPageSelector).length !== 1
    || !hasLocalHeading(group, section.heading, section.title)) return undefined;
  return page;
}

function workdayRepeatRow(element: Element, kind: WorkdayRepeatKind) {
  const group = element.closest(workdayRepeatSelector(kind));
  if (!group || !workdayRepeatPage(group, kind)) return undefined;
  const section = repeatSections[kind];
  for (let row = element.closest('[role="group"][aria-labelledby]'); row && row !== group;
    row = row.parentElement?.closest('[role="group"][aria-labelledby]') ?? null) {
    const panel = section.panel.exec(row.getAttribute('aria-labelledby') ?? '');
    if (panel && row.parentElement?.closest('[role="group"]') === group
      && hasLocalHeading(row, panel[0], section.title + ' ' + panel[1])) return { group, row, index: panel[1] };
  }
  return undefined;
}

export function workdayEducationRow(element: Element) {
  return workdayRepeatRow(element, 'education');
}

export function workdayWebsiteRow(element: Element) {
  return workdayRepeatRow(element, 'websites');
}

export function workdayWebsiteContainer(element: Element, row: Element) {
  const id = element.id;
  const address = /^(webAddress-\d+)--url$/.exec(id);
  const wrapper = element.closest('[data-automation-id="formField-url"]');
  const record = wrapper?.closest('[data-fkit-id$="--null"]');
  if (!address || !wrapper || !record || wrapper.getAttribute('data-fkit-id') !== id
    || record.getAttribute('data-fkit-id') !== address[1] + '--null' || !row.contains(record)) return undefined;
  return { wrapper, record };
}

export function workdayRepeatRows(group: Element, kind: WorkdayRepeatKind) {
  return [...group.querySelectorAll('[role="group"][aria-labelledby$="-panel"]')].flatMap(element => {
    const identity = workdayRepeatRow(element, kind);
    return identity?.group === group && identity.row === element ? [identity] : [];
  });
}

export function workdayResumeWrapper(section: Element): HTMLElement | undefined {
  if (!section.matches(resumeSectionSelector)
    || !section.closest('[data-automation-id="applyFlowMyExpPage"]')
    || !hasLocalHeading(section, 'Resume/CV-section', 'Resume/CV')) return undefined;
  const wrappers = [...section.querySelectorAll<HTMLElement>(resumeWrapperSelector)]
    .filter(wrapper => wrapper.closest(resumeSectionSelector) === section);
  return wrappers.length === 1 ? wrappers[0] : undefined;
}

export function workdayResumeInput(element: Element) {
  if (!element.matches(resumeInputSelector)) return undefined;
  const input = element as HTMLInputElement;
  const section = input.closest<HTMLElement>(resumeSectionSelector);
  const page = section?.closest('[data-automation-id="applyFlowMyExpPage"]');
  const wrapper = section && workdayResumeWrapper(section);
  if (!section || !page || !wrapper || input.closest(resumeWrapperSelector) !== wrapper) return undefined;
  const inputs = wrapper.querySelectorAll('input[type="file"]');
  if (inputs.length !== 1 || inputs[0] !== input) return undefined;
  const buttons = wrapper.querySelectorAll<HTMLButtonElement>(
    '[data-automation-id="file-upload-drop-zone"] button[type="button"][data-automation-id="select-files"][id="resumeAttachments--attachments"]',
  );
  const trigger = buttons[0];
  const form = section.closest('form');
  if (buttons.length !== 1 || !trigger || trigger.form !== form || input.form !== form
    || trigger.closest(resumeWrapperSelector) !== wrapper || trigger.closest('a[href], label')
    || trigger.textContent?.trim().replace(/\s+/g, ' ') !== 'Select files') return undefined;
  return { section, wrapper, page, trigger };
}
