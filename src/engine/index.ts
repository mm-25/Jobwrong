import { workdaySkillKey, workdaySkillSelections, workdaySkillsWidget } from './workday-skills';
import type { FieldPlan, FillEntry, FillResult, Profile, ScanOptions, ScanResult, UndoResult, WorkdayExperienceExpansion } from '../shared/types';
import { eligibleForReviewedAnswer, isResumeField, localAnswer, matchRows } from './answers';
import { applyTarget, comboClearButton, committedWorkdayMonth, displayValue, prepare, restore, sameState, sameWorkdayMonth, snapshot, writeWorkdayDateParts, type Target } from './controls';
import { canLoadComboChoices, comboActivation, comboChoices, discover, fieldIdentity, greenhouseMultiSelect, inspectField, visible, words, workdayMonthDisplay, type Field } from './discovery';
import { detectPlatform } from './platforms';
import { isApplicationPrivacy } from './consent';
import type { QuestionMeaning } from '../shared/interpretation';
import type { VaultAnswer } from '../shared/vault';
import { eligibleForVault, validatedVaultAnswer, vaultContext, vaultMaxLength } from './vault';
import { eligibleForInterpretation, groundInterpretation, interpretationContext } from './interpretation';
import { changedField, focusScannedField } from './field-navigation';
import { associatedUploadGroup, attachmentFilename, hasAttachmentReceipt } from './file-upload';
import { answerWorkAuthorization, leverPostingLocation } from './work-authorization';
import { addWorkdayExperienceRows, addWorkdayRepeatRows, workdayExperienceGroup, workdayRepeatGroup, workdayWebsiteAnswers, type WorkdayExperienceGroup, type WorkdayRepeatGroup } from './workday-records';
import { workdayEducationRow, workdayExperienceRow, workdayExperienceRows, workdayRepeatRows, workdayWebsiteRow, workdayExperiencePageSelector, type WorkdayRepeatKind } from './workday-structure';
import { committedWorkdayDatePart, workdayDatePart, workdayDateSegments, workdayRequiredDateError } from './workday-date';
import { workdayTextFieldInput, workdayTextFieldLocation, type WorkdayTextFieldLocation } from './workday-text-fields';
import { workdayPrompt, workdayPromptMenu } from './workday-controls';

interface Checkpoint {
  field: Field;
  identity: string;
  comboIdentity?: string;
  state: ReturnType<typeof snapshot>;
  revision: number[];
  privacyAllowed?: boolean;
  jobLocation?: string;
  uploadGroup?: HTMLElement;
}

interface PlanEntry {
  preview: FieldPlan;
  before: Checkpoint;
  target?: Target;
  rowIdentities: Checkpoint[];
  workdayRows?: WorkdayRows;
  workdayText?: WorkdayTextLocation;
  workdayDate?: WorkdayDate;
  interpretation?: { context?: string };
  vault?: { context?: string; currentValues: Set<string>; maxLength: number };
}

interface WorkdayRows {
  group: Element;
  kind?: WorkdayRepeatKind;
  page: Element | null;
  form: Element | null;
  rows: ReturnType<typeof visibleWorkdayRows>;
  identities: Set<Checkpoint>;
}

function visibleWorkdayRows(group: Element, kind?: WorkdayRepeatKind) {
  return (kind ? workdayRepeatRows(group, kind) : workdayExperienceRows(group)).filter(({ row }) => visible(row));
}

interface PageLocation {
  url: string;
  topUrl?: string;
  form?: HTMLFormElement;
}

interface Plan extends PageLocation {
  id: string;
  entries: PlanEntry[];
  workdayExperience?: { id: string; formScopeId?: string; group: WorkdayExperienceGroup; profile: Profile };
  workdayRepeats?: { id: string; formScopeId?: string; group: WorkdayRepeatGroup; profile: Profile }[];
}

interface UndoEntry {
  initial: Checkpoint;
  applied: Checkpoint;
  pass: number;
  workdayText?: WorkdayTextLocation;
  workdayDate?: WorkdayDateUndo;
}

type WorkdayDate = NonNullable<ReturnType<typeof workdayDateSegments>>;

interface WorkdayDateUndo {
  date: WorkdayDate;
  checkpoints: Checkpoint[];
}

function sameWorkdayDate(date: WorkdayDate): boolean {
  const current = workdayDateSegments(date.month);
  return current?.group === date.group && current.month === date.month && current.year === date.year;
}

interface WorkdayExperienceTextLocation {
  kind: 'experience';
  group: WorkdayExperienceGroup;
  row: Element;
  ordinal: string;
  id: string;
  month: boolean;
}

type WorkdayTextLocation = WorkdayExperienceTextLocation | WorkdayTextFieldLocation;

const workdayTextId = /^workExperience-\d+--(?:companyName|jobTitle|location|(?:startDate|endDate)-dateSection(?:Month|Year)-input)$/;

function sameIdentity(a: Checkpoint, b: Checkpoint, allowChoiceChanges: boolean): boolean {
  if (a.jobLocation !== b.jobLocation || a.uploadGroup !== b.uploadGroup) return false;
  return allowChoiceChanges && a.comboIdentity !== undefined ? a.comboIdentity === b.comboIdentity : a.identity === b.identity;
}

function resumeAlternativeReason(field: Field): string | undefined {
  const alternate = field.resumeAlternative;
  if (!alternate || alternate.element.matches(':disabled')) return undefined;
  if (alternate.type === 'text') return alternate.element.value.trim() ? 'Resume already supplied as text.' : undefined;
  return alternate.element.files?.length ? 'Resume already supplied as a file.' : undefined;
}

function result(entries: FillEntry[], needsRescan: boolean, undoAvailable = false): FillResult {
  return {
    entries, needsRescan, undoAvailable,
    filled: entries.filter((entry) => entry.status === 'filled').length,
    skipped: entries.filter((entry) => entry.status === 'skipped').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
  };
}

export function createEngine(doc: Document, scopeOptions: { applicationForm?: () => HTMLFormElement | null } = {}) {
  const tokens = new Uint32Array(4);
  (doc.defaultView?.crypto ?? globalThis.crypto).getRandomValues(tokens);
  const namespace = [...tokens].map((token) => token.toString(16).padStart(8, '0')).join('');
  const ids = new WeakMap<Element, { id: string; identity: string; scope: Node; row?: Element }>();
  const scopeIds = new WeakMap<Node, string>();
  const revisions = new WeakMap<EventTarget, number>();
  const manualRevisions = new WeakMap<EventTarget, number>();
  const ownedInputEvents = new WeakSet<Event>();
  let sequence = 0;
  let editGeneration = 0;
  let writingField: Field | undefined;
  let autofillRun: (PageLocation & {
    marker: string;
    startRevision: number;
    overwriteStates: Map<string, ReturnType<typeof snapshot>>;
  }) | undefined;
  let vaultRun: (PageLocation & {
    marker: string;
    startRevision: number;
    initialFields: WeakMap<Element, { checkpoint: Checkpoint; blank: boolean }>;
  }) | undefined;
  let currentPlan: Plan | undefined;
  let activeFill: Plan | undefined;
  let latestUndo: (PageLocation & { scanId: string; entries: UndoEntry[]; initialFields: Set<Element> }) | undefined;
  let busy = false;

  function accessibleTopUrl(): string | undefined {
    try { return doc.defaultView?.top?.location.href; }
    catch { return undefined; }
  }

  function samePage(location: PageLocation): boolean {
    return location.url === doc.URL && (location.topUrl === undefined || location.topUrl === accessibleTopUrl())
      && (!scopeOptions.applicationForm || (!!location.form && location.form === applicationForm()));
  }

  function applicationForm(): HTMLFormElement | undefined {
    const form = scopeOptions.applicationForm?.();
    return form?.isConnected && form.ownerDocument === doc ? form : undefined;
  }

  function fieldInForm(field: Field, form: HTMLFormElement): boolean {
    if (field.scope !== form || (field.resumeAlternative && !form.contains(field.resumeAlternative.element))) return false;
    return [field.element, ...field.peers].every(element => {
      if (!form.contains(element) || ('form' in element && element.form !== form)) return false;
      const labels = (element as HTMLInputElement).labels;
      if (labels && Array.from(labels).some(label => !form.contains(label))) return false;
      const root = element.getRootNode() as Document | ShadowRoot;
      return ['aria-labelledby', 'aria-describedby'].every(attribute =>
        (element.getAttribute(attribute) ?? '').split(/\s+/).every(id => {
          const reference = id && root.getElementById(id);
          return !reference || form.contains(reference);
        }));
    });
  }

  function applicationFields(form = applicationForm()): Field[] {
    if (scopeOptions.applicationForm && !form) return [];
    const fields = discover(doc, form);
    return form ? fields.filter(field => fieldInForm(field, form)) : fields;
  }

  function edited(target: EventTarget) {
    revisions.set(target, ++editGeneration);
    if (target !== writingField?.element && !writingField?.peers.some(peer => peer === target)) {
      manualRevisions.set(target, editGeneration);
    }
  }

  function ownedWrite<T>(field: Field, write: () => T): T {
    const prior = writingField;
    writingField = field;
    try { return write(); }
    finally { writingField = prior; }
  }

  const onEdit = (event: Event) => {
    if (ownedInputEvents.delete(event)) return;
    const target = event.composedPath()[0] ?? event.target;
    if (target) edited(target);
  };
  doc.addEventListener('input', onEdit, { capture: true });
  doc.addEventListener('change', onEdit, { capture: true });
  doc.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const path = event.composedPath();
    const choice = path.find(node => node instanceof doc.defaultView!.HTMLElement
      && node.matches('button[type="button"]:is([role="checkbox"],[role="radio"]), button[aria-pressed]'));
    if (choice) edited(choice);

    // Custom popup choices and clear actions may change selection without input/change.
    const tracked = [
      ...[currentPlan, activeFill].flatMap(plan => plan?.entries.map(entry => entry.before.field) ?? []),
      ...(latestUndo?.entries.map(entry => entry.applied.field) ?? []),
    ];
    const touched = new Set<Element>();
    for (const field of tracked) {
      if (field.kind !== 'combobox' || touched.has(field.element) || !field.element.isConnected) continue;
      const activation = comboActivation(field.element);
      const clear = comboClearButton(field);
      const prompt = workdayPrompt(field.element);
      const menu = prompt && workdayPromptMenu(field.element, prompt);
      if (path.includes(field.element) || (activation && path.includes(activation)) || (clear && path.includes(clear))
        || (menu && path.includes(menu))
        || comboChoices(field.element).some(option => path.includes(option.element))) {
        touched.add(field.element);
        edited(field.element);
      }
    }
  }, { capture: true });

  function checkpoint(field: Field): Checkpoint {
    const authorization = answerWorkAuthorization(field.label);
    return {
      field, identity: fieldIdentity(field), state: snapshot(field),
      comboIdentity: field.kind === 'combobox' ? fieldIdentity(field, false) : undefined,
      revision: [field.element, ...field.peers].map((element) => revisions.get(element) ?? 0),
      jobLocation: authorization && !authorization.country ? leverPostingLocation(field.element) : undefined,
      uploadGroup: field.kind === 'file' ? associatedUploadGroup(field)?.element : undefined,
    };
  }

  function workdayTextElement(location: WorkdayTextLocation): HTMLInputElement | undefined {
    if (location.kind === 'field') return workdayTextFieldInput(location);
    const { group, id, ordinal, row } = location;
    if (!group.element.isConnected || group.element.closest('[data-automation-id="applyFlowMyExpPage"]') !== group.page
      || group.element.closest('form') !== group.form) return undefined;
    const matches = doc.querySelectorAll<HTMLInputElement>(`[id="${id}"]`);
    const input = matches[0];
    if (matches.length !== 1 || !input.matches('input:is(:not([type]), [type="text"])')
      || input.form !== group.form || (!group.form && input.hasAttribute('form'))) return undefined;
    const bound = workdayExperienceRow(input);
    return bound?.group === group.element && bound.row === row && bound.index === ordinal ? input : undefined;
  }

  function workdayTextLocation(field: Field, group?: WorkdayExperienceGroup): WorkdayTextLocation | undefined {
    if (field.kind === 'text' && field.trustedLabel && field.section !== 'employment') {
      const stableField = workdayTextFieldLocation(field.element);
      if (stableField) return stableField;
    }
    if (!group || field.kind !== 'text' || !field.trustedLabel || field.section !== 'employment'
      || !workdayTextId.test(field.element.id)) return undefined;
    const row = workdayExperienceRow(field.element);
    if (!row || row.group !== group.element || row.row !== field.row) return undefined;
    const location: WorkdayExperienceTextLocation = { kind: 'experience', group, row: row.row, ordinal: row.index, id: field.element.id, month: !!workdayMonthDisplay(field.element) };
    return workdayTextElement(location) === field.element ? location : undefined;
  }

  function committedWorkdayText(location: WorkdayTextLocation, before: Checkpoint, expected: string): Checkpoint | undefined {
    const original = before.field.element;
    const state = { kind: 'text' as const, value: expected };
    const observed = snapshot(before.field);
    const reachedOriginal = location.month && observed.kind === 'text'
      ? sameWorkdayMonth(observed.value, expected) : sameState(observed, state);
    // A matching ID alone cannot establish that the old input received this write.
    if (original.isConnected || (revisions.get(original) ?? 0) <= before.revision[0]
      || (manualRevisions.get(original) ?? 0) > before.revision[0] || !reachedOriginal) return undefined;
    const replacement = workdayTextElement(location);
    if (!replacement || manualRevisions.has(replacement)) return undefined;
    const live = inspectField(replacement);
    if (!live || live.blocked || live.scope !== before.field.scope || live.row !== before.field.row || live.peers.length) return undefined;
    const after = checkpoint(live);
    const retained = workdayDatePart(replacement) ? committedWorkdayDatePart(replacement, expected) : sameState(after.state, state);
    return sameIdentity(before, after, false) && retained ? after : undefined;
  }

  function unchanged(field: Field | undefined, saved: Checkpoint, allowChoiceChanges = false, expected = saved.state): field is Field {
    if (!field || field.element !== saved.field.element || field.scope !== saved.field.scope || field.row !== saved.field.row
      || (field.blocked && !(saved.privacyAllowed && isApplicationPrivacy(field)))) return false;
    if (scopeOptions.applicationForm) {
      const form = applicationForm();
      if (!form || !fieldInForm(field, form)) return false;
    }
    if (field.peers.length !== saved.field.peers.length || field.peers.some((peer, i) => peer !== saved.field.peers[i])) return false;
    const live = checkpoint(field);
    return sameIdentity(saved, live, allowChoiceChanges) && sameState(live.state, expected)
      && live.revision.every((revision, i) => revision === saved.revision[i]);
  }

  function dateUnchanged(date: WorkdayDate, checkpoints: Checkpoint[]): boolean {
    return sameWorkdayDate(date) && checkpoints.every(saved => unchanged(inspectField(saved.field.element), saved));
  }

  function idFor(field: Field, identity: string): string {
    const prior = ids.get(field.element);
    if (prior?.identity === identity && prior.scope === field.scope && prior.row === field.row) return prior.id;
    const id = namespace + '-field-' + ++sequence;
    ids.set(field.element, { id, identity, scope: field.scope, row: field.row });
    return id;
  }

  function ownedWriteCheckpoint(saved: Checkpoint, manualRevision: number | undefined): Checkpoint | undefined {
    const { element, peers } = saved.field;
    if (peers.length || manualRevisions.get(element) !== manualRevision) return undefined;
    return { ...saved, revision: [revisions.get(element) ?? 0] };
  }

  function scopeIdFor(scope: Node): string {
    const existing = scopeIds.get(scope);
    if (existing) return existing;
    const id = namespace + '-scope-' + ++sequence;
    scopeIds.set(scope, id);
    return id;
  }

  async function scan(saved: Profile, options: ScanOptions = {}): Promise<ScanResult> {
    // Resolve any late-rendered choices from the same facts used in the preview.
    const { resume, ...facts } = saved;
    const profile = structuredClone(facts);
    const form = applicationForm();
    const marker = options.autofillRun;
    const firstRunScan = !!marker && (autofillRun?.marker !== marker || !samePage(autofillRun));
    if (firstRunScan) {
      autofillRun = { marker, startRevision: editGeneration, overwriteStates: new Map(), url: doc.URL, topUrl: accessibleTopUrl(), form };
    }
    const run = marker ? autofillRun : undefined;
    const overwriteFieldIds = new Set(options.overwriteFieldIds);
    if (!options.vaultRun) vaultRun = undefined;
    else if (vaultRun?.marker !== options.vaultRun || !samePage(vaultRun)) {
      vaultRun = {
        marker: options.vaultRun, url: doc.URL, topUrl: accessibleTopUrl(), form,
        startRevision: editGeneration, initialFields: new WeakMap(),
      };
    }
    const fields = applicationFields(form);
    const experienceGroup = scopeOptions.applicationForm ? undefined : workdayExperienceGroup(doc);
    let workdayExperience: Plan['workdayExperience'];
    if (experienceGroup) {
      workdayExperience = {
        id: scopeIdFor(experienceGroup.element), group: experienceGroup, profile,
        formScopeId: experienceGroup.form ? scopeIdFor(experienceGroup.form) : undefined,
      };
    }
    const workdayRepeats = scopeOptions.applicationForm ? [] : (['education', 'websites'] as const).flatMap(kind => {
      const group = workdayRepeatGroup(doc, kind);
      return group ? [{ id: [scopeIdFor(group.element), scopeIdFor(group.page), group.form ? scopeIdFor(group.form) : 'document'].join('/'), group, profile,
        formScopeId: group.form ? scopeIdFor(group.form) : undefined }] : [];
    });
    const websiteAnswers = workdayWebsiteAnswers(fields, profile, displayValue);
    const rows = matchRows(fields, profile, displayValue);
    const snapshots = new Map(fields.map((field) => [field, checkpoint(field)]));
    const workdayRowByField = new Map(fields.flatMap(field => {
      const experienceRow = field.section === 'employment' && workdayExperienceRow(field.element);
      const educationRow = field.section === 'education' && workdayEducationRow(field.element);
      const websiteRow = workdayWebsiteRow(field.element);
      const bound = experienceRow || educationRow || websiteRow;
      return bound ? [[field, { ...bound, kind: educationRow ? 'education' as const : websiteRow ? 'websites' as const : undefined }] as const] : [];
    }));
    const workdayRowsByGroup = new Map<Element, WorkdayRows>();
    for (const [field, { group, kind }] of workdayRowByField) {
      let inventory = workdayRowsByGroup.get(group);
      if (!inventory) {
        inventory = { group, kind, page: group.closest(workdayExperiencePageSelector), form: group.closest('form'), rows: visibleWorkdayRows(group, kind), identities: new Set() };
        workdayRowsByGroup.set(group, inventory);
      }
      for (const identity of (kind === 'websites' ? [field] : rows.get(field)?.identities ?? [])) inventory.identities.add(snapshots.get(identity)!);
    }
    const currentValues = new Set<string>();
    for (const { field, state } of snapshots.values()) {
      const texts = [displayValue(field, state)];
      if (Array.isArray(state.value) && state.kind !== 'file') {
        const selected = state.value;
        texts.push(...field.choices.filter(choice => selected.includes(choice.element)).map(choice => choice.label));
      }
      for (const text of texts) {
        if (text && text.length <= 1_000) {
          const normalized = words(text);
          if (normalized && !/^(?:yes|no|true|false|checked|unchecked)$/.test(normalized)) currentValues.add(normalized);
        }
      }
    }
    const entries = fields.map((field): PlanEntry => {
      const before = snapshots.get(field)!;
      const current = displayValue(field, before.state);
      const initialVaultField = vaultRun?.initialFields.get(field.element);
      if (!initialVaultField) vaultRun?.initialFields.set(field.element, { checkpoint: before, blank: !current });
      const privacyAllowed = profile.applicationDefaults?.acceptApplicationPrivacy === true && isApplicationPrivacy(field);
      before.privacyAllowed = privacyAllowed;
      const id = idFor(field, before.comboIdentity ?? before.identity);
      const preview: FieldPlan = {
        id, label: field.label, kind: field.kind, required: field.required, status: 'unanswered', aiEligible: false,
      };
      preview.scopeId = scopeIdFor(field.scope);
      preview.scopeType = field.scope.nodeType === Node.ELEMENT_NODE ? 'form' : 'document';
      const row = rows.get(field);
      const rowIdentities = row?.identities.map(identity => snapshots.get(identity)!) ?? [];
      const experience = workdayRowByField.get(field);
      const entry: PlanEntry = { preview, before, rowIdentities, workdayRows: experience && workdayRowsByGroup.get(experience.group),
        workdayText: workdayTextLocation(field, workdayExperience?.group), workdayDate: workdayDateSegments(field.element) };

      if (field.section) {
        preview.section = field.section === 'employment' ? 'Employment' : 'Education';
        if (field.rowIndex !== undefined) preview.section += ' · ' + field.rowIndex;
        const groupLabel = field.row?.querySelector(':scope > legend')?.textContent?.trim();
        if (groupLabel) preview.section = groupLabel;
      }
      if (workdayExperience && experience && experience.group === workdayExperience.group.element && experience.row === field.row) {
        preview.workdayExperienceGroupId = workdayExperience.id;
        preview.section = 'Employment · ' + experience.index;
      }
      const repeated = experience?.kind && workdayRepeats.find(item => item.group.element === experience.group);
      if (repeated) {
        preview.workdayRepeatGroupId = repeated.id;
        preview.section = (repeated.group.kind === 'education' ? 'Education' : 'Websites') + ' · ' + experience!.index;
      }
      if (field.blocked && !privacyAllowed) {
        const hasValue = !!displayValue(field, before.state).trim();
        preview.status = hasValue ? 'preserved' : 'unsupported';
        preview.sensitive = true;
        preview.reason = hasValue ? 'The field already has a value.' : 'Complete credential, signature, or consent fields yourself.';
        return entry;
      }

      if (field.unsupportedReason) {
        preview.status = 'unsupported';
        preview.reason = field.unsupportedReason;
        return entry;
      }

      if (run && [field.element, ...field.peers].some(element => (manualRevisions.get(element) ?? 0) > run.startRevision)) {
        preview.status = 'preserved';
        if (current) preview.currentValue = current;
        preview.reason = 'You edited this field during Autofill.';
        return entry;
      }

      const local = privacyAllowed ? { answer: 'Yes', sensitive: true }
        : experience?.kind === 'websites' ? { answer: websiteAnswers.get(field), sensitive: false }
        : localAnswer(field, profile, row);
      if (local.sensitive) preview.sensitive = true;
      if (field.choices.length) preview.options = field.choices.map(({ label }) => label);
      const alternateResume = resumeAlternativeReason(field);
      if (alternateResume || (field.resumeAlternative?.type === 'file' && current.trim())) {
        preview.status = 'preserved';
        preview.reason = alternateResume ?? 'Resume already supplied as text.';
        return entry;
      }
      if (current) preview.currentValue = current;
      const skills = workdaySkillsWidget(field.element);
      const skillSelections = skills && workdaySkillSelections(skills);
      const missingSkills = skills && skillSelections && profile.skills?.some(skill => !skillSelections.some(item => workdaySkillKey(item.label) === workdaySkillKey(skill)));
      const greenhouseMulti = field.kind === 'combobox' && field.multiple && !!greenhouseMultiSelect(field.element);
      const originalOverwriteState = overwriteFieldIds.has(id) ? run?.overwriteStates.get(id) : undefined;
      const mayOverwrite = options.overwriteExisting || (originalOverwriteState && sameState(before.state, originalOverwriteState));
      const datePart = workdayDatePart(field.element);
      const repairDate = !!current && !!datePart && !!workdayRequiredDateError(field.element)
        && fields.filter(candidate => workdayDatePart(candidate.element)?.group === datePart.group).every(candidate => {
          const savedDate = localAnswer(candidate, profile, rows.get(candidate)).answer;
          return typeof savedDate === 'string' && committedWorkdayDatePart(candidate.element, savedDate);
        });
      if (current && !repairDate && !missingSkills && (!mayOverwrite || greenhouseMulti || experience?.kind === 'websites' || before.state.kind === 'file-receipt')) {
        preview.status = 'preserved';
        preview.reason = 'The field already has a value.';
        return entry;
      }
      if (local.conflict) {
        preview.reason = 'Profile answers conflict for this question.';
        return entry;
      }
      if (field.kind === 'file' && !isResumeField(field)) {
        preview.status = 'unsupported';
        preview.reason = 'Only clearly identified resume attachments can be filled.';
        return entry;
      }
      if (field.kind === 'combobox' && ((field.multiple && !greenhouseMulti && !skills) || (!skills && !field.choices.length && !canLoadComboChoices(field)))) {
        preview.status = 'unsupported';
        preview.reason = 'The combobox has no supported, discoverable options.';
        return entry;
      }

      const aiEligible = !greenhouseMulti && local.answer === undefined && eligibleForReviewedAnswer(field);
      const reviewed = aiEligible && options.reviewedAnswers && Object.hasOwn(options.reviewedAnswers, id)
        ? options.reviewedAnswers[id] : undefined;
      const answer = local.answer ?? (typeof reviewed === 'string' ? reviewed : undefined);
      const resolveAnswer = field.kind === 'combobox' && !privacyAllowed && local.answer !== undefined
        ? (loaded: Field) => {
          const resolved = localAnswer(loaded, profile, row);
          return resolved.conflict ? undefined : resolved.answer;
        } : undefined;
      const matching = typeof reviewed === 'string' ? 'visible' : ('semantic' in local ? local.semantic ?? false : false);
      const prepared = prepare(field, answer, field.kind === 'file' && !local.sensitive ? resume : undefined,
        matching, resolveAnswer, 'choiceRank' in local ? local.choiceRank : undefined, 'schoolSearch' in local ? local.schoolSearch : undefined);
      if (prepared.target !== undefined) {
        preview.status = 'ready';
        preview.answerSource = typeof reviewed === 'string' ? 'reviewed' : 'profile';
        preview.value = prepared.value;
        if (prepared.reason) preview.reason = prepared.reason;
        entry.target = prepared.target;
        if (firstRunScan && options.overwriteExisting && current) run?.overwriteStates.set(id, before.state);
      } else if (!field.trustedLabel && local.answer === undefined && field.kind !== 'file') {
        preview.status = 'unsupported';
        preview.reason = 'The field has no identifiable question.';
      } else {
        preview.aiEligible = aiEligible;
        if (!greenhouseMulti && local.answer === undefined) {
          const context = interpretationContext(field, currentValues);
          if (eligibleForInterpretation(field, currentValues, context)) {
            entry.interpretation = { context };
            preview.interpretationEligible = true;
            if (context) preview.interpretationContext = context;
          }
          const startRevision = vaultRun?.startRevision;
          const vaultUnedited = (startRevision === undefined || before.revision.every(revision => revision <= startRevision))
            && (!initialVaultField || (initialVaultField.blank && unchanged(field, initialVaultField.checkpoint)));
          if (!current && !local.sensitive && !preview.interpretationEligible && vaultUnedited && eligibleForVault(field, currentValues)) {
            const maxLength = vaultMaxLength(field);
            const context = vaultContext(field, currentValues);
            entry.vault = { context, currentValues, maxLength };
            preview.vaultEligible = true;
            preview.maxLength = maxLength;
            if (context) preview.vaultContext = context;
          }
        }
        preview.reason = prepared.reason ?? (local.sensitive ? 'Save an exact answer for this sensitive question or complete it yourself.'
          : field.kind === 'file' ? 'Add a resume to your profile first.'
          : field.section && !row?.record ? 'There is no matching profile record for this row.'
          : 'There is no matching answer in your profile.');
      }
      return entry;
    });

    const url = doc.URL;
    const id = namespace + '-scan-' + ++sequence;
    currentPlan = { id, url, topUrl: accessibleTopUrl(), form, entries, workdayExperience, workdayRepeats };
    return scanResult(currentPlan);
  }

  function scanResult(plan: Plan): ScanResult {
    return {
      scanId: plan.id, platform: detectPlatform(doc), frameUrl: plan.url,
      fields: plan.entries.map(({ preview }) => preview),
      warnings: plan.entries.length ? [] : ['No editable application fields are visible on this page.'],
      ...(plan.workdayRepeats?.length ? { workdayRepeatGroups: plan.workdayRepeats.map(item => ({
        id: item.id, kind: item.group.kind, ...(item.formScopeId ? { formScopeId: item.formScopeId } : {}),
      })) } : {}),
      ...(plan.workdayExperience ? { workdayExperienceGroupId: plan.workdayExperience.id } : {}),
      ...(plan.workdayExperience?.formScopeId ? { workdayExperienceFormScopeId: plan.workdayExperience.formScopeId } : {}),
    };
  }

  async function expandWorkdayExperience(scanId: string, expectedGroupId: string): Promise<WorkdayExperienceExpansion> {
    const plan = currentPlan;
    const experience = plan?.workdayExperience;
    if (busy || !plan || !experience || plan.id !== scanId || experience.id !== expectedGroupId || !samePage(plan)) {
      return { added: 0, needsRescan: false };
    }
    busy = true;
    try {
      const expansion = await addWorkdayExperienceRows(experience.group, experience.profile,
        () => samePage(plan) && currentPlan === plan);
      if (expansion.needsRescan && currentPlan === plan) currentPlan = undefined;
      return expansion;
    } finally {
      busy = false;
    }
  }

  async function expandWorkdayRepeat(scanId: string, expectedGroupId: string): Promise<WorkdayExperienceExpansion> {
    const plan = currentPlan;
    const repeat = plan?.workdayRepeats?.find(item => item.id === expectedGroupId);
    if (busy || !plan || !repeat || plan.id !== scanId || !samePage(plan)) return { added: 0, needsRescan: false };
    busy = true;
    try {
      const expansion = await addWorkdayRepeatRows(repeat.group, repeat.profile, () => samePage(plan) && currentPlan === plan);
      if (expansion.needsRescan && currentPlan === plan) currentPlan = undefined;
      return expansion;
    } finally { busy = false; }
  }

  async function interpret(scanId: string, profile: Profile, meanings: QuestionMeaning[]): Promise<ScanResult | undefined> {
    const plan = currentPlan;
    if (busy || !plan || plan.id !== scanId || !samePage(plan)) return undefined;
    const byId = new Map<string, QuestionMeaning | undefined>();
    for (const meaning of meanings) {
      if (meaning && typeof meaning.fieldId === 'string') byId.set(meaning.fieldId, byId.has(meaning.fieldId) ? undefined : meaning);
    }
    for (const entry of plan.entries) {
      const { preview, before, interpretation } = entry;
      if (entry.target !== undefined || preview.status !== 'unanswered' || !interpretation) continue;
      const meaning = byId.get(preview.id);
      if (!meaning) continue;
      const live = inspectField(before.field.element);
      if (!unchanged(live, before)) continue;
      const grounded = groundInterpretation(live, profile, meaning, interpretation.context);
      if (!grounded) continue;
      const prepared = prepare(live, grounded.answer, undefined, grounded.semantic);
      if (prepared.target === undefined) continue;
      entry.preview = {
        ...preview, status: 'ready', value: prepared.value, reason: prepared.reason, aiEligible: false,
        interpretationEligible: false, vaultEligible: false, answerSource: 'interpreted',
      };
      entry.target = prepared.target;
    }
    return scanResult(plan);
  }

  function sameVaultQuestion(field: Field, vault: NonNullable<PlanEntry['vault']>): boolean {
    return eligibleForVault(field, vault.currentValues) && vault.maxLength === vaultMaxLength(field)
      && vault.context === vaultContext(field, vault.currentValues);
  }

  async function stageVaultAnswers(scanId: string, answers: VaultAnswer[]): Promise<ScanResult | undefined> {
    const plan = currentPlan;
    if (busy || !plan || plan.id !== scanId || !samePage(plan)) return undefined;
    const byId = new Map<string, VaultAnswer | undefined>();
    for (const answer of answers) {
      if (answer && typeof answer.fieldId === 'string') byId.set(answer.fieldId, byId.has(answer.fieldId) ? undefined : answer);
    }
    for (const entry of plan.entries) {
      const { preview, before, rowIdentities, vault } = entry;
      const candidate = byId.get(preview.id);
      if (!candidate || !vault || entry.target !== undefined || preview.status !== 'unanswered') continue;
      const answer = validatedVaultAnswer(candidate, vault.maxLength);
      if (!answer) continue;
      const live = inspectField(before.field.element);
      if (!unchanged(live, before) || displayValue(live, snapshot(live)) || !sameVaultQuestion(live, vault)
        || rowIdentities.some(identity => !unchanged(inspectField(identity.field.element), identity))) continue;
      const prepared = prepare(live, answer);
      if (prepared.target === undefined) continue;
      entry.preview = {
        ...preview, status: 'ready', value: prepared.value, reason: prepared.reason, aiEligible: false,
        interpretationEligible: false, vaultEligible: false, answerSource: 'vault',
      };
      entry.target = prepared.target;
    }
    return scanResult(plan);
  }

  async function fill(scanId: string, fieldIds?: string[], appendUndoTo?: string): Promise<FillResult> {
    const pending = currentPlan;
    if (busy || !pending || pending.id !== scanId || !samePage(pending)) return result([], true);
    const plan = pending;
    currentPlan = undefined;
    const selected = fieldIds === undefined ? undefined : new Set(fieldIds);
    const preceding = latestUndo && samePage(latestUndo) ? latestUndo : undefined;
    const prior = appendUndoTo && preceding?.scanId === appendUndoTo ? preceding : undefined;
    if (appendUndoTo && !prior) return result(plan.entries.filter(entry => entry.target !== undefined && (!selected || selected.has(entry.preview.id))).map(({ preview }) => ({
      id: preview.id, label: preview.label, status: 'skipped', reason: 'Another fill changed this application. Click Autofill again to review the remaining fields.',
    })), true);
    const pass = prior ? Math.max(...prior.entries.map(entry => entry.pass)) + 1 : 0;
    const entries: FillEntry[] = [];
    const applied: UndoEntry[] = [];
    const updatedRows = new Map<Element, Checkpoint>();
    const byElement = new Map(plan.entries.map(entry => [entry.before.field.element, entry]));
    const handledDates = new Set<Element>();
    const fieldChanged = 'The field changed after the preview. Scan again to review it.';
    let undoAvailable = false;

    function rowUnchanged(entry: PlanEntry, expected?: ReturnType<typeof snapshot>, replacement?: Checkpoint, paired?: ReadonlySet<Element>) {
      const { before, rowIdentities, workdayRows } = entry;
      if (workdayRows) {
        if (workdayRows.group.closest(workdayExperiencePageSelector) !== workdayRows.page || workdayRows.group.closest('form') !== workdayRows.form) return false;
        // A populated sibling can claim a saved job planned for this row. Preserve the original allocation only
        // while the group and its identity fields still agree with the scan or subsequent engine-owned writes.
        const current = visibleWorkdayRows(workdayRows.group, workdayRows.kind);
        if (current.length !== workdayRows.rows.length || current.some(({ row, index }, i) =>
          row !== workdayRows.rows[i].row || index !== workdayRows.rows[i].index)) return false;
      }
      for (const identity of workdayRows?.identities ?? rowIdentities) {
        const ownField = identity.field.element === before.field.element;
        // The paired writer revalidates the other segment through its own checkpoint and revision.
        if (!ownField && paired?.has(identity.field.element)) continue;
        const row = (ownField ? replacement : undefined) ?? updatedRows.get(identity.field.element) ?? identity;
        if (!unchanged(inspectField(row.field.element), row, before.field.kind === 'combobox' && ownField,
          ownField ? expected : undefined)) return false;
      }
      return true;
    }

    function fillUnchanged(entry: PlanEntry, live: Field | undefined, expected?: ReturnType<typeof snapshot>,
      replacement?: Checkpoint, paired?: ReadonlySet<Element>): live is Field {
      const { before, preview, workdayText, vault } = entry;
      return samePage(plan) && unchanged(live, replacement ?? before, before.field.kind === 'combobox', expected)
        && rowUnchanged(entry, expected, replacement, paired)
        && (preview.answerSource !== 'vault' || (!!vault && sameVaultQuestion(live, vault)))
        && (!workdayText || workdayTextElement(workdayText) === live.element);
    }

    async function fillDate(date: WorkdayDate) {
      const dateParts = [byElement.get(date.month), byElement.get(date.year)].filter(entry => entry !== undefined);
      const targets = dateParts.filter(entry => entry.target !== undefined && (!selected || selected.has(entry.preview.id)));
      const report = (status: FillEntry['status'], reason?: string) => {
        for (const { preview } of targets) entries.push({ id: preview.id, label: preview.label, status, reason });
      };
      if (dateParts.length !== 2 || !sameWorkdayDate(date) || dateParts.some(entry => !fillUnchanged(entry, inspectField(entry.before.field.element)))) {
        report('skipped', fieldChanged);
        return;
      }
      const retained = dateParts.filter(entry => !targets.includes(entry));
      if (targets.some(({ target }) => typeof target === 'string' && target)
        && retained.some(({ before }) => before.state.kind === 'text' && !before.state.value)) {
        report('skipped', 'Select both Workday date segments to fill this date.');
        return;
      }
      const paired = new Set(targets.map(entry => entry.before.field.element));
      const retainedUnchanged = () => sameWorkdayDate(date)
        && retained.every(entry => fillUnchanged(entry, inspectField(entry.before.field.element), undefined, undefined, paired));
      try {
        const edits = targets.flatMap(entry => {
          const { before, target } = entry;
          if (typeof target !== 'string') return [];
          const { field } = before;
          const manualRevision = manualRevisions.get(field.element);
          return [{
            field, value: target,
            revalidate: (expected?: ReturnType<typeof snapshot>, afterOwnedWrite?: true) => {
              const original = afterOwnedWrite ? ownedWriteCheckpoint(before, manualRevision) : before;
              return !!original && retainedUnchanged()
                && fillUnchanged(entry, inspectField(field.element), expected, afterOwnedWrite ? original : undefined, paired);
            },
            ownMutation: (write: () => void) => ownedWrite(field, write),
          }];
        });
        const written = edits.length === targets.length ? await writeWorkdayDateParts(edits) : undefined;
        if (!written || !samePage(plan) || !retainedUnchanged()) {
          report('failed', 'The page did not retain the planned Workday date.');
          return;
        }
        const after = targets.map(({ before }, index) => {
          const live = inspectField(before.field.element);
          if (!live || !edits[index].revalidate(written[index], true)) return undefined;
          return checkpoint(live);
        });
        if (!after.every(check => check !== undefined)) {
          report('failed', 'The page changed the Workday date while applying the answer.');
          return;
        }
        const workdayDate = { date, checkpoints: [...after, ...retained.map(entry => entry.before)] };
        targets.forEach(({ before, workdayText }, index) => {
          const committed = after[index];
          if (!sameState(before.state, committed.state)) {
            undoAvailable = true;
            applied.push({ initial: before, applied: committed, pass, workdayText, workdayDate });
          }
          updatedRows.set(before.field.element, committed);
        });
        report('filled');
      } catch (error) {
        report('failed', error instanceof Error ? error.message : 'The page could not accept the Workday date.');
      }
    }

    busy = true;
    activeFill = plan;
    try {
      for (const entry of plan.entries) {
        const { preview, before, target, workdayText, workdayDate } = entry;
        if (selected && !selected.has(preview.id)) continue;
        if (target === undefined && !selected) continue;
        const info = { id: preview.id, label: preview.label };
        if (target === undefined) {
          entries.push({ ...info, status: 'skipped', reason: preview.reason });
          continue;
        }
        if (workdayDate) {
          if (!handledDates.has(workdayDate.group)) {
            handledDates.add(workdayDate.group);
            await fillDate(workdayDate);
          }
          continue;
        }
        const live = inspectField(before.field.element);
        if (!fillUnchanged(entry, live) || workdayDateSegments(live.element)) {
          entries.push({ ...info, status: 'skipped', reason: fieldChanged });
          continue;
        }
        const alternateResume = resumeAlternativeReason(live);
        if (alternateResume) {
          entries.push({ ...info, status: 'skipped', reason: alternateResume });
          continue;
        }
        try {
          const manualRevision = manualRevisions.get(live.element);
          const revalidate = (expected?: ReturnType<typeof snapshot>, afterOwnedWrite?: true) => {
            const fresh = inspectField(live.element);
            const original = afterOwnedWrite ? ownedWriteCheckpoint(before, manualRevision) : before;
            return !!original && fillUnchanged(entry, fresh, expected, afterOwnedWrite ? original : undefined);
          };
          const ownWrite = <T>(write: () => T) => ownedWrite(live, write);
          const observed = await ownWrite(() => applyTarget(live, target, before.state, revalidate, event => ownedInputEvents.add(event), ownWrite));
          const replacement = workdayText && typeof target === 'string' && samePage(plan)
            ? committedWorkdayText(workdayText, before, target) : undefined;
          const adopted = replacement && rowUnchanged(entry, undefined, replacement) ? replacement : undefined;
          const written = adopted?.state ?? observed;
          if (!written || !samePage(plan)) {
            entries.push({ ...info, status: 'failed', reason: 'The page did not retain the planned answer.' });
            continue;
          }
          if (written.kind === 'file-receipt') {
            // Remember the attachment for the Undo report without treating it as a restorable input.
            applied.push({ initial: before, applied: { ...before, state: written }, pass });
            entries.push({ ...info, status: 'filled' });
            continue;
          }
          const liveAfter = adopted?.field ?? inspectField(live.element);
          if (!liveAfter || (liveAfter.blocked && !(before.privacyAllowed && isApplicationPrivacy(liveAfter))) || !sameState(snapshot(liveAfter), written)
            || (workdayText && workdayTextElement(workdayText) !== liveAfter.element)) {
            entries.push({ ...info, status: 'failed', reason: 'The page changed the field while applying the answer.' });
            continue;
          }
          const after = adopted ?? checkpoint(liveAfter);
          after.privacyAllowed = before.privacyAllowed;
          if (written.kind === 'text' && written.greenhousePhone) after.state = written;
          if (!sameState(before.state, after.state)) {
            undoAvailable = true;
            applied.push({ initial: before, applied: after, pass, workdayText });
          }
          updatedRows.set(live.element, after);
          entries.push({ ...info, status: 'filled' });
        } catch (error) {
          entries.push({ ...info, status: 'failed', reason: error instanceof Error ? error.message : 'The page could not accept the answer.' });
        }
      }
    } finally {
      busy = false;
      activeFill = undefined;
      if (applied.length) {
        const base = prior ?? (!undoAvailable ? preceding : undefined);
        const kept = base?.entries ?? preceding?.entries.filter(entry => entry.applied.state.kind === 'file-receipt')
          .map(entry => ({ ...entry, pass: 0 })) ?? [];
        latestUndo = {
          scanId: undoAvailable ? plan.id : base?.scanId ?? plan.id, url: plan.url, topUrl: plan.topUrl, form: plan.form,
          entries: [...kept, ...applied], initialFields: base?.initialFields ?? new Set(plan.entries.map(entry => entry.before.field.element)),
        };
      }
    }
    return result(entries, true, undoAvailable);
  }

  async function undo(expectedScanId?: string): Promise<UndoResult> {
    if (busy) return { restored: 0, skipped: 0, warning: 'Autofill is still running. Try Undo again when it finishes.' };
    const pending = latestUndo;
    if (!pending || (expectedScanId !== undefined && expectedScanId !== pending.scanId)) return { restored: 0, skipped: 0 };
    const batch = pending;
    latestUndo = undefined;
    busy = true;
    let restored = 0;
    let skipped = 0;
    // An edited answer or site-managed attachment revealed on a later pass
    // can still depend on an earlier field staying filled.
    let preserveBeforePass = Math.max(0, ...batch.entries.filter(({ pass, initial, applied, workdayText, workdayDate }) => {
      if (pass === 0) return false;
      if (applied.state.kind === 'file-receipt') return !!attachmentFilename(applied.state.group);
      return !unchanged(inspectField(applied.field.element), applied, initial.field.kind === 'combobox')
        || !!(workdayText && workdayTextElement(workdayText) !== applied.field.element)
        || !!(workdayDate && !dateUnchanged(workdayDate.date, workdayDate.checkpoints));
    }).map(entry => entry.pass));
    const written = new Set(batch.entries.map(entry => entry.applied.field.element));
    const scopes = new Set(batch.entries.map(entry => entry.initial.field.scope));
    const attachments = batch.entries.flatMap(({ applied }) => applied.state.kind === 'file-receipt' ? [applied.state] : []);
    if (applicationFields().some(field => {
      if (!scopes.has(field.scope) || batch.initialFields.has(field.element) || written.has(field.element)) return false;
      const state = snapshot(field);
      if (state.kind === 'file-receipt' && attachments.some(attachment => sameState(attachment, state))) return false;
      return !!displayValue(field, state).trim();
    })) preserveBeforePass = Infinity;

    const handledDates = new Set<WorkdayDateUndo>();
    async function undoDate(group: WorkdayDateUndo, parts: UndoEntry[]): Promise<boolean> {
      if (!samePage(batch) || !dateUnchanged(group.date, group.checkpoints)) return false;
      const changed = new Set(parts.map(({ applied }) => applied.field.element));
      const retained = group.checkpoints.filter(({ field }) => !changed.has(field.element));
      const edits = parts.flatMap(({ initial, applied, workdayText }) => {
        if (initial.state.kind !== 'text' || !sameIdentity(initial, applied, false) || initial.field.row !== applied.field.row) return [];
        const { field } = applied;
        const manualRevision = manualRevisions.get(field.element);
        return [{
          field, value: initial.state.value,
          revalidate: (expected?: ReturnType<typeof snapshot>, afterOwnedWrite?: true) => {
            const saved = afterOwnedWrite ? ownedWriteCheckpoint(applied, manualRevision) : applied;
            return !!saved && samePage(batch) && dateUnchanged(group.date, retained)
              && unchanged(inspectField(field.element), saved, false, expected)
              && (!workdayText || workdayTextElement(workdayText) === field.element);
          },
          ownMutation: (write: () => void) => ownedWrite(field, write),
        }];
      });
      if (edits.length !== parts.length) return false;
      try {
        const states = await writeWorkdayDateParts(edits);
        return !!states && edits.every((edit, index) => edit.revalidate(states[index], true));
      } catch {
        return false;
      }
    }

    try {
      for (const entry of batch.entries.slice().reverse()) {
        const { initial, applied, workdayText, workdayDate } = entry;
        if (applied.state.kind === 'file-receipt') {
          if (hasAttachmentReceipt(applied.state.group, applied.state.value)) skipped++;
          continue;
        }
        if (workdayDate) {
          if (handledDates.has(workdayDate)) continue;
          handledDates.add(workdayDate);
          const parts = batch.entries.filter(part => part.workdayDate === workdayDate);
          if (entry.pass >= preserveBeforePass && await undoDate(workdayDate, parts)) restored += parts.length;
          else {
            skipped += parts.length;
            preserveBeforePass = Math.max(preserveBeforePass, entry.pass);
          }
          continue;
        }
        const combo = initial.field.kind === 'combobox';
        const field = inspectField(applied.field.element);
        if (entry.pass < preserveBeforePass || !samePage(batch) || !unchanged(field, applied, combo)
          || !sameIdentity(initial, applied, combo) || initial.field.row !== applied.field.row
          || workdayDateSegments(field.element)
          || (workdayText && workdayTextElement(workdayText) !== field.element)) {
          skipped++;
          continue;
        }
        try {
          const manualRevision = manualRevisions.get(field.element);
          const revalidate = (expected?: ReturnType<typeof snapshot>, afterOwnedWrite?: true) => {
            const original = afterOwnedWrite ? ownedWriteCheckpoint(applied, manualRevision) : applied;
            return !!original && samePage(batch) && unchanged(inspectField(field.element), original, combo, expected)
              && (!workdayText || workdayTextElement(workdayText) === field.element);
          };
          const ownWrite = <T>(write: () => T) => ownedWrite(field, write);
          const observed = await ownWrite(() => restore(field, initial.field, initial.state, applied.state, revalidate, ownWrite));
          const retained = workdayText && initial.state.kind === 'text' && samePage(batch)
            && committedWorkdayText(workdayText, applied, initial.state.value);
          if ((observed && (!workdayText || workdayTextElement(workdayText) === field.element)) || retained) restored++;
          else { skipped++; preserveBeforePass = Math.max(preserveBeforePass, entry.pass); }
        } catch {
          skipped++;
          preserveBeforePass = Math.max(preserveBeforePass, entry.pass);
        }
      }
    } finally {
      busy = false;
    }
    return { restored, skipped };
  }

  function focus(fieldId: string) {
    if (busy) return { focused: false, reason: 'Autofill is still running. Try again when it finishes.' };
    const plan = currentPlan;
    if (!plan || !samePage(plan)) return changedField();
    const entry = plan.entries.find(({ preview }) => preview.id === fieldId);
    if (!entry) return changedField();
    if (plan.form) {
      const live = inspectField(entry.before.field.element);
      if (!live || !fieldInForm(live, plan.form)) return changedField();
    }
    return focusScannedField(doc, entry.before.field);
  }

  return { scan, fill, undo, interpret, stageVaultAnswers, focus, expandWorkdayExperience, expandWorkdayRepeat };
}
