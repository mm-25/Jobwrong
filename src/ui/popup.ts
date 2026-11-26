import type { AISettings, FieldPlan, FrameScan, Profile } from '../shared/types';
import { MAX_APPLICATION_NOTES_LENGTH, MAX_DRAFT_LENGTH, requestAIPermission, suggestAnswers } from '../services/ai';
import { fillActiveTab, openOptions, scanActiveTab, undoActiveTab } from '../services/browser';
import { loadAISettings, loadProfile } from '../services/storage';
import { byId, element, errorMessage, showNotice } from './dom';
import { activePageJob, focusPageField } from '../services/jobs';
import { extensionAPI } from '../services/extension-api';
import { VAULT_CHANNEL, type VaultSourcesResult } from '../shared/vault';

type FieldRef = { frame: FrameScan; field: FieldPlan; key: string };
type ReviewRow = { target: FieldRef; answer: string; checked: boolean };
type ApprovedAnswers = Record<number, Record<string, string>>;

const status = byId('popup-status');
const profileButton = byId<HTMLButtonElement>('open-profile');
const scanButton = byId<HTMLButtonElement>('scan');
const autofillButton = byId<HTMLButtonElement>('autofill-now');
const overwrite = byId<HTMLInputElement>('overwrite');
const undoButton = byId<HTMLButtonElement>('undo');
const fillButton = byId<HTMLButtonElement>('fill');
const warningsList = byId('warnings');
const preview = byId('preview');
const previewTitle = byId('preview-title');
const framesContainer = byId('frames');
const scanSummary = byId('scan-summary');
const manualSummary = byId('manual-summary');
const selectAll = byId<HTMLInputElement>('select-all');
const selectAllLabel = byId('select-all-label');
const aiActions = byId('ai-actions');
const applicationNotes = byId<HTMLTextAreaElement>('application-notes');
applicationNotes.maxLength = MAX_APPLICATION_NOTES_LENGTH;
const aiButton = byId<HTMLButtonElement>('suggest-ai');
const aiReview = byId('ai-review');
const reviewTitle = byId('review-title');
const suggestions = byId('suggestions');
const discardAI = byId<HTMLButtonElement>('discard-ai');
const applyAI = byId<HTMLButtonElement>('apply-ai');
const fillDetails = byId<HTMLDetailsElement>('fill-details');
const fillEntries = byId('fill-entries');
const vaultSourcesButton = byId<HTMLButtonElement>('vault-sources-button');
const vaultSources = byId('vault-sources');
const vaultSourceList = byId('vault-source-list');
const vaultSourcesStatus = byId('vault-sources-status');

let scan: FrameScan[] | undefined;
let profile: Profile | undefined;
let aiSettings: AISettings | undefined;
let reviewing: ReviewRow[] = [];
let approvedAnswers: ApprovedAnswers = Object.create(null);
let selected = new Set<string>();
let busy = false;
let hasScanned = false;
const fieldChecks = new Map<string, HTMLInputElement>();
const reviewControls: (HTMLInputElement | HTMLTextAreaElement)[] = [];

function keyFor(frame: FrameScan, field: FieldPlan): string {
  return `${frame.frameId}:${field.id}`;
}

function fieldsIn(scans: FrameScan[] | undefined): FieldRef[] {
  return (scans ?? []).flatMap((frame) => frame.result.fields.map((field) => ({
    frame, field, key: keyFor(frame, field),
  })));
}

function eligibleFields(): FieldRef[] {
  return fieldsIn(scan).filter(({ field }) => (
    field.status === 'unanswered' && field.aiEligible !== false && !field.sensitive
    && ['text', 'select', 'radio', 'combobox'].includes(field.kind)
  ));
}

function validDraft(answer: string): boolean {
  const length = answer.trim().length;
  return length > 0 && length <= MAX_DRAFT_LENGTH;
}

function updateControls(): void {
  const readyCount = fieldChecks.size;
  profileButton.disabled = scanButton.disabled = autofillButton.disabled = overwrite.disabled = undoButton.disabled = busy;
  vaultSourcesButton.disabled = busy;
  scanButton.textContent = hasScanned ? 'Refresh field review' : 'Review fields';
  fillButton.disabled = busy || !selected.size;
  fillButton.textContent = selected.size ? `Fill selected (${selected.size})` : 'Fill selected';
  selectAllLabel.hidden = !readyCount;
  selectAll.disabled = busy || !readyCount;
  selectAll.checked = readyCount > 0 && selected.size === readyCount;
  selectAll.indeterminate = selected.size > 0 && selected.size < readyCount;
  for (const check of fieldChecks.values()) check.disabled = busy;
  for (const control of reviewControls) control.disabled = busy;
  for (const jump of framesContainer.querySelectorAll<HTMLButtonElement>('.field-jump')) jump.disabled = busy;

  const aiEnabled = aiSettings?.enabled && aiSettings.apiKey && aiSettings.model;
  aiActions.hidden = !aiEnabled || !eligibleFields().length || reviewing.length > 0;
  applicationNotes.disabled = aiButton.disabled = busy;
  discardAI.disabled = busy;
  const checked = reviewing.filter((entry) => entry.checked);
  applyAI.disabled = busy || !checked.length || checked.some((entry) => !validDraft(entry.answer));
}

function chooseField(key: string, checked: boolean): void {
  if (checked) selected.add(key);
  else selected.delete(key);
  updateControls();
}

selectAll.addEventListener('change', () => {
  selected = selectAll.checked ? new Set(fieldChecks.keys()) : new Set();
  for (const [key, check] of fieldChecks) check.checked = selected.has(key);
  updateControls();
});

function answerText(value: FieldPlan['value']): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value ?? '';
}

function fieldDetail(field: FieldPlan): string {
  switch (field.status) {
    case 'ready': return [answerText(field.value) || 'Ready to fill', field.reason].filter(Boolean).join('\n');
    case 'preserved': return field.currentValue ? `Kept · ${field.currentValue}` : field.reason || 'Existing answer kept';
    case 'unsupported': return field.reason || 'Unsupported field';
    case 'unanswered': return field.reason || 'No matching answer';
  }
}

function makeFieldRow(frame: FrameScan, field: FieldPlan): HTMLElement {
  const content = element('span');
  const title = element(field.status === 'ready' ? 'span' : 'button', 'field-row-title', field.label);
  if (title instanceof HTMLButtonElement) {
    title.type = 'button';
    title.classList.add('field-jump');
    title.setAttribute('aria-label', `Show field: ${field.label}`);
    title.title = 'Scroll to this field on the application';
    title.addEventListener('click', event => {
      if (!event.isTrusted) return;
      void runTask(async () => {
        const topUrl = frame.tabUrl ?? scan?.find(candidate => candidate.frameId === 0)?.result.frameUrl;
        if (!topUrl) throw new Error('Refresh the field review before locating this field.');
        const result = await focusPageField(frame.tabId, topUrl, { fieldId: field.id, frameId: frame.frameId,
          frameUrl: frame.result.frameUrl, ...(frame.documentId ? { documentId: frame.documentId } : {}) });
        announce(result.focused ? 'Field highlighted on the application.' : result.reason ?? 'This field is no longer available.', result.focused ? 'success' : 'error');
      }, 'Could not locate this field. Refresh the field review.');
    });
  }
  content.append(title);
  const statusText = field.status === 'unanswered' ? 'Needs your answer'
    : field.status === 'unsupported' ? 'Complete manually' : '';
  const metadata = [field.required ? 'Required' : '', statusText].filter(Boolean).join(' · ');
  if (metadata) content.append(element('span', 'field-row-meta', metadata));
  content.append(element('span', 'field-row-detail', fieldDetail(field)));
  if (field.section) content.prepend(element('span', 'field-section', field.section));

  if (field.status !== 'ready') {
    const row = element('div', 'field-row');
    row.append(content);
    return row;
  }

  const key = keyFor(frame, field);
  const row = element('label', 'field-row selectable');
  const check = element('input');
  check.type = 'checkbox';
  check.checked = selected.has(key);
  check.addEventListener('change', () => chooseField(key, check.checked));
  fieldChecks.set(key, check);
  row.append(check, content);
  return row;
}

const platformNames: Record<string, string> = {
  generic: 'Standard form',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  icims: 'iCIMS',
};

function scanOrigin(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function renderPreview(): void {
  fieldChecks.clear();
  framesContainer.replaceChildren();
  warningsList.replaceChildren();
  const warnings = new Set((scan ?? []).flatMap((frame) => frame.result.warnings));
  warningsList.hidden = !warnings.size;
  for (const warning of warnings) warningsList.append(element('li', undefined, warning));

  preview.hidden = !scan;
  manualSummary.hidden = true;
  if (scan) {
    const fields = fieldsIn(scan);
    const totals = { ready: 0, preserved: 0, unanswered: 0, unsupported: 0 };
    for (const { field } of fields) totals[field.status]++;
    scanSummary.textContent = fields.length ? [
      `${fields.length} ${fields.length === 1 ? 'field' : 'fields'} detected`,
      `${totals.ready} ready`,
      totals.preserved ? `${totals.preserved} kept` : '',
      totals.unanswered ? `${totals.unanswered} unanswered` : '',
      totals.unsupported ? `${totals.unsupported} unsupported` : '',
    ].filter(Boolean).join(' · ') : 'No application fields found.';
    const manual = fields.filter(({ field }) => field.status === 'unanswered' || field.status === 'unsupported');
    const requiredManual = manual.filter(({ field }) => field.required).length;
    manualSummary.hidden = !manual.length;
    manualSummary.textContent = [
      requiredManual ? `${requiredManual} required ${requiredManual === 1 ? 'field needs' : 'fields need'} your attention.` : '',
      'Fields that need an answer or a manual action are listed below with a reason.',
    ].filter(Boolean).join(' ');

    for (const frame of scan) {
      if (!frame.result.fields.length) continue;
      const group = element('section', 'frame');
      const platform = platformNames[frame.result.platform.toLowerCase()] ?? frame.result.platform;
      const origin = frame.frameId !== 0 ? scanOrigin(frame.result.frameUrl) : '';
      const title = frame.frameId === 0 ? platform : ['Embedded form', platform, origin].filter(Boolean).join(' · ');
      group.append(element('h3', undefined, title));
      for (const field of frame.result.fields) group.append(makeFieldRow(frame, field));
      framesContainer.append(group);
    }
  }

  updateControls();
}

function renderReview(): void {
  aiReview.hidden = !reviewing.length;
  suggestions.replaceChildren();
  reviewControls.length = 0;
  for (const [index, row] of reviewing.entries()) {
    const item = element('div', 'field-row selectable');
    const check = element('input');
    check.id = `use-draft-${index}`;
    check.type = 'checkbox';
    check.checked = row.checked;
    check.addEventListener('change', () => {
      row.checked = check.checked;
      updateControls();
    });
    reviewControls.push(check);

    const content = element('div');
    if (row.target.frame.frameId !== 0) {
      const origin = scanOrigin(row.target.frame.result.frameUrl);
      content.append(element('span', 'field-section', ['Embedded form', origin].filter(Boolean).join(' · ')));
    }
    const { field } = row.target;
    if (field.section) content.append(element('span', 'field-section', field.section));
    const label = element('label', 'field-row-title', field.label);
    label.htmlFor = check.id;
    content.append(label);
    if (field.kind === 'text' && !field.options?.length) {
      const draft = element('textarea');
      draft.setAttribute('aria-label', `Draft answer for ${field.label}`);
      draft.maxLength = MAX_DRAFT_LENGTH;
      draft.rows = 3;
      draft.value = row.answer;
      const issue = element('p', 'hint', 'Enter a draft of 1 to 4,000 characters.');
      issue.id = `draft-issue-${index}`;
      issue.hidden = true;
      draft.setAttribute('aria-errormessage', issue.id);
      draft.addEventListener('input', () => {
        row.answer = draft.value.trim();
        const invalid = !validDraft(row.answer);
        draft.setAttribute('aria-invalid', String(invalid));
        issue.hidden = !invalid;
        updateControls();
      });
      reviewControls.push(draft);
      content.append(draft, issue);
    } else {
      const option = element('span', 'field-row-detail', row.answer);
      option.id = `draft-option-${index}`;
      check.setAttribute('aria-describedby', option.id);
      content.append(option);
    }
    item.append(check, content);
    suggestions.append(item);
  }
  updateControls();
}

function resetScan(preserveNotes = false): void {
  scan = undefined;
  approvedAnswers = Object.create(null);
  selected.clear();
  reviewing = [];
  if (!preserveNotes) applicationNotes.value = '';
  renderPreview();
  renderReview();
}

async function runTask(action: () => Promise<void>, fallback: string): Promise<void> {
  if (busy) return;
  busy = true;
  updateControls();
  try {
    await action();
  } catch (error) {
    announce(errorMessage(error, fallback), 'error');
  } finally {
    busy = false;
    updateControls();
  }
}

function announcePreview(): void {
  showNotice(status, scanSummary.textContent || 'Scan complete.');
  // The preview summary stays visible. Remove the transient notice after announcement.
  status.classList.add('sr-only');
}

function announce(message: string, tone?: 'neutral' | 'error' | 'success'): void {
  status.classList.remove('sr-only');
  showNotice(status, message, tone);
}

function scanForm(): void {
  void runTask(async () => {
    fillDetails.hidden = true;
    resetScan();
    announce('Scanning form…');
    profile = await loadProfile();
    scan = await scanActiveTab(profile, { overwriteExisting: overwrite.checked });
    hasScanned = true;
    selected = new Set(fieldsIn(scan).filter(({ field }) => field.status === 'ready').map(({ key }) => key));
    renderPreview();
    announcePreview();
  }, 'Could not scan this form.');
}

scanButton.addEventListener('click', scanForm);
autofillButton.addEventListener('click', () => {
  void runTask(async () => {
    resetScan();
    const reply = await activePageJob('start', overwrite.checked);
    announce(reply.warning ?? 'Autofill is running on the application page. You can close this popup or switch tabs.');
  }, 'Could not start autofill. Reload the application page after updating the extension.');
});
overwrite.addEventListener('change', () => {
  if (scan) scanForm();
});
profileButton.addEventListener('click', () => {
  void runTask(openOptions, 'Could not open the profile.');
});

vaultSourcesButton.addEventListener('click', event => {
  if (!event.isTrusted) return;
  void runTask(async () => {
    vaultSources.hidden = false;
    vaultSourceList.replaceChildren();
    vaultSourcesStatus.textContent = 'Loading sources for this application…';
    const api = extensionAPI();
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url) || !api.runtime.sendMessage) {
      vaultSourcesStatus.textContent = 'Open the application tab to view its sources.'; return;
    }
    try {
      const reply = await api.runtime.sendMessage<VaultSourcesResult>({ channel: VAULT_CHANNEL, command: 'sources', tabId: tab.id, url: tab.url });
      vaultSourcesStatus.textContent = reply.error || (reply.receipts.length ? 'Sources used to generate answers for this run.' : 'No Obsidian answers are recorded for this application.');
      for (const receipt of reply.receipts) {
        const item = element('li');
        item.append(element('strong', undefined, receipt.question));
        for (const source of receipt.sources) item.append(element('p', 'hint', `${source.path} · ${source.heading || 'Note'} · lines ${source.lineStart}–${source.lineEnd}`));
        vaultSourceList.append(item);
      }
    } catch { vaultSourcesStatus.textContent = 'Sources are unavailable. Reload the extension if it was updated.'; }
  }, 'Could not load Obsidian sources.');
});

aiButton.addEventListener('click', (event) => {
  if (!event.isTrusted || !profile || !aiSettings?.enabled || busy) return;
  const sourceProfile = profile;
  const settings = aiSettings;
  const eligible = eligibleFields();
  if (!eligible.length) return;
  const notes = applicationNotes.value;

  void runTask(async () => {
    const permission = requestAIPermission(settings.provider);
    announce('Requesting AI suggestions…');
    if (!await permission) {
      announce('AI provider access was declined. You can still fill your saved answers.', 'error');
      return;
    }

    const byKey = new Map(eligible.map((target) => [target.key, target]));
    const result = await suggestAnswers(sourceProfile, eligible.map(({ field, key }) => ({ ...field, id: key })), settings, notes);
    if (result.error) {
      announce(result.error, 'error');
      return;
    }

    const seen = new Set<string>();
    reviewing = [];
    for (const suggestion of result.suggestions) {
      const target = byKey.get(suggestion.fieldId);
      if (!target || !suggestion.answer.trim() || seen.has(target.key)) continue;
      seen.add(target.key);
      reviewing.push({ target, answer: suggestion.answer, checked: false });
    }
    renderReview();

    if (reviewing.length) {
      announce('');
      reviewTitle.focus();
    } else {
      announce('AI returned no suggestions for these questions.');
    }
  }, 'Could not request AI suggestions.');
});

discardAI.addEventListener('click', () => {
  reviewing = [];
  renderReview();
  aiButton.focus();
});

applyAI.addEventListener('click', () => {
  if (!scan || !profile || busy) return;
  const sourceProfile = profile;
  const approved = reviewing.filter((row) => row.checked);
  if (!approved.length || approved.some((row) => !validDraft(row.answer))) return;

  void runTask(async () => {
    const byFrame = approvedAnswers;
    const previousSelection = new Set(selected);
    for (const { target, answer } of approved) {
      byFrame[target.frame.frameId] ??= Object.create(null);
      byFrame[target.frame.frameId][target.field.id] = answer;
      previousSelection.add(target.key);
    }

    resetScan(true);
    announce('Updating the form preview…');
    scan = await scanActiveTab(sourceProfile, { overwriteExisting: overwrite.checked }, byFrame);
    const ready = fieldsIn(scan).filter(({ field }) => field.status === 'ready');
    for (const { frame, field } of ready) {
      const answer = byFrame[frame.frameId]?.[field.id];
      if (answer !== undefined) {
        (approvedAnswers[frame.frameId] ??= Object.create(null))[field.id] = answer;
      }
    }
    selected = new Set(ready.filter(({ key }) => previousSelection.has(key)).map(({ key }) => key));
    renderPreview();

    const readyKeys = new Set(ready.map(({ key }) => key));
    const added = approved.filter(({ target }) => readyKeys.has(target.key)).length;
    if (added) {
      const message = added === approved.length
        ? 'Reviewed suggestions added to the preview.'
        : `${added} of ${approved.length} reviewed suggestions are ready in the preview.`;
      announce(message, 'success');
    } else {
      announce('The reviewed suggestions could not be applied to these fields. Check the updated preview.');
    }
    previewTitle.focus();
  }, 'Could not update the form preview. Scan the form again.');
});

fillButton.addEventListener('click', () => {
  if (!scan || !selected.size || busy) return;
  const sourceScan = scan;
  const sourceProfile = profile;
  const sourceApproved = approvedAnswers;
  const byFrame: Record<number, string[]> = {};
  for (const frame of sourceScan) {
    byFrame[frame.frameId] = frame.result.fields
      .filter((field) => field.status === 'ready' && selected.has(keyFor(frame, field)))
      .map((field) => field.id);
  }

  void runTask(async () => {
    resetScan(true);
    fillDetails.hidden = true;
    announce('Filling selected fields…');
    const results = await fillActiveTab(sourceScan, byFrame);
    const entries = results.flatMap(({ result }) => result.entries);
    const counts = { filled: 0, skipped: 0, failed: 0 };
    for (const { result } of results) {
      counts.filled += result.filled;
      counts.skipped += result.skipped;
      counts.failed += result.failed;
    }
    const summary = [
      `${counts.filled} filled`,
      counts.skipped ? `${counts.skipped} skipped` : '',
      counts.failed ? `${counts.failed} failed` : '',
    ].filter(Boolean).join(' · ');
    const needsRescan = results.some(({ result }) => result.needsRescan);
    let coverageMessage = needsRescan ? 'Rescan the form for any new fields.' : 'Review your answers on the page.';
    if (sourceProfile && needsRescan) {
      try {
        // Supplying reviewed answers (even an empty map) also verifies the
        // original tab and frame URLs. This is a read-only coverage refresh.
        scan = await scanActiveTab(sourceProfile, { overwriteExisting: false }, sourceApproved);
        overwrite.checked = false;
        for (const { frame, field } of fieldsIn(scan)) {
          const answer = sourceApproved[frame.frameId]?.[field.id];
          if (answer !== undefined && field.status === 'ready') {
            (approvedAnswers[frame.frameId] ??= Object.create(null))[field.id] = answer;
          }
        }
        // New and previously unselected fields require another explicit choice.
        selected.clear();
        renderPreview();
        coverageMessage = 'Preview refreshed. Review remaining fields before filling again.';
      } catch {
        coverageMessage = 'The preview could not refresh. Rescan the application to check remaining fields.';
      }
    }
    announce(
      `${summary}. ${coverageMessage}`,
      counts.failed ? 'error' : counts.filled ? 'success' : 'neutral',
    );
    fillEntries.replaceChildren(...entries.map((entry) => element(
      'li', undefined, `${entry.label} · ${entry.reason || entry.status}`,
    )));
    fillDetails.open = false;
    fillDetails.hidden = !entries.length;
  }, 'Could not finish filling this form. Check the page and rescan.');
});

undoButton.addEventListener('click', () => {
  void runTask(async () => {
    announce('Undoing the last fill…');
    const results = await undoActiveTab();
    const restored = results.reduce((sum, result) => sum + result.restored, 0);
    const skipped = results.reduce((sum, result) => sum + result.skipped, 0);
    const undoWarnings = [...new Set(results.flatMap(result => result.warning ? [result.warning] : []))];
    if (!restored && !skipped && !undoWarnings.length) {
      const page = await activePageJob('status').catch(() => undefined);
      if (page?.states?.some(state => state.undoAvailable)) {
        await activePageJob('undo');
        resetScan();
        fillDetails.hidden = true;
        announce('Undo is running on the application page.');
        return;
      }
    }
    if (restored || skipped || undoWarnings.length) {
      resetScan();
      fillDetails.hidden = true;
    }
    const detail = skipped ? ` ${skipped} skipped after the fields changed.` : '';
    announce(
      (restored || skipped || undoWarnings.length ? `${restored} restored.${detail}` : 'No autofill changes to undo on this tab.') + (undoWarnings.length ? ' ' + undoWarnings.join(' ') : ''),
      restored ? 'success' : 'neutral',
    );
  }, 'Could not undo autofill on this tab.');
});

void loadAISettings().then((settings) => {
  aiSettings = settings;
  updateControls();
}).catch(() => {
  // The local scan remains available if AI settings cannot load.
});
