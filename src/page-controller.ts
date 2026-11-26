import type { AutofillEngine, FieldPlan, FillEntry, FillResult, Profile, ScanResult } from './shared/types';
import type { EmbeddedApplicationBinding, JobState, PageController } from './shared/jobs';
import type { InterpretationRun, QuestionInterpreter } from './shared/interpretation';
import type { VaultDrafter, VaultRun } from './shared/vault';
import { sameEmbeddedApplication } from './services/application-frames';

interface EmbeddedChecks {
  matchesEmbedded(binding: EmbeddedApplicationBinding): boolean;
  validateEmbedded(binding: EmbeddedApplicationBinding): Promise<boolean>;
}

/** Lives in the isolated content script, so popup/worker teardown cannot cancel a fill. */
export function createPageController(
  doc: Document, engine: AutofillEngine, show: () => void, interpreter?: QuestionInterpreter, draftVault?: VaultDrafter, embedded?: EmbeddedChecks,
): PageController {
  function currentTopUrl(): string | undefined {
    try { return doc.defaultView?.top?.location.href; }
    catch { return undefined; }
  }

  function matchesBinding(binding?: EmbeddedApplicationBinding): boolean {
    return embedded ? !!binding && doc.URL === binding.frameUrl && embedded.matchesEmbedded(binding) : binding === undefined;
  }

  function matchesApplication(url: string, topUrl: string | undefined, binding?: EmbeddedApplicationBinding): boolean {
    return doc.URL === url && matchesBinding(binding) && (!!binding || topUrl === undefined || currentTopUrl() === topUrl);
  }

  async function validateBinding(binding: EmbeddedApplicationBinding): Promise<boolean> {
    if (!matchesBinding(binding) || !embedded) return false;
    return await embedded.validateEmbedded(binding).catch(() => false) && matchesBinding(binding);
  }

  function idleState(message = 'Ready to fill from your profile.'): JobState {
    return { url: doc.URL, running: false, started: false, filled: 0, failed: 0, undoAvailable: false, message, remaining: [] };
  }

  let state = idleState();
  let stateTopUrl = currentTopUrl();
  let stateBinding: EmbeddedApplicationBinding | undefined;
  let undoId: string | undefined;

  function resetStatus(message?: string) {
    state = idleState(message);
    stateTopUrl = currentTopUrl();
    stateBinding = undefined;
    undoId = undefined;
  }

  function noteFill(scanId: string, fill: FillResult, binding?: EmbeddedApplicationBinding) {
    if (!matchesBinding(binding)) return;
    if (!sameEmbeddedApplication(stateBinding, binding) || !matchesApplication(state.url, stateTopUrl, stateBinding)) resetStatus();
    stateBinding = binding;
    stateTopUrl = binding?.topUrl ?? currentTopUrl();
    state.started = true;
    state.filled = fill.filled;
    state.failed = fill.failed;
    state.aiFilled = 0;
    state.aiMessage = undefined;
    state.vaultFilled = 0;
    state.vaultMessage = undefined;
    state.experienceMessage = undefined;
    state.remaining = [];
    state.message = `${fill.filled} filled${fill.failed ? ` · ${fill.failed} could not be filled` : ''}`;
    if (fill.undoAvailable ?? fill.filled > 0) { state.undoAvailable = true; undoId = scanId; }
  }
  async function run(profile: Profile, overwrite: boolean, interpretationRun?: InterpretationRun, vaultRun?: VaultRun): Promise<void> {
    const url = state.url;
    const topUrl = stateTopUrl;
    const binding = stateBinding;
    let bindingInvalidated = false;
    const applicationChanged = () => bindingInvalidated || !matchesApplication(url, topUrl, binding);
    const applicationChangedInBrowser = async () => {
      if (binding && !await validateBinding(binding)) bindingInvalidated = true;
      return applicationChanged();
    };
    const attempted = new Set<string>();
    const attemptedQuestions = new Set<string>();
    const outcomes = new Map<string, FillEntry & { verifiedUnchecked: boolean; required?: boolean }>();
    const interpretedQuestions = new Set<string>();
    const attemptedVaultQuestions = new Set<string>();
    let vaultRounds = 0;
    let vaultFailed = false;
    let interpretationRounds = 0;
    let interpretationFailed = false;
    let jobUndoId: string | undefined;
    try {
      const vaultToken = draftVault && engine.stageVaultAnswers ? vaultRun?.token : undefined;
      const runBytes = new Uint32Array(4);
      (doc.defaultView?.crypto ?? globalThis.crypto).getRandomValues(runBytes);
      const autofillRun = [...runBytes].map(value => value.toString(16).padStart(8, '0')).join('');
      let overwriteFieldIds: string[] | undefined;
      let originalExperienceGroup: string | undefined;
      let originalRepeats: NonNullable<ScanResult['workdayRepeatGroups']> = [];
      const scanApplication = async (overwriteExisting = false) => {
        if (binding && await applicationChangedInBrowser()) throw new Error('The application changed. Click Autofill on the new step.');
        const current = await engine.scan(profile, { overwriteExisting, overwriteFieldIds, autofillRun, vaultRun: vaultToken });
        if (originalExperienceGroup && current.workdayExperienceGroupId !== originalExperienceGroup) {
          state.experienceMessage = undefined;
          throw new Error('The work experience section changed. Review it, then click Autofill again.');
        }
        if (originalRepeats.some(group => !current.workdayRepeatGroups?.some(item => item.id === group.id && item.kind === group.kind && item.formScopeId === group.formScopeId))) {
          throw new Error('An education or website section changed. Review it, then click Autofill again.');
        }
        return current;
      };
      let scan = await scanApplication(overwrite);
      originalExperienceGroup = scan.workdayExperienceGroupId;
      originalRepeats = scan.workdayRepeatGroups ?? [];
      overwriteFieldIds = overwrite ? scan.fields.filter(field => field.status === 'ready' && field.currentValue).map(field => field.id) : undefined;
      const initialIds = new Set(scan.fields.map(field => field.id));
      const originalForms = new Set(scan.fields.filter(field => field.scopeType === 'form').map(field => field.scopeId));
      if (scan.workdayExperienceFormScopeId) originalForms.add(scan.workdayExperienceFormScopeId);
      for (const group of originalRepeats) if (group.formScopeId) originalForms.add(group.formScopeId);
      let experiencePaused = false;
      const inOriginalApplication = (field: FieldPlan, current: ScanResult) => field.workdayExperienceGroupId
        ? !!originalExperienceGroup && field.workdayExperienceGroupId === originalExperienceGroup
          && current.workdayExperienceGroupId === originalExperienceGroup
          && (field.scopeType !== 'form' || originalForms.has(field.scopeId))
        : field.workdayRepeatGroupId
          ? originalRepeats.some(group => group.id === field.workdayRepeatGroupId)
            && !!current.workdayRepeatGroups?.some(group => group.id === field.workdayRepeatGroupId)
            && (field.scopeType !== 'form' || originalForms.has(field.scopeId))
        : (field.scopeType !== 'form' || originalForms.has(field.scopeId))
          && current.fields.some(candidate => candidate.scopeId === field.scopeId && initialIds.has(candidate.id));
      const questionKey = (field: FieldPlan) => JSON.stringify([field.scopeId, field.section, field.kind,
        field.label.toLowerCase().replace(/\s+/g, ' ').trim(), field.interpretationContext ?? '']);
      // The caption key also covers remounted controls whose DOM identity changed while awaiting a draft.
      const vaultQuestionKey = (field: FieldPlan) => JSON.stringify([field.scopeId,
        field.label.toLowerCase().replace(/\s+/g, ' ').trim()]);
      const canContinue = (field: FieldPlan, current: ScanResult) => inOriginalApplication(field, current)
        && !(experiencePaused && field.workdayExperienceGroupId === originalExperienceGroup);
      const vaultCandidate = (field: FieldPlan, current: ScanResult) => field.kind === 'text'
        && field.status === 'unanswered' && field.vaultEligible && !attempted.has(field.id)
        && !attemptedQuestions.has(questionKey(field)) && !attemptedVaultQuestions.has(vaultQuestionKey(field))
        && canContinue(field, current);
      const unattempted = (field: FieldPlan, current: ScanResult) => field.status === 'ready' && !attempted.has(field.id)
        && !attemptedQuestions.has(questionKey(field)) && canContinue(field, current);
      const protectExisting = (current: ScanResult) => {
        for (const field of current.fields) {
          if (field.status === 'preserved') {
            attempted.add(field.id);
            attemptedQuestions.add(questionKey(field));
          }
          if (field.status === 'preserved' || field.currentValue) attemptedVaultQuestions.add(vaultQuestionKey(field));
        }
      };
      protectExisting(scan);
      const fillFields = async (ready: FieldPlan[]): Promise<FillResult> => {
        if (applicationChanged() || (binding && await applicationChangedInBrowser())) {
          throw new Error('The application changed. Click Autofill on the new step.');
        }
        ready.forEach(field => { attempted.add(field.id); attemptedQuestions.add(questionKey(field)); });
        if (overwriteFieldIds) overwriteFieldIds = overwriteFieldIds.filter(id => !attempted.has(id));
        const fill = await engine.fill(scan.scanId, ready.map(field => field.id), jobUndoId);
        if (applicationChanged() || (binding && await applicationChangedInBrowser())) {
          throw new Error('The application changed. Review the new step before filling.');
        }
        state.filled += fill.filled;
        const aiIds = new Set(ready.filter(field => field.answerSource === 'interpreted').map(field => field.id));
        state.aiFilled = (state.aiFilled ?? 0) + fill.entries.filter(entry => entry.status === 'filled' && aiIds.has(entry.id)).length;
        const vaultIds = new Set(ready.filter(field => field.answerSource === 'vault').map(field => field.id));
        state.vaultFilled = (state.vaultFilled ?? 0) + fill.entries.filter(entry => entry.status === 'filled' && vaultIds.has(entry.id)).length;
        state.failed += fill.failed;
        const readyById = new Map(ready.map(field => [field.id, field]));
        for (const entry of fill.entries) {
          const field = readyById.get(entry.id);
          if (field) outcomes.set(entry.id, {
            ...entry,
            required: field.required,
            verifiedUnchecked: entry.status === 'filled' && field.kind === 'checkbox' && field.value === false,
          });
        }
        if (originalExperienceGroup && ready.some(field => field.workdayExperienceGroupId === originalExperienceGroup)
          && ((!fill.entries.length && fill.needsRescan) || fill.entries.some(entry => entry.status !== 'filled'
            && readyById.get(entry.id)?.workdayExperienceGroupId === originalExperienceGroup))) {
          experiencePaused = true;
          state.experienceMessage = 'Workday changed a work-history field during Autofill. Review the section, then click Autofill again.';
        }
        if (fill.undoAvailable ?? fill.filled > 0) {
          state.undoAvailable = true;
          undoId = jobUndoId = scan.scanId;
        }
        return fill;
      };
      if ((originalExperienceGroup && engine.expandWorkdayExperience) || (originalRepeats.length && engine.expandWorkdayRepeat)) {
        // A resume parser may populate existing records. Confirm its upload before
        // deciding how many rows are missing, and retain those site-populated values.
        const resumes = scan.fields.filter(field => field.kind === 'file' && field.status === 'ready'
          && /^resume\s*(?:\/\s*cv)?$/i.test(field.label) && inOriginalApplication(field, scan));
        let uploadSettled = resumes.length <= 1;
        if (resumes.length === 1) {
          state.message = 'Uploading your résumé…';
          const upload = await fillFields(resumes);
          uploadSettled = upload.entries.some(entry => entry.id === resumes[0].id && entry.status === 'filled');
          scan = await scanApplication();
          protectExisting(scan);
        }
        if (uploadSettled && originalExperienceGroup && engine.expandWorkdayExperience && scan.workdayExperienceGroupId === originalExperienceGroup) {
          if (applicationChanged()) throw new Error('The application changed. Click Autofill on the new step.');
          state.message = 'Preparing your work experience…';
          const expanded = await engine.expandWorkdayExperience(scan.scanId, originalExperienceGroup);
          state.experienceMessage = expanded.message;
          if (expanded.aborted) throw new Error(expanded.message ?? 'The work experience section changed. Click Autofill again.');
          if (expanded.needsRescan) {
            scan = await scanApplication();
            protectExisting(scan);
          }
        }
        if (uploadSettled && engine.expandWorkdayRepeat) {
          for (const group of originalRepeats) {
            if (applicationChanged()) throw new Error('The application changed. Click Autofill on the new step.');
            state.message = group.kind === 'education' ? 'Preparing your education…' : 'Preparing your websites…';
            const expanded = await engine.expandWorkdayRepeat(scan.scanId, group.id);
            if (expanded.message) state.experienceMessage = expanded.message;
            if (expanded.aborted) throw new Error(expanded.message ?? 'The section changed. Click Autofill again.');
            if (expanded.needsRescan) { scan = await scanApplication(); protectExisting(scan); }
          }
        }
        if (!uploadSettled) {
          state.experienceMessage = 'The résumé upload was not confirmed. Finish the upload, then click Autofill to add work experience.';
        }
      }
      for (let pass = 0; pass < 4; pass++) {
        if (applicationChanged()) throw new Error('The application changed. Click Autofill on the new step.');
        let ready = scan.fields.filter(field => unattempted(field, scan));
        if (!ready.length && interpreter && interpretationRun && engine.interpret && interpretationRounds < 2 && !interpretationFailed) {
          const candidates = scan.fields.filter(field => field.status === 'unanswered' && field.interpretationEligible
            && field.kind !== 'file' && field.label.length <= 2000 && canContinue(field, scan)
            && !attempted.has(field.id) && !attemptedQuestions.has(questionKey(field))
            && !interpretedQuestions.has(questionKey(field))).slice(0, 20);
          if (candidates.length) {
            interpretationRounds++;
            candidates.forEach(field => interpretedQuestions.add(questionKey(field)));
            state.message = 'Matching unfamiliar questions with your saved facts…';
            try {
              if (binding && await applicationChangedInBrowser()) throw new Error('The application changed before AI matching.');
              const result = await interpreter(candidates.map(field => ({ id: field.id, label: field.label,
                kind: field.kind as Exclude<typeof field.kind, 'file'>, options: field.options?.slice(0, 100),
                context: field.interpretationContext,
              })), interpretationRun);
              if (applicationChanged() || (binding && await applicationChangedInBrowser())) {
                throw new Error('The application changed during AI matching. Click Autofill on the new step.');
              }
              if (result.error) {
                interpretationFailed = true;
                state.aiMessage = result.error;
              } else {
                const interpreted = await engine.interpret(scan.scanId, profile, result.meanings);
                if (!interpreted) {
                  interpretationFailed = true;
                  state.aiMessage = 'The form changed during AI matching. Click Autofill again to review it.';
                } else {
                  scan = interpreted;
                  ready = scan.fields.filter(field => unattempted(field, scan));
                  if (!ready.length) state.aiMessage = 'AI could not match these questions to a supported saved fact.';
                }
              }
            } catch (error) {
              if (applicationChanged()) throw error;
              interpretationFailed = true;
              state.aiMessage = 'AI matching is unavailable. Your local answers are still available.';
            }
          }
        }
        if (!ready.length && draftVault && vaultRun && engine.stageVaultAnswers && vaultRounds < 2 && !vaultFailed) {
          const candidates = scan.fields.filter(field => vaultCandidate(field, scan)).slice(0, 8);
          if (candidates.length) {
            vaultRounds++;
            candidates.forEach(field => attemptedVaultQuestions.add(vaultQuestionKey(field)));
            state.message = 'Drafting answers from your Obsidian notes…';
            try {
              if (binding && await applicationChangedInBrowser()) throw new Error('The application changed before drafting.');
              const result = await draftVault(candidates.map(field => ({
                id: field.id, label: field.label, kind: 'text',
                ...(field.vaultContext ? { context: field.vaultContext } : {}),
                ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
              })), vaultRun);
              if (applicationChanged() || (binding && await applicationChangedInBrowser())) {
                throw new Error('The application changed while drafting answers. Click Autofill on the new step.');
              }
              if (result.error) {
                vaultFailed = true;
                state.vaultMessage = result.error;
              } else {
                const requested = new Set(candidates.map(field => field.id));
                const staged = await engine.stageVaultAnswers(scan.scanId, result.answers.filter(answer => requested.has(answer.fieldId)));
                if (!staged) {
                  vaultFailed = true;
                  state.vaultMessage = 'The form changed while drafting answers. Click Autofill again to review it.';
                } else {
                  scan = staged;
                  ready = scan.fields.filter(field => unattempted(field, scan));
                  if (!ready.length) state.vaultMessage = result.answers.length
                    ? 'No Obsidian answers could be safely applied.'
                    : 'No supported answer was found in your Obsidian notes.';
                }
              }
            } catch (error) {
              if (applicationChanged()) throw error;
              vaultFailed = true;
              state.vaultMessage = 'Obsidian drafting is unavailable. Your local answers are still available.';
            }
          }
        }
        if (!ready.length) {
          // Reflect edits and replacement controls only after staging on the original scan.
          const priorIds = new Set(scan.fields.map(field => field.id));
          const priorUnready = new Set(scan.fields.filter(field => field.status !== 'ready').map(field => field.id));
          scan = await scanApplication();
          protectExisting(scan);
          // A previously unready control may now be blank because the applicant
          // cleared it. Only newly revealed controls get a fresh checkpoint here.
          for (const field of scan.fields) if (priorUnready.has(field.id) && field.status === 'ready') {
            attempted.add(field.id);
            attemptedQuestions.add(questionKey(field));
          }
          const revealed = scan.fields.filter(field => !priorIds.has(field.id) && canContinue(field, scan));
          if (revealed.some(field => unattempted(field, scan) || (field.status === 'unanswered'
            && field.interpretationEligible && interpreter && interpretationRun && engine.interpret
            && !interpretationFailed && interpretationRounds < 2))) continue;
          if (vaultToken && !vaultFailed && vaultRounds < 2 && scan.fields.some(field => vaultCandidate(field, scan))) continue;
          break;
        }
        const fill = await fillFields(ready);
        scan = await scanApplication();
        protectExisting(scan);
        // Give conditional questions a bounded window to render. A later pass keeps
        // existing answers and never retries an already attempted control.
        if (pass === 3) break;
        if (!(fill.undoAvailable ?? fill.filled > 0)) continue;
        for (let poll = 0; poll < 3 && !scan.fields.some(field => unattempted(field, scan)); poll++) {
          await new Promise<void>(resolve => doc.defaultView!.setTimeout(resolve, 200));
          if (applicationChanged()) throw new Error('The application changed. Click Autofill on the new step.');
          scan = await scanApplication();
          protectExisting(scan);
        }
      }
      const after = scan;
      state.remaining = after.fields.flatMap<JobState['remaining'][number]>(field => {
        const { id, label, kind, value, status, reason, required } = field;
        const outcome = outcomes.get(id);
        if (status === 'preserved' && outcome?.status !== 'failed') return [];
        if (!inOriginalApplication(field, after)) return [{ id, label, status: 'unsupported', required, reason: 'A different form appeared during autofill. Click Autofill to start on this form.' }];
        // The engine represents an unchecked checkbox as blank on a fresh scan.
        if (outcome?.verifiedUnchecked && status === 'ready' && kind === 'checkbox' && value === false && !field.currentValue) return [];
        const failureReason = outcome?.status === 'failed' ? outcome.reason ?? 'The page could not accept the answer.'
          : outcome?.status === 'skipped' ? outcome.reason : undefined;
        const pausedReason = experiencePaused && field.workdayExperienceGroupId === originalExperienceGroup ? state.experienceMessage : undefined;
        return [{ id, label, status: failureReason || pausedReason ? 'unsupported' : status, reason: failureReason ?? pausedReason ?? reason, required }];
      });
      const liveIds = new Set(after.fields.map(field => field.id));
      for (const outcome of outcomes.values()) {
        if (outcome.status !== 'failed' || liveIds.has(outcome.id)) continue;
        // A replacement field has no trusted route back to the original attempt.
        state.remaining.push({ label: outcome.label, status: 'unsupported', required: outcome.required,
          reason: outcome.reason ?? 'The page could not accept the answer.' });
      }
      state.message = `${state.filled} filled · ${state.remaining.length} need attention${state.failed ? ` · ${state.failed} could not be filled` : ''}`;
    } catch (error) {
      state.message = error instanceof Error ? error.message : 'Could not fill this application.';
    } finally {
      state.running = false;
      if (applicationChanged()) resetStatus(state.message);
    }
  }
  return {
    start(profile, overwrite = false, interpretationRun, vaultRun, binding) {
      if (state.running || !matchesBinding(binding)) return false;
      if (binding && (interpretationRun && interpretationRun.topUrl !== binding.topUrl || vaultRun && vaultRun.topUrl !== binding.topUrl)) return false;
      if (!sameEmbeddedApplication(stateBinding, binding) || !matchesApplication(state.url, stateTopUrl, stateBinding)) resetStatus();
      stateBinding = binding;
      stateTopUrl = binding?.topUrl ?? interpretationRun?.topUrl ?? vaultRun?.topUrl ?? currentTopUrl();
      state = { ...state, url: doc.URL, running: true, started: true, filled: 0, failed: 0, aiFilled: 0, aiMessage: undefined, vaultFilled: 0, vaultMessage: undefined, experienceMessage: undefined, remaining: [], message: 'Filling your application…' };
      show();
      void run(profile, overwrite, interpretationRun, vaultRun);
      return true;
    },
    status(binding) {
      if (!sameEmbeddedApplication(stateBinding, binding) || !matchesBinding(binding)) return idleState();
      const current = matchesApplication(state.url, stateTopUrl, binding);
      if (!state.running && !current) resetStatus();
      return { ...state, undoAvailable: current && state.undoAvailable, remaining: state.remaining.map(field => ({ ...field })) };
    },
    async undo(binding) {
      if (state.running || !sameEmbeddedApplication(stateBinding, binding) || !matchesBinding(binding)) return;
      if (!matchesApplication(state.url, stateTopUrl, binding)) {
        resetStatus();
        return;
      }
      state.running = true;
      try {
        if (binding && !await validateBinding(binding)) { resetStatus('The embedded application changed.'); return; }
        if (!undoId) { state.undoAvailable = false; return; }
        const result = await engine.undo(undoId);
        if (binding && !await validateBinding(binding)) { resetStatus('The embedded application changed.'); return; }
        state.message = result.warning ?? `${result.restored} restored${result.skipped ? ` · ${result.skipped} kept` : ''}`;
        if (!result.warning) state.undoAvailable = false;
        state.remaining = [];
        state.aiMessage = undefined;
        state.vaultMessage = undefined;
        state.experienceMessage = undefined;
      } catch { state.message = 'Could not undo. The application may have changed.'; }
      finally { state.running = false; }
    },
    noteFill,
    focus(fieldId, binding) {
      if (!matchesBinding(binding)) return { focused: false, reason: 'The embedded application changed. Run Autofill again.' };
      if (state.running) return { focused: false, reason: 'Wait for Autofill to finish before locating a field.' };
      return engine.focus?.(fieldId) ?? { focused: false, reason: 'Reload this page to enable field navigation.' };
    },
    show,
  };
}
