import { workdayWebsiteContainer, workdayWebsiteRow } from './workday-structure';

export interface WorkdayTextFieldLocation {
  kind: 'field';
  id: string;
  name: string;
  month: false;
  page: Element;
  pageAutomation: string;
  group: Element;
  section: Element;
  groupLabel: string;
  wrapper: Element;
  websiteRecord?: Element;
  form: HTMLFormElement | null;
}

function expectedIdentity(id: string): { name: string; section: string; page: string; row?: 'education' | 'websites' } | undefined {
  const name = /^name--((legalName|preferredName)--(?:firstName|middleName|lastName))$/.exec(id);
  if (name) return { name: name[1], section: name[2] === 'legalName' ? 'Legal-Name-section' : 'Preferred-Name-section', page: 'applyFlowMyInfoPage' };
  const address = /^address--(addressLine1|addressLine2|city|postalCode|regionSubdivision1)$/.exec(id);
  if (address) return { name: address[1], section: 'Address-section', page: 'applyFlowMyInfoPage' };
  const phone = /^phoneNumber--(phoneNumber|extension)$/.exec(id);
  if (phone) return { name: phone[1], section: 'Phone-section', page: 'applyFlowMyInfoPage' };
  if (id === 'socialNetworkAccounts--linkedInAccount') return { name: 'linkedInAccount', section: 'Social-Network-URLs-section', page: 'applyFlowMyExpPage' };
  const education = /^education-\d+--(schoolName|gradeAverage)$/.exec(id);
  if (education) return { name: education[1], section: 'Education-section', page: 'applyFlowMyExpPage', row: 'education' };
  if (/^webAddress-\d+--url$/.test(id)) return { name: 'url', section: 'Websites-section', page: 'applyFlowMyExpPage', row: 'websites' };
  return undefined;
}

export function workdayTextFieldInput(location: WorkdayTextFieldLocation): HTMLInputElement | undefined {
  const { page, pageAutomation, group, section, groupLabel, wrapper, id, name, form } = location;
  const doc = page.ownerDocument;
  const identity = expectedIdentity(id);
  if (!identity || identity.name !== name || !page.isConnected || !group.isConnected || !wrapper.isConnected
    || pageAutomation !== identity.page || page.getAttribute('data-automation-id') !== pageAutomation
    || doc.querySelectorAll(`[data-automation-id="${pageAutomation}"]`).length !== 1
    || page.closest('form') !== form || !section.isConnected || !page.contains(section) || !section.contains(group) || !group.contains(wrapper)
    || group.closest(`[data-automation-id="${pageAutomation}"]`) !== page
    || !section.matches('[role="group"]') || section.getAttribute('aria-labelledby') !== identity.section
    || !group.matches('[role="group"]') || group.getAttribute('aria-labelledby') !== groupLabel
    || wrapper.getAttribute('data-automation-id') !== `formField-${name}`
    || wrapper.closest('[role="group"]') !== group) return undefined;
  const heading = doc.getElementById(identity.section);
  if (!heading || !section.contains(heading) || !heading.matches('h4')
    || doc.querySelectorAll(`[id="${identity.section}"]`).length !== 1) return undefined;
  if (identity.row === 'education') {
    const row = /^Education-([1-9]\d*)-panel$/.exec(groupLabel);
    const rowHeading = row && doc.getElementById(groupLabel);
    if (!row || !rowHeading || !group.contains(rowHeading) || !rowHeading.matches('h5')
      || rowHeading.textContent?.trim() !== `Education ${row[1]}`
      || group.parentElement?.closest('[role="group"]') !== section
      || doc.querySelectorAll(`[id="${groupLabel}"]`).length !== 1) return undefined;
  } else if (identity.row === 'websites') {
    const websiteRow = workdayWebsiteRow(wrapper);
    if (websiteRow?.row !== group || websiteRow.group !== section
      || doc.querySelectorAll(`[id="${groupLabel}"]`).length !== 1) return undefined;
  } else if (group !== section || groupLabel !== identity.section) return undefined;
  const matches = doc.querySelectorAll<HTMLInputElement>(`[id="${id}"]`);
  const input = matches[0];
  if (matches.length !== 1) return undefined;
  if (identity.row === 'websites' && (!location.websiteRecord
    || workdayWebsiteContainer(input, group)?.record !== location.websiteRecord)) return undefined;
  return input.matches('input:is(:not([type]),[type="text"],[type="tel"])')
    && input.name === name && input.form === form && !input.hasAttribute('form')
    && input.closest('[data-automation-id^="formField-"]') === wrapper
    && wrapper.querySelectorAll('input:not([type="hidden"]),textarea,select,[role="combobox"]').length === 1
    ? input : undefined;
}

export function workdayTextFieldLocation(element: Element): WorkdayTextFieldLocation | undefined {
  const identity = expectedIdentity(element.id);
  if (!identity) return undefined;
  const page = element.closest(`[data-automation-id="${identity.page}"]`);
  const group = element.closest('[role="group"]');
  const wrapper = element.closest('[data-automation-id^="formField-"]');
  const section = identity.row ? group?.parentElement?.closest('[role="group"]') : group;
  const groupLabel = group?.getAttribute('aria-labelledby');
  if (!page || !group || !wrapper || !section || !groupLabel) return undefined;
  const location: WorkdayTextFieldLocation = {
    kind: 'field', id: element.id, name: identity.name, month: false,
    page, pageAutomation: identity.page, group, section, groupLabel, wrapper, form: page.closest('form'),
    websiteRecord: identity.row === 'websites' ? workdayWebsiteContainer(element, group)?.record : undefined,
  };
  return workdayTextFieldInput(location) === element ? location : undefined;
}
