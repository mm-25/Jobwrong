import {
  VAULT_CHANNEL, type VaultReceipt, type VaultRequest, type VaultResult, type VaultRun,
  type VaultSourcesRequest, type VaultSourcesResult,
} from '../shared/vault';
import type { EmbeddedApplicationBinding } from '../shared/jobs';
import { isCurrentEmbeddedApplication, senderMatchesEmbeddedApplication } from './application-frames';
import {
  readCurrentApplicationDocuments, senderMatchesApplicationUrl,
  type ExtensionAPI, type MessageSender,
} from './extension-api';
import { loadAISettings } from './storage';
import { draftVaultAnswers, validVaultQuestions, vaultEnabled } from './vault';

const RUN_TIME = 120_000;
const RECEIPT_TIME = 300_000;
const MAX_TABS = 32;
const SESSION_KEY = 'jobright-vault-source-receipts-v1';
const MAX_REQUESTS = 4;
const MAX_FRAME_REQUESTS = 2;
const stale = 'Obsidian answers require a current Autofill run.';
const unavailable = (error: string): VaultResult => ({ answers: [], error });

interface DocumentBinding { frameId: number; documentId?: string; timeOrigin?: number; url: string; embedded?: EmbeddedApplicationBinding }
interface ReceiptFrame extends DocumentBinding { receipts: VaultReceipt[] }
interface StoredReceipts { tabId: number; url: string; expires: number; frames: ReceiptFrame[] }
interface FrameBudget extends DocumentBinding {
  requests: number;
  receipts: VaultReceipt[];
}
interface Ticket {
  token: string;
  url: string;
  expires: number;
  requests: number;
  frames: Map<number, FrameBudget>;
  failed: boolean;
  timer: ReturnType<typeof setTimeout>;
  embedded?: EmbeddedApplicationBinding;
}

function applicationOrigin(url: unknown): string | undefined {
  if (typeof url !== 'string' || url.length > 16_000) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.origin;
  } catch { return; }
}

function extensionSourcePage(api: ExtensionAPI, sender: MessageSender): boolean {
  if (!api.runtime.id || sender.id !== api.runtime.id || !sender.url || !api.runtime.getURL) return false;
  const path = sender.url.split(/[?#]/, 1)[0];
  return path === api.runtime.getURL('popup.html') || path === api.runtime.getURL('options.html');
}

/** Issues one short-lived capability per tab after an authorized Autofill start. */
export function createVaultBroker(api: ExtensionAPI) {
  const tickets = new Map<number, Ticket>();
  const session = api.storage?.session;
  let sessionReady: Promise<void> | undefined;
  let sessionQueue = Promise.resolve();

  function withSession<T>(operation: (storage: NonNullable<ExtensionAPI['storage']['session']>) => Promise<T>): Promise<T | undefined> {
    if (!session) return Promise.resolve(undefined);
    const result = sessionQueue.then(async () => {
      sessionReady ??= Promise.resolve(session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }));
      await sessionReady;
      return operation(session);
    }).catch(() => undefined); // Session failures leave the current run and its in-memory sources usable.
    sessionQueue = result.then(() => {});
    return result;
  }

  async function readReceipts(storage: NonNullable<ExtensionAPI['storage']['session']>): Promise<StoredReceipts[]> {
    const value = (await storage.get(SESSION_KEY))[SESSION_KEY];
    return Array.isArray(value) ? value.filter(entry => entry?.expires > Date.now()).slice(-MAX_TABS) : [];
  }

  function clearReceipts(tabId: number) {
    return withSession(async storage => {
      const entries = (await readReceipts(storage)).filter(entry => entry.tabId !== tabId);
      if (entries.length) await storage.set({ [SESSION_KEY]: entries });
      else await storage.remove(SESSION_KEY);
    });
  }

  function persistReceipts(tabId: number, ticket: Ticket) {
    return withSession(async storage => {
      const previous = (await readReceipts(storage)).filter(entry => entry.tabId !== tabId);
      if (!currentRun(tabId, ticket)) return;
      const frames = [...ticket.frames.values()].flatMap(({ frameId, documentId, timeOrigin, url, receipts, embedded }) =>
        (documentId || timeOrigin || embedded) && receipts.length ? [{ frameId, documentId, timeOrigin, url, receipts, embedded }] : []);
      if (!frames.length) {
        if (previous.length) await storage.set({ [SESSION_KEY]: previous });
        else await storage.remove(SESSION_KEY);
        return;
      }
      const entry: StoredReceipts = { tabId, url: ticket.url, expires: ticket.expires + RECEIPT_TIME, frames };
      await storage.set({ [SESSION_KEY]: [...previous, entry].slice(-MAX_TABS) });
    });
  }

  function remove(tabId: number) {
    const previous = tickets.get(tabId);
    if (previous) clearTimeout(previous.timer);
    tickets.delete(tabId);
  }

  function currentRun(tabId: number, ticket: Ticket): boolean {
    return tickets.get(tabId) === ticket && Date.now() < ticket.expires;
  }

  async function currentDocument(tabId: number, topUrl: string, binding: DocumentBinding): Promise<boolean> {
    if (binding.embedded) return binding.embedded.tabId === tabId && binding.embedded.topUrl === topUrl
      && binding.embedded.frameId === binding.frameId && binding.embedded.frameUrl === binding.url
      && binding.embedded.documentId === binding.documentId && await isCurrentEmbeddedApplication(api, binding.embedded);
    if (binding.documentId) {
      const documents = await readCurrentApplicationDocuments(api, {
        tabId, documentIds: [binding.documentId],
      }, topUrl, binding.url).catch(() => []);
      return documents.some(page => page.result && page.frameId === binding.frameId && page.documentId === binding.documentId);
    }
    // Older browsers omit document IDs. Bind their live frame to its navigation time.
    const frames = await api.scripting.executeScript<number | null>({
      target: { tabId, frameIds: [binding.frameId] },
      func: (expectedTop: string, expectedFrame: string) => {
        try {
          return window.top?.location.href === expectedTop && window.location.href === expectedFrame
            ? performance.timeOrigin : null;
        } catch { return null; }
      },
      args: [topUrl, binding.url],
    }).catch(() => []);
    const timeOrigin = frames.find(frame => frame.frameId === binding.frameId)?.result;
    if (typeof timeOrigin !== 'number' || !Number.isFinite(timeOrigin) || timeOrigin <= 0) return false;
    binding.timeOrigin ??= timeOrigin;
    return timeOrigin === binding.timeOrigin;
  }

  async function sources(request: VaultSourcesRequest, sender: MessageSender): Promise<VaultSourcesResult> {
    const denied = { receipts: [], error: 'Obsidian sources are available from the extension for the current application tab.' };
    if (!extensionSourcePage(api, sender) || !Number.isSafeInteger(request.tabId) || request.tabId < 0
      || !applicationOrigin(request.url)) return denied;
    try {
      const active = async () => (await api.tabs.query({ active: true, currentWindow: true }))
        .some(tab => tab.id === request.tabId && tab.url === request.url);
      if (!await active()) return denied;
      const observedTicket = tickets.get(request.tabId);
      if (!vaultEnabled(await loadAISettings())) {
        if (tickets.get(request.tabId) === observedTicket) {
          remove(request.tabId);
          await clearReceipts(request.tabId);
        }
        return { receipts: [] };
      }
      const ticket = tickets.get(request.tabId);
      const saved = ticket ? {
        url: ticket.url, expires: ticket.expires + RECEIPT_TIME, frames: [...ticket.frames.values()],
      } : await withSession(async storage => (await readReceipts(storage)).find(entry => entry.tabId === request.tabId));
      if (!saved || saved.url !== request.url || Date.now() >= saved.expires) return { receipts: [] };
      const frames = saved.frames.filter(frame => frame.receipts.length);
      const receiptBatches = await Promise.all(frames.map(async frame =>
        await currentDocument(request.tabId, saved.url, frame) ? frame.receipts : []));
      if (!await active() || tickets.get(request.tabId) !== ticket || Date.now() >= saved.expires
        || !vaultEnabled(await loadAISettings())) return denied;
      return { receipts: receiptBatches.flat() };
    } catch { return denied; }
  }

  async function draft(request: VaultRequest, sender: MessageSender): Promise<VaultResult> {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    if (!api.runtime.id || sender.id !== api.runtime.id
      || typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0
      || typeof frameId !== 'number' || !Number.isSafeInteger(frameId) || frameId < 0
      || (sender.documentId !== undefined && (typeof sender.documentId !== 'string' || !sender.documentId || sender.documentId.length > 160))) {
      return unavailable(stale);
    }
    const ticket = tickets.get(tabId);
    const frameOrigin = applicationOrigin(request.url);
    const allowedFrame = ticket?.embedded
      ? request.url === ticket.embedded.frameUrl && senderMatchesEmbeddedApplication(ticket.embedded, sender)
      : frameOrigin && frameOrigin === applicationOrigin(ticket?.url) && (frameId !== 0 || ticket?.url === request.url);
    if (!ticket || !currentRun(tabId, ticket) || request.run?.token !== ticket.token || request.run.topUrl !== ticket.url
      || !allowedFrame || !senderMatchesApplicationUrl(sender, request.url)) return unavailable(stale);
    if (!validVaultQuestions(request.questions)) return unavailable('These questions cannot be drafted in one Obsidian request.');
    const binding = { frameId, documentId: sender.documentId, url: request.url, embedded: ticket.embedded };
    const frame = ticket.frames.get(frameId) ?? { ...binding, receipts: [], requests: 0 };
    if (frame.documentId !== binding.documentId || frame.url !== binding.url) return unavailable(stale);
    if (ticket.failed || ticket.requests >= MAX_REQUESTS || frame.requests >= MAX_FRAME_REQUESTS) {
      return unavailable('Obsidian drafting paused for this run. Local answers are still available.');
    }
    // Reserve budget before asynchronous checks so concurrent frames share the same limits.
    ticket.requests++;
    frame.requests++;
    ticket.frames.set(frameId, frame);
    const live = async () => (await api.tabs.get!(tabId)).url === ticket.url
      && await currentDocument(tabId, ticket.url, frame) && currentRun(tabId, ticket);
    try {
      const settings = await loadAISettings();
      if (!vaultEnabled(settings) || ticket.failed || !await live() || ticket.failed) return unavailable(stale);
      const maySend = async () => {
        const current = await loadAISettings();
        return vaultEnabled(current) && current.apiKey === settings.apiKey && current.model === settings.model
          && !ticket.failed && await live();
      };
      const result = await draftVaultAnswers(request.questions, settings, maySend);
      if (!await maySend()) return unavailable('The application or Obsidian settings changed while drafting.');
      if (result.error) ticket.failed = true;
      if (result.receipts?.length) {
        const accepted = new Set(result.receipts);
        frame.receipts.push(...accepted);
        await persistReceipts(tabId, ticket);
        if (!await maySend()) {
          frame.receipts = frame.receipts.filter(receipt => !accepted.has(receipt));
          await persistReceipts(tabId, ticket);
          return unavailable('The application or Obsidian settings changed while drafting.');
        }
      }
      return { answers: result.answers, ...(result.error ? { error: result.error } : {}) };
    } catch {
      ticket.failed = true;
      return unavailable('Obsidian drafting is unavailable. Local answers are still available.');
    }
  }

  return {
    async begin(tabId: number, url: string, embedded?: EmbeddedApplicationBinding): Promise<VaultRun | undefined> {
      // A new click immediately revokes older capabilities and clears prior provenance.
      if (!Number.isSafeInteger(tabId) || tabId < 0) return;
      remove(tabId);
      const cleared = clearReceipts(tabId);
      if (!applicationOrigin(url)) return;
      while (tickets.size >= MAX_TABS) {
        const oldest = tickets.keys().next().value;
        if (oldest !== undefined) remove(oldest);
      }
      try {
        const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        const ticket: Ticket = {
          token, url, expires: Date.now() + RUN_TIME, requests: 0, frames: new Map(), failed: false, embedded,
          timer: setTimeout(() => remove(tabId), RUN_TIME + RECEIPT_TIME),
        };
        tickets.set(tabId, ticket);
        const [, settings] = await Promise.all([cleared, loadAISettings().catch(() => undefined)]);
        if (!currentRun(tabId, ticket)) return;
        if (!settings || !vaultEnabled(settings)) {
          remove(tabId);
          return;
        }
        return { token, topUrl: url };
      } catch { return; }
    },
    async handle(message: unknown, sender: MessageSender): Promise<VaultResult | VaultSourcesResult> {
      if (!message || typeof message !== 'object') return unavailable(stale);
      const request = message as VaultRequest | VaultSourcesRequest;
      if (request.channel !== VAULT_CHANNEL) return unavailable(stale);
      if (request.command === 'sources') return sources(request, sender);
      return request.command === 'draft' ? draft(request, sender) : unavailable(stale);
    },
  };
}
