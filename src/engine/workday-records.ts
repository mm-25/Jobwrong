import type { Profile, WorkdayExperienceExpansion } from '../shared/types';
import { matchRows } from './answers';
import { displayValue } from './controls';
import { accessibleText, discover, labelText, visible, words, writable, type Field } from './discovery';
import { isWorkdayExperienceGroup, workdayExperiencePageSelector, workdayExperienceRows, workdayExperienceSelector,
  workdayRepeatPage, workdayRepeatRows, workdayRepeatSelector, workdayWebsiteContainer, type WorkdayRepeatKind,
} from './workday-structure';

const MAX_ADDITIONS = 12;
const MAX_EXPANSION_MS = 6000;
const MAX_ADD_WAIT_MS = 1000;

export interface WorkdayExperienceGroup {
  element: HTMLElement;
  page: Element;
  form: HTMLFormElement | null;
}

export function workdayExperienceGroup(doc: Document): WorkdayExperienceGroup | undefined {
  const groups = [...doc.querySelectorAll<HTMLElement>(workdayExperienceSelector)].filter(group => visible(group) && isWorkdayExperienceGroup(group));
  if (groups.length !== 1) return undefined;
  const element = groups[0];
  const page = element.closest(workdayExperiencePageSelector);
  return page ? { element, page, form: element.closest('form') } : undefined;
}

export interface WorkdayRepeatGroup extends WorkdayExperienceGroup {
  kind: WorkdayRepeatKind;
}

export function workdayRepeatGroup(doc: Document, kind: WorkdayRepeatKind): WorkdayRepeatGroup | undefined {
  const groups = [...doc.querySelectorAll<HTMLElement>(workdayRepeatSelector(kind))].filter(visible);
  if (groups.length !== 1) return undefined;
  const element = groups[0];
  const page = workdayRepeatPage(element, kind);
  return page ? { kind, element, page, form: element.closest('form') } : undefined;
}

type WorkdayGroup = WorkdayExperienceGroup & { kind?: WorkdayRepeatKind };

function addButton(group: WorkdayGroup): HTMLButtonElement | undefined {
  const selector = group.kind ? workdayRepeatSelector(group.kind) : workdayExperienceSelector;
  const buttons = [...group.element.querySelectorAll<HTMLButtonElement>('button[data-automation-id="add-button"]')]
    .filter(button => button.closest(selector) === group.element && visible(button)
      && (!group.kind || button.closest('[role="group"]') === group.element));
  if (buttons.length !== 1) return undefined;
  const button = buttons[0];
  const caption = words(labelText(button));
  const name = words(accessibleText(button));
  const safeCaption = group.kind === 'education' ? /^(?:add|add another)(?: education)?$/
    : group.kind === 'websites' ? /^(?:add|add another)(?: website)?$/
    : /^(?:add|add another)(?: work experience)?$/;
  // Workday's formless experience step omits type. Its button has no form to submit.
  const explicitButton = button.getAttribute('type')?.toLowerCase() === 'button';
  const formlessButton = !button.hasAttribute('type') && !button.form && !button.closest('form');
  if (!safeCaption.test(caption) || (name && !safeCaption.test(name)) || button.form !== group.form
    || !writable(button) || !(explicitButton || formlessButton) || !button.matches(':not([role]), [role="button"]')
    || button.closest('a[href], label')
    || button.matches('[formaction], [formmethod], [formenctype], [formtarget], [formnovalidate], [popovertarget], [popovertargetaction], [command], [commandfor]')) {
    return undefined;
  }
  return button;
}

function visibleRows(group: WorkdayGroup) {
  const rows = group.kind ? workdayRepeatRows(group.element, group.kind) : workdayExperienceRows(group.element);
  return rows.filter(({ row }) => visible(row));
}

function missingExperienceRows(group: WorkdayExperienceGroup, profile: Profile): number | undefined {
  const fields = discover(group.element.ownerDocument).filter(field => group.element.contains(field.element)
    && field.section === 'employment');
  const rows = visibleRows(group);
  const identified = new Set(rows.map(({ row }) => row));
  const scope = group.form ?? group.element.getRootNode();
  if (new Set(rows.map(({ index }) => index)).size !== rows.length
    || fields.some(field => field.scope !== scope || !field.row || !identified.has(field.row))) return undefined;
  const matches = matchRows(fields, profile, displayValue);
  if (rows.some(({ row }) => {
    const field = fields.find(candidate => candidate.row === row);
    return !field || matches.get(field)?.identities.length !== 2;
  })) return undefined;
  const matched = new Set([...matches.values()].flatMap(match => match.record ? [match.record] : match.possibleRecords));
  return profile.employment.filter(record => record.company.trim() && !matched.has(record)).length;
}

type ReadValue = (field: Field) => string;

function repeatFields(group: WorkdayRepeatGroup, fields: Field[]) {
  const rows = visibleRows(group);
  const inGroup = fields.filter(field => group.element.contains(field.element));
  const scope = group.form ?? group.element.getRootNode();
  if (new Set(rows.map(({ index }) => index)).size !== rows.length
    || inGroup.some(field => field.scope !== scope || !rows.some(({ row }) => row.contains(field.element)))) return undefined;
  return rows.map(({ row }) => ({ row, fields: inGroup.filter(field => row.contains(field.element)) }));
}

function missingEducationRows(group: WorkdayRepeatGroup, profile: Profile, fields: Field[]): number | undefined {
  const inventory = repeatFields(group, fields);
  if (!inventory) return undefined;
  const matches = matchRows(inventory.flatMap(entry => entry.fields), profile, displayValue);
  if (inventory.some(entry => {
    const schools = entry.fields.filter(field => field.section === 'education' && field.row === entry.row
      && field.trustedLabel && !field.blocked && /^education-\d+--school(?:Name)?$/.test(field.element.id));
    return schools.length !== 1 || !matches.get(schools[0])?.identities.includes(schools[0]);
  })) return undefined;
  const matched = new Set([...matches.values()].flatMap(match => match.record ? [match.record] : match.possibleRecords));
  return profile.education.filter(record => record.school.trim() && !matched.has(record)).length;
}

function websiteUrlKey(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function websiteInventory(group: WorkdayRepeatGroup, fields: Field[], profile: Profile, readValue: ReadValue) {
  const rows = repeatFields(group, fields);
  if (!rows) return undefined;
  const links = new Map<string, string>();
  for (const value of [profile.personal.website, profile.personal.github]) {
    const key = websiteUrlKey(value);
    if (key && !links.has(key)) links.set(key, value.trim());
  }
  const blanks: Field[] = [];
  for (const { row, fields: candidates } of rows) {
    const field = candidates[0];
    if (candidates.length !== 1 || !field.trustedLabel || field.blocked || field.kind !== 'text'
      || !field.element.matches('input:is(:not([type]), [type="url"], [type="text"])')) return undefined;
    const input = field.element as HTMLInputElement;
    if (input.form !== group.form || input.name !== 'url' || input.hasAttribute('form')
      || !workdayWebsiteContainer(input, row) || input.ownerDocument.querySelectorAll(`[id="${input.id}"]`).length !== 1
      || words(field.label) !== 'url') return undefined;
    const value = readValue(field).trim();
    const key = websiteUrlKey(value);
    if (key) links.delete(key);
    if (!value && writable(field.element)) blanks.push(field);
  }
  const targets = [...links.values()];
  const answers = new Map(blanks.slice(0, targets.length).map((field, index) => [field, targets[index]]));
  return { answers, missing: targets.length - answers.size };
}

export function workdayWebsiteAnswers(fields: Field[], profile: Profile, readValue: ReadValue): Map<Field, string> {
  const doc = fields[0]?.element.ownerDocument;
  const group = doc && workdayRepeatGroup(doc, 'websites');
  // Capture the complete group so callers cannot allocate links to a filtered subset of rows.
  return (group && websiteInventory(group, fields, profile, readValue)?.answers) || new Map();
}

function missingRows(group: WorkdayGroup, profile: Profile): number | undefined {
  if (!group.kind) return missingExperienceRows(group, profile);
  const repeat = { ...group, kind: group.kind };
  const fields = discover(group.element.ownerDocument);
  return group.kind === 'websites' ? websiteInventory(repeat, fields, profile, displayValue)?.missing
    : missingEducationRows(repeat, profile, fields);
}

function confirmAddition(
  group: WorkdayGroup,
  original: ReturnType<typeof visibleRows>,
  profile: Profile,
  stillAssociated: () => boolean,
  timeout: number,
): Promise<boolean> {
  const doc = group.element.ownerDocument;
  const win = doc.defaultView!;
  return new Promise(resolve => {
    const observer = new win.MutationObserver(check);
    const stop = win.setTimeout(() => finish(false), timeout);
    function finish(success: boolean) {
      observer.disconnect();
      win.clearTimeout(stop);
      resolve(success);
    }
    function check() {
      if (!stillAssociated()) return finish(false);
      const current = visibleRows(group);
      const originalRowsRetained = original.every(({ row, index }, i) => current[i]?.row === row && current[i]?.index === index);
      if (!originalRowsRetained || current.length > original.length + 1) return finish(false);
      if (current.length !== original.length + 1) return;
      const added = current.at(-1)!;
      if (original.some(({ index }) => index === added.index)) return finish(false);
      if (missingRows(group, profile) !== undefined) finish(true);
    }
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
    check();
  });
}

async function addRows(
  group: WorkdayGroup,
  profile: Profile,
  samePage: () => boolean,
): Promise<WorkdayExperienceExpansion> {
  const doc = group.element.ownerDocument;
  const deadline = Date.now() + MAX_EXPANSION_MS;
  const rowName = group.kind === 'education' ? 'education' : group.kind === 'websites' ? 'website' : 'work experience';
  const records = group.kind === 'education' ? 'education records' : group.kind === 'websites' ? 'website links' : 'work experiences';
  const stillAssociated = () => {
    if (!samePage() || !group.element.isConnected || !visible(group.element)) return false;
    const current = group.kind ? workdayRepeatGroup(doc, group.kind) : workdayExperienceGroup(doc);
    return current?.element === group.element && current.page === group.page && current.form === group.form;
  };
  let added = 0;
  let needsRescan = false;
  while (stillAssociated()) {
    const missing = missingRows(group, profile);
    if (missing === undefined || !missing) break;
    const remaining = deadline - Date.now();
    if (added >= MAX_ADDITIONS || remaining <= 0) {
      return { added, needsRescan, message: `${missing} saved ${records} still need rows. Click Autofill to continue.` };
    }
    const button = addButton(group);
    if (!button) {
      return { added, needsRescan, message: `${missing} saved ${records} need additional rows.` };
    }
    const original = visibleRows(group);
    needsRescan = true;
    button.click();
    if (!await confirmAddition(group, original, profile, stillAssociated, Math.min(remaining, MAX_ADD_WAIT_MS))) {
      return { added, needsRescan, aborted: true, message: `Workday did not confirm one additional ${rowName} row. Click Autofill again to review it.` };
    }
    added++;
  }
  return stillAssociated() ? { added, needsRescan }
    : { added, needsRescan, aborted: true, message: `The ${rowName} section changed. Click Autofill again to review it.` };
}

export function addWorkdayExperienceRows(
  group: WorkdayExperienceGroup,
  profile: Profile,
  samePage: () => boolean,
): Promise<WorkdayExperienceExpansion> {
  return addRows(group, profile, samePage);
}

export function addWorkdayRepeatRows(
  group: WorkdayRepeatGroup,
  profile: Profile,
  samePage: () => boolean,
): Promise<WorkdayExperienceExpansion> {
  return addRows(group, profile, samePage);
}
