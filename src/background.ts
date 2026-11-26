import {
  EMBEDDED_APPLICATION_CHANNEL, JOB_CHANNEL, type EmbeddedApplicationBinding, type EmbeddedApplicationReply,
  type EmbeddedApplicationRequest, type FieldFocusTarget, type JobReply, type JobRequest, type JobState,
} from './shared/jobs';
import { applicationFrameTarget, extensionAPI, readCurrentApplicationDocuments, senderMatchesApplicationUrl, type InjectionTarget, type MessageSender } from './services/extension-api';
import {
  isCurrentEmbeddedApplication, isGreenhouseEmbedUrl, isGreenhousePostingUrl, readEmbeddedApplication, senderMatchesEmbeddedApplication,
} from './services/application-frames';
import { loadProfile } from './services/storage';
import type { FieldFocusResult, Profile } from './shared/types';
import { createInterpretationBroker } from './services/interpretation-jobs';
import { INTERPRETATION_CHANNEL, type InterpretationResult, type InterpretationRun } from './shared/interpretation';
import { createVaultBroker } from './services/vault-jobs';
import { VAULT_CHANNEL, type VaultResult, type VaultRun, type VaultSourcesResult } from './shared/vault';

const api = extensionAPI();
const commands = new Set(['start', 'status', 'undo', 'options', 'show', 'focus']);
const interpretationBroker = createInterpretationBroker(api);
const vaultBroker = createVaultBroker(api);
const pendingStarts = new Map<number, { url: string; documentId?: string; reply: Promise<JobReply> }>();
const staleFocus: FieldFocusResult = { focused: false, reason: 'This field is no longer available. Run Autofill again to update the list.' };

function validFocusTarget(focus: FieldFocusTarget | undefined, url: string): focus is FieldFocusTarget {
  if (!focus || typeof focus.fieldId !== 'string' || !focus.fieldId.trim() || focus.fieldId.length > 160
    || !Number.isSafeInteger(focus.frameId) || focus.frameId < 0
    || typeof focus.frameUrl !== 'string' || !/^https?:\/\//.test(focus.frameUrl)
    || (focus.documentId !== undefined && (typeof focus.documentId !== 'string' || !focus.documentId || focus.documentId.length > 160))) return false;
  try {
    if (focus.frameId === 0) return focus.frameUrl === url;
    return new URL(focus.frameUrl).origin === new URL(url).origin || isGreenhouseEmbedUrl(focus.frameUrl);
  }
  catch { return false; }
}

async function focusApplicationField(tabId: number, url: string, focus: FieldFocusTarget, topDocumentId?: string): Promise<FieldFocusResult> {
  if (focus.frameId === 0 && topDocumentId && focus.documentId && focus.documentId !== topDocumentId) return staleFocus;
  const documentId = focus.documentId ?? (focus.frameId === 0 ? topDocumentId : undefined);
  const target: InjectionTarget = documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [focus.frameId] };
  try {
    if (documentId && (focus.frameId !== 0 || documentId !== topDocumentId)) {
      const documents = await readCurrentApplicationDocuments(api, target, url, focus.frameUrl);
      if (!documents.some(page => page.result && page.documentId === documentId && page.frameId === focus.frameId)) return staleFocus;
    }
    const [page] = await api.scripting.executeScript<FieldFocusResult | null>({
      target,
      func: (expectedTopUrl: string, expectedFrameUrl: string, fieldId: string) => {
        try {
          if (window.top?.location.href !== expectedTopUrl || window.document.URL !== expectedFrameUrl) return null;
        } catch { return null; }
        return globalThis.__jobrightPage?.focus?.(fieldId) ?? null;
      },
      args: [url, focus.frameUrl, focus.fieldId],
    });
    return page?.result ?? staleFocus;
  } catch { return staleFocus; }
}

export async function handleJob(message: unknown, sender: MessageSender): Promise<JobReply | InterpretationResult | VaultResult | VaultSourcesResult | EmbeddedApplicationReply> {
  if (!message || typeof message !== 'object') return { error: 'Invalid request.' };
  if ((message as { channel?: unknown }).channel === INTERPRETATION_CHANNEL) return interpretationBroker.handle(message, sender);
  if ((message as { channel?: unknown }).channel === VAULT_CHANNEL) return vaultBroker.handle(message, sender);
  if ((message as { channel?: unknown }).channel === EMBEDDED_APPLICATION_CHANNEL) {
    const { binding } = message as EmbeddedApplicationRequest;
    const valid = !!api.runtime.id && sender.id === api.runtime.id && senderMatchesEmbeddedApplication(binding, sender)
      && await isCurrentEmbeddedApplication(api, binding);
    return { valid };
  }
  const request = message as JobRequest;
  if (request.channel !== JOB_CHANNEL || !commands.has(request.command) || sender.id !== api.runtime.id) return { error: 'Invalid request.' };
  const extensionOrigin = api.runtime.getURL?.('');
  const fromExtension = !!extensionOrigin && !!sender.url?.startsWith(extensionOrigin);
  const fromPage = !fromExtension && sender.tab?.id !== undefined;
  if (!fromPage && !fromExtension) return { error: 'Invalid sender.' };
  if (typeof request.url !== 'string' || !/^https?:\/\//.test(request.url)) return { error: 'Open an application page first.' };
  if (fromPage && (sender.frameId !== 0 || !senderMatchesApplicationUrl(sender, request.url) || request.tabId !== undefined)) return { error: 'The application changed. Try again.' };
  const focus = request.command === 'focus' ? request.focus : undefined;
  if (request.command === 'focus' && !validFocusTarget(focus, request.url)) return { focus: staleFocus };
  const tabId = fromPage ? sender.tab!.id! : request.tabId;
  if (typeof tabId !== 'number' || !Number.isSafeInteger(tabId)) return { error: 'Application tab unavailable.' };
  const topDocumentId = fromPage ? sender.documentId : undefined;
  if (request.command !== 'start') return dispatchJob(request, tabId, topDocumentId);

  // Serialize capability issuance per tab. Requests that overlap a start still
  // validate their own browser document before receiving the current status.
  for (let prior = pendingStarts.get(tabId); prior; prior = pendingStarts.get(tabId)) {
    const reply = await prior.reply.catch(() => undefined);
    const priorDocumentId = reply?.states?.find(state => state.frameId === 0)?.documentId ?? prior.documentId;
    if (!reply?.error && prior.url === request.url && (!topDocumentId || !priorDocumentId || topDocumentId === priorDocumentId)) {
      return dispatchJob({ ...request, command: 'status' }, tabId, topDocumentId);
    }
  }
  const reply = dispatchJob(request, tabId, topDocumentId);
  pendingStarts.set(tabId, { url: request.url, documentId: topDocumentId, reply });
  try { return await reply; }
  finally { pendingStarts.delete(tabId); }
}

async function dispatchJob(request: JobRequest, tabId: number, topDocumentId?: string): Promise<JobReply> {
  const tab = await api.tabs.get!(tabId);
  if (tab.url !== request.url) return { error: 'The application changed. Try again.' };
  if (request.command !== 'options' && request.command !== 'show') {
    const binding = await readEmbeddedApplication(api, tabId, request.url, topDocumentId);
    if (binding && (!request.focus || request.focus.frameId === binding.frameId)) return dispatchEmbeddedJob(request, binding);
  }
  const expectedEmbed = isGreenhousePostingUrl(request.url);
  let warning = expectedEmbed && (request.command === 'start' || request.command === 'status')
    ? 'The embedded application could not be verified. Wait for it to load or open it in a separate tab.' : undefined;
  let topTarget: InjectionTarget = { tabId, frameIds: [0] };
  let target: InjectionTarget = expectedEmbed ? topTarget : { tabId, allFrames: true };
  if (topDocumentId) {
    topTarget = { tabId, documentIds: [topDocumentId] };
    const topOnly = request.command === 'options' || request.command === 'focus';
    const documents = await readCurrentApplicationDocuments(api, topOnly ? topTarget : target, request.url)
      .catch(() => {
        if (topOnly) return [];
        warning = 'An embedded form is inaccessible. Open that application in its own tab.';
        return readCurrentApplicationDocuments(api, topTarget, request.url).catch(() => []);
      });
    if (!documents.some(page => page.frameId === 0 && page.documentId === topDocumentId && page.result)) {
      return { error: 'The application changed. Try again.' };
    }
    const documentIds = documents.flatMap(page => page.documentId && page.result ? [page.documentId] : []);
    if (documentIds.length !== documents.length) warning ??= 'Some embedded frames could not be filled. Open the embedded application directly if fields are missing.';
    // Pin the dispatch to the validated documents, including across a reload at the same URL.
    target = { tabId, documentIds };
  }
  if (request.command === 'options') { await api.runtime.openOptionsPage(); return {}; }
  if (request.command === 'focus' && request.focus) return { focus: await focusApplicationField(tabId, request.url, request.focus, topDocumentId) };
  if (request.command === 'start' || request.command === 'show') {
    try { await api.scripting.executeScript({ target, files: ['content.js'] }); }
    catch {
      target = topTarget;
      await api.scripting.executeScript({ target, files: ['content.js'] });
      warning = 'An embedded form is inaccessible. Open that application in its own tab.';
    }
  }
  const execute = (
    target: InjectionTarget, command = request.command, profile: Profile | null = null,
    interpretationRun?: InterpretationRun, vaultRun?: VaultRun,
  ) => api.scripting.executeScript<JobState | null>({
    target,
    func: (command: string, data: Profile | null, overwrite: boolean, expectedUrl: string, run: InterpretationRun | null, notesRun: VaultRun | null) => {
      // Each document owns its operation; no active-tab lookup after initiation.
      try { if (window.top?.location.href !== expectedUrl) return null; }
      catch { return null; }
      const controller = globalThis.__jobrightPage;
      if (!controller) return null;
      if (command === 'start' && data) controller.start(data, overwrite, run ?? undefined, notesRun ?? undefined);
      else if (command === 'undo') void controller.undo();
      else if (command === 'show') controller.show();
      return controller.status();
    }, args: [command, profile, request.overwrite === true, request.url, interpretationRun ?? null, vaultRun ?? null],
  });
  const formatResults = (results: Awaited<ReturnType<typeof execute>>): JobReply => {
    const states = results.flatMap(result => result.result ? [{ ...result.result, frameId: result.frameId, documentId: result.documentId }] : []);
    if (results.some(result => !result.result)) warning ??= 'Some embedded frames could not be filled. Open the embedded application directly if fields are missing.';
    if (!states.length) return { error: 'Reload this application page after updating the extension.' };
    return { states, warning };
  };
  let results;
  try {
    if (request.command === 'start') {
      const observed = await execute(target, 'status');
      if (observed.some(page => page.result?.running) || !observed.some(page => page.result)) return formatResults(observed);
      const profile = await loadProfile();
      const [interpretationRun, vaultRun] = await Promise.all([
        interpretationBroker.begin(tabId, request.url), vaultBroker.begin(tabId, request.url),
      ]);
      results = await execute(target, 'start', profile, interpretationRun, vaultRun);
    } else {
      results = await execute(target);
    }
  } catch {
    // Never retry a mutation: it may already have started in another frame.
    if (request.command !== 'status') throw new Error('Could not reach all application frames. Check the on-page panel before trying again.');
    results = await execute(topTarget);
    warning = 'An embedded form is inaccessible. Open that application in its own tab.';
  }
  return formatResults(results);
}

async function dispatchEmbeddedJob(request: JobRequest, binding: EmbeddedApplicationBinding): Promise<JobReply> {
  const changed = { error: 'The embedded application changed. Try again.' };
  const target = applicationFrameTarget(binding.tabId, binding.frameId, binding.documentId);
  if (request.command === 'focus') {
    const focus = request.focus;
    if (!focus || focus.frameUrl !== binding.frameUrl || focus.documentId !== binding.documentId) return { focus: staleFocus };
    const pages = await api.scripting.executeScript<FieldFocusResult | null>({
      target,
      func: (fieldId: string, scope: EmbeddedApplicationBinding) => {
        if (!globalThis.__jobrightMatchesEmbeddedFrame?.(scope)) return null;
        return globalThis.__jobrightPage?.focus?.(fieldId, scope) ?? null;
      },
      args: [focus.fieldId, binding],
    }).catch(() => []);
    return { focus: pages.find(page => page.frameId === binding.frameId && page.documentId === binding.documentId)?.result ?? staleFocus };
  }
  const execute = async (command: 'start' | 'status' | 'undo', profile: Profile | null = null, run?: InterpretationRun, vaultRun?: VaultRun) => {
    const pages = await api.scripting.executeScript<JobState | null>({
      target,
      func: (
        command: string, scope: EmbeddedApplicationBinding, data: Profile | null, overwrite: boolean,
        run: InterpretationRun | null, notesRun: VaultRun | null,
      ) => {
        if (!globalThis.__jobrightMatchesEmbeddedFrame?.(scope)) return null;
        const controller = globalThis.__jobrightPage;
        if (!controller) return null;
        if (command === 'start' && data) {
          globalThis.__jobrightEmbeddedBinding = scope;
          controller.start(data, overwrite, run ?? undefined, notesRun ?? undefined, scope);
        }
        if (command === 'undo') void controller.undo(scope);
        return controller.status(scope);
      },
      args: [command, binding, profile, request.overwrite === true, run ?? null, vaultRun ?? null],
    }).catch(() => []);
    return pages.find(page => page.frameId === binding.frameId && page.documentId === binding.documentId)?.result;
  };
  let state: JobState | null | undefined;
  if (request.command === 'start') {
    state = await execute('status');
    if (state && !state.running) {
      const profile = await loadProfile();
      const [run, vaultRun] = await Promise.all([
        interpretationBroker.begin(binding.tabId, binding.topUrl, binding),
        vaultBroker.begin(binding.tabId, binding.topUrl, binding),
      ]);
      if (!await isCurrentEmbeddedApplication(api, binding)) return changed;
      state = await execute('start', profile, run, vaultRun);
    }
  } else if (request.command === 'status' || request.command === 'undo') state = await execute(request.command);
  return state ? { states: [{ ...state, frameId: binding.frameId, documentId: binding.documentId }] } : changed;
}

api.runtime.onMessage?.addListener((message, sender, respond) => {
  if (!message || typeof message !== 'object'
    || ![JOB_CHANNEL, INTERPRETATION_CHANNEL, VAULT_CHANNEL, EMBEDDED_APPLICATION_CHANNEL].includes((message as JobRequest).channel)) return;
  void handleJob(message, sender).then(respond, error => respond({ error: error instanceof Error ? error.message : 'Could not access this application.' }));
  return true;
});
