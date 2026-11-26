import { INTERPRETATION_CHANNEL, type InterpretationRequest, type InterpretationResult, type InterpretationRun } from '../shared/interpretation';
import type { EmbeddedApplicationBinding } from '../shared/jobs';
import { isCurrentEmbeddedApplication, senderMatchesEmbeddedApplication } from './application-frames';
import { readCurrentApplicationDocuments, senderMatchesApplicationUrl, type ExtensionAPI, type MessageSender } from './extension-api';
import { interpretQuestions } from './interpretation';
import { loadAISettings } from './storage';

interface Ticket { tabId: number; url: string; expires: number; requests: number; frames: Map<number, number>; failed: boolean; embedded?: EmbeddedApplicationBinding }
const unavailable = (error: string): InterpretationResult => ({ meanings: [], error });

/** Tokens are issued only by an already-authorized explicit Autofill start. */
export function createInterpretationBroker(api: ExtensionAPI) {
  const tickets = new Map<string, Ticket>();
  function prune() {
    for (const [token, ticket] of tickets) if (ticket.expires <= Date.now()) tickets.delete(token);
    while (tickets.size > 32) tickets.delete(tickets.keys().next().value!);
  }
  return {
    async begin(tabId: number, url: string, embedded?: EmbeddedApplicationBinding): Promise<InterpretationRun | undefined> {
      prune();
      try {
        const settings = await loadAISettings();
        if (!settings.enabled || !settings.apiKey || settings.interpretQuestions === false) return;
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        tickets.set(token, { tabId, url, expires: Date.now() + 120_000, requests: 0, frames: new Map(), failed: false, embedded });
        return { token, topUrl: url };
      } catch { return; } // Invalid AI settings never disable local Autofill.
    },
    async handle(message: unknown, sender: MessageSender): Promise<InterpretationResult> {
      prune();
      if (!message || typeof message !== 'object') return unavailable('Invalid AI matching request.');
      const request = message as InterpretationRequest;
      const token = request.run?.token;
      const ticket = typeof token === 'string' ? tickets.get(token) : undefined;
      if (request.channel !== INTERPRETATION_CHANNEL || !ticket || sender.id !== api.runtime.id
        || sender.tab?.id !== ticket.tabId || !Number.isSafeInteger(sender.frameId) || sender.frameId! < 0
        || request.run.topUrl !== ticket.url || !senderMatchesApplicationUrl(sender, request.url)) return unavailable('AI matching requires a current Autofill run.');
      try {
        const allowedFrame = ticket.embedded
          ? request.url === ticket.embedded.frameUrl && senderMatchesEmbeddedApplication(ticket.embedded, sender)
          : /^https?:\/\//.test(request.url) && new URL(request.url).origin === new URL(ticket.url).origin;
        if (!allowedFrame || (await api.tabs.get!(ticket.tabId)).url !== ticket.url) {
          return unavailable('The application changed before AI matching.');
        }
      } catch { return unavailable('The application is unavailable for AI matching.'); }
      const questions = request.questions;
      const kinds = new Set(['text', 'select', 'radio', 'checkbox', 'combobox']);
      let size = 0;
      if (!Array.isArray(questions) || questions.length < 1 || questions.length > 20 || !questions.every(question => {
        if (!question || typeof question.id !== 'string' || question.id.length > 160 || !question.id
          || typeof question.label !== 'string' || !question.label.trim() || question.label.length > 2000 || !kinds.has(question.kind)
          || (question.context !== undefined && (typeof question.context !== 'string' || question.context.length > 1000))
          || (question.options !== undefined && (!Array.isArray(question.options) || question.options.length > 100
            || question.options.some(option => typeof option !== 'string' || option.length > 500)))) return false;
        size += question.label.length + (question.context?.length ?? 0) + (question.options?.reduce((sum, option) => sum + option.length, 0) ?? 0);
        return true;
      }) || new Set(questions.map(question => question.id)).size !== questions.length || size > 80_000) return unavailable('These questions cannot be matched in one request.');
      const frame = sender.frameId!;
      if (ticket.failed || ticket.requests >= 4 || (ticket.frames.get(frame) ?? 0) >= 2) return unavailable('AI matching paused for this run. Local answers are still available.');
      // Reserve the budget before awaiting the provider to bound concurrent frames.
      ticket.requests++;
      ticket.frames.set(frame, (ticket.frames.get(frame) ?? 0) + 1);
      const documentId = sender.documentId;
      const isCurrentDocument = async () => ticket.embedded ? isCurrentEmbeddedApplication(api, ticket.embedded)
        : !documentId || (await readCurrentApplicationDocuments(api, {
          tabId: ticket.tabId, documentIds: [documentId],
        }, ticket.url, request.url).catch(() => [])).some(page => page.documentId === documentId && page.frameId === frame && page.result);
      try {
        const settings = await loadAISettings();
        const currentDocument = await isCurrentDocument();
        const currentTab = await api.tabs.get!(ticket.tabId);
        if (tickets.get(token) !== ticket || ticket.expires <= Date.now() || ticket.failed || currentTab.url !== ticket.url || !currentDocument) {
          return unavailable('The application changed or AI matching paused before the request.');
        }
        const result = await interpretQuestions(questions, settings);
        if (result.error) ticket.failed = true;
        if (!await isCurrentDocument() || (await api.tabs.get!(ticket.tabId)).url !== ticket.url || ticket.expires <= Date.now()) return unavailable('The application changed during AI matching.');
        return result;
      } catch {
        ticket.failed = true;
        return unavailable('AI matching is unavailable. Local answers are still available.');
      }
    },
  };
}
