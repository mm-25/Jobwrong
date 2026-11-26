import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVaultBroker } from '../../src/services/vault-jobs';
import { VAULT_CHANNEL } from '../../src/shared/vault';
import type { ExtensionAPI } from '../../src/services/extension-api';
import type { EmbeddedApplicationBinding } from '../../src/shared/jobs';

const { loadAISettings, draftVaultAnswers } = vi.hoisted(() => ({
  loadAISettings: vi.fn(), draftVaultAnswers: vi.fn(),
}));
vi.mock('../../src/services/storage', () => ({ loadAISettings }));
vi.mock('../../src/services/vault', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/services/vault')>(),
  draftVaultAnswers,
}));

const url = 'https://application.example/job';
const sender = { id: 'ext', url, frameId: 0, documentId: 'original', tab: { id: 21 } };
const extensionPage = { id: 'ext', url: 'chrome-extension://ext/popup.html' };
const sources = { channel: VAULT_CHANNEL, command: 'sources', tabId: 21, url };
const question = { id: 'field', label: 'Describe building a catalog', kind: 'text' };
const answer = { fieldId: 'field', answer: 'I built a catalog.', sourceIds: ['s1'] };
const receipts = [{ question: question.label, sources: [{ id: 's1', path: 'Catalog.md', heading: '', lineStart: 1, lineEnd: 2 }] }];

function setup() {
  loadAISettings.mockResolvedValue({ useVault: true, enabled: true, provider: 'anthropic', apiKey: 'synthetic' });
  draftVaultAnswers.mockResolvedValue({ answers: [answer], receipts });
  const get = vi.fn(async () => ({ id: 21, url }));
  const query = vi.fn(async () => [{ id: 21, url }]);
  const executeScript = vi.fn(async (_details?: { args?: unknown[] }): Promise<{ frameId: number; documentId?: string; result: unknown }[]> =>
    [{ frameId: 0, documentId: 'original', result: true }]);
  let stored: Record<string, unknown> = {};
  const session = {
    get: vi.fn(async () => structuredClone(stored)),
    set: vi.fn(async items => { stored = { ...stored, ...structuredClone(items) }; }),
    remove: vi.fn(async (key: string) => { delete stored[key]; }),
    setAccessLevel: vi.fn(async () => {}),
  };
  const api = { storage: { session }, runtime: { id: 'ext', getURL: (path: string) => 'chrome-extension://ext/' + path },
    tabs: { get, query }, scripting: { executeScript } } as unknown as ExtensionAPI;
  return { broker: createVaultBroker(api), api, session, get, query, executeScript };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('vault broker', () => {
  it('starts only for opted-in Claude users', async () => {
    const { broker } = setup();
    loadAISettings.mockResolvedValue({ useVault: false, enabled: true, provider: 'anthropic', apiKey: 'synthetic' });
    expect(await broker.begin(21, url)).toBeUndefined();
  });

  it('returns answers to the application and source metadata only to the extension UI for the active tab', async () => {
    const { broker, query } = setup();
    const run = await broker.begin(21, url);
    const draft = { channel: VAULT_CHANNEL, command: 'draft', run, url, questions: [question] };
    expect(await broker.handle(draft, sender)).toEqual({ answers: [answer] });
    expect(await broker.handle(sources, sender)).toMatchObject({ receipts: [], error: expect.any(String) });
    expect(await broker.handle(sources, { ...extensionPage, url: 'chrome-extension://ext/popup.html.fake' }))
      .toMatchObject({ receipts: [], error: expect.any(String) });
    expect(await broker.handle(sources, extensionPage)).toEqual({ receipts });

    query.mockResolvedValue([{ id: 22, url }]);
    expect(await broker.handle(sources, extensionPage)).toMatchObject({ receipts: [], error: expect.any(String) });
  });

  it('rejects malformed, stale or unauthorized requests before drafting', async () => {
    const { broker, executeScript } = setup();
    const run = await broker.begin(21, url);
    const draft = { channel: VAULT_CHANNEL, command: 'draft', run, url, questions: [question] };
    for (const invalid of [
      { ...sender, id: undefined }, { ...sender, tab: { id: 22 } }, { ...sender, frameId: -1 },
      { ...sender, url: 'https://different.example/job' },
    ]) expect(await broker.handle(draft, invalid)).toMatchObject({ answers: [], error: expect.any(String) });
    expect(await broker.handle({ ...draft, questions: [question, question] }, sender)).toMatchObject({ answers: [], error: expect.any(String) });

    executeScript.mockResolvedValue([{ frameId: 0, documentId: 'replacement', result: true }]);
    expect(await broker.handle(draft, sender)).toMatchObject({ answers: [], error: expect.any(String) });
    expect(draftVaultAnswers).not.toHaveBeenCalled();
  });

  it('drops draft results if the application changed during the request', async () => {
    const { broker, get } = setup();
    const run = await broker.begin(21, url);
    draftVaultAnswers.mockImplementationOnce(async () => {
      get.mockResolvedValue({ id: 21, url: url + '/replacement' });
      return { answers: [answer], receipts };
    });
    expect(await broker.handle({ channel: VAULT_CHANNEL, command: 'draft', run, url, questions: [question] }, sender))
      .toMatchObject({ answers: [], error: expect.any(String) });
  });

  it('withholds previously retrieved receipts after same-URL document replacement', async () => {
    const { broker, executeScript } = setup();
    const run = await broker.begin(21, url);
    const draft = { channel: VAULT_CHANNEL, command: 'draft', run, url, questions: [question] };
    await broker.handle(draft, sender);
    executeScript.mockResolvedValue([{ frameId: 0, documentId: 'replacement', result: true }]);

    expect(await broker.handle(sources, extensionPage)).toEqual({ receipts: [] });
  });

  it('keeps embedded drafts and provenance bound to the approved parent and child', async () => {
    const { broker, api, get, query, executeScript } = setup();
    const embedded: EmbeddedApplicationBinding = {
      tabId: 21, topUrl: url + '?gh_jid=1000', topDocumentId: 'top-original', topTimeOrigin: 100, iframeKey: 'iframe-original', iframeIndex: 0,
      frameId: 4, frameUrl: 'https://job-boards.greenhouse.io/embed/job_app?for=example&token=1000',
      documentId: 'child-original', frameTimeOrigin: 200, formKey: 'form-original',
    };
    const embeddedSender = { ...sender, frameId: embedded.frameId, url: embedded.frameUrl, documentId: embedded.documentId };
    const applicationTab = { id: embedded.tabId, url: embedded.topUrl };
    const top = { frameId: 0, documentId: embedded.topDocumentId, result: {
      frameUrl: embedded.frameUrl, iframeKey: embedded.iframeKey, iframeIndex: embedded.iframeIndex, timeOrigin: embedded.topTimeOrigin,
    } };
    const child = { frameId: embedded.frameId, documentId: embedded.documentId, result: {
      formKey: embedded.formKey, timeOrigin: embedded.frameTimeOrigin,
    } };
    get.mockResolvedValue(applicationTab);
    query.mockResolvedValue([applicationTab]);
    executeScript.mockImplementation(async details => [details?.args?.[0] === embedded.topUrl ? top : child]);
    const run = await broker.begin(embedded.tabId, embedded.topUrl, embedded);
    const draft = { channel: VAULT_CHANNEL, command: 'draft', run, url: embedded.frameUrl, questions: [question] };
    expect(await broker.handle(draft, { ...embeddedSender, documentId: 'unapproved' })).toMatchObject({ answers: [], error: expect.any(String) });
    expect(draftVaultAnswers).not.toHaveBeenCalled();
    expect(await broker.handle(draft, embeddedSender)).toEqual({ answers: [answer] });

    const restarted = createVaultBroker(api);
    const receiptRequest = { ...sources, url: embedded.topUrl };
    expect(await restarted.handle(receiptRequest, extensionPage)).toEqual({ receipts });
    top.result.iframeKey = 'iframe-replacement';
    expect(await restarted.handle(receiptRequest, extensionPage)).toEqual({ receipts: [] });
    expect(await broker.handle(draft, embeddedSender)).toMatchObject({ answers: [], error: expect.any(String) });
    expect(draftVaultAnswers).toHaveBeenCalledTimes(1);
  });

  it('clears prior sources and rejects the old ticket at each new start, even with vault use disabled', async () => {
    const { broker } = setup();
    const run = await broker.begin(21, url);
    const draft = { channel: VAULT_CHANNEL, command: 'draft', run, url, questions: [question] };
    await broker.handle(draft, sender);
    loadAISettings.mockResolvedValue({ useVault: false });
    expect(await broker.begin(21, url)).toBeUndefined();
    expect(await broker.handle(sources, extensionPage)).toEqual({ receipts: [] });
    expect(await broker.handle(draft, sender)).toMatchObject({ answers: [], error: expect.any(String) });
  });

  it('recovers metadata after a background restart and restricts it to the live document', async () => {
    const { broker, api, session, executeScript } = setup();
    const run = await broker.begin(21, url);
    await broker.handle({ channel: VAULT_CHANNEL, command: 'draft', run, url, questions: [question] }, sender);
    const restarted = createVaultBroker(api);
    expect(await restarted.handle(sources, extensionPage)).toEqual({ receipts });
    expect(session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(JSON.stringify(await session.get())).not.toContain(answer.answer);

    executeScript.mockResolvedValue([{ frameId: 0, documentId: 'replacement', result: true }]);
    expect(await restarted.handle(sources, extensionPage)).toEqual({ receipts: [] });
  });

  it('discards a pending answer when vault use is disabled during generation', async () => {
    const { broker } = setup();
    const run = await broker.begin(21, url);
    draftVaultAnswers.mockImplementationOnce(async () => {
      loadAISettings.mockResolvedValue({ useVault: false });
      return { answers: [answer], receipts };
    });
    expect(await broker.handle({ channel: VAULT_CHANNEL, command: 'draft', run, url, questions: [question] }, sender))
      .toMatchObject({ answers: [] });
    expect(await broker.handle(sources, extensionPage)).toEqual({ receipts: [] });
  });

  it('keeps a newer run’s sources when an older request completes afterward', async () => {
    const { broker, api } = setup();
    let finishOld!: (value: unknown) => void;
    let enteredOld!: () => void;
    const entered = new Promise<void>(resolve => { enteredOld = resolve; });
    draftVaultAnswers.mockImplementationOnce(() => new Promise(resolve => {
      finishOld = resolve;
      enteredOld();
    }));
    const oldRun = await broker.begin(21, url);
    const oldRequest = broker.handle({ channel: VAULT_CHANNEL, command: 'draft', run: oldRun, url, questions: [question] }, sender);
    await entered;

    const newerReceipts = [{ ...receipts[0], question: 'What did you build?' }];
    draftVaultAnswers.mockResolvedValueOnce({ answers: [answer], receipts: newerReceipts });
    const newRun = await broker.begin(21, url);
    await broker.handle({ channel: VAULT_CHANNEL, command: 'draft', run: newRun, url, questions: [question] }, sender);
    finishOld({ answers: [answer], receipts });
    expect(await oldRequest).toMatchObject({ answers: [] });
    expect(await createVaultBroker(api).handle(sources, extensionPage)).toEqual({ receipts: newerReceipts });
  });

  it('checks the legacy frame navigation time when document IDs are absent', async () => {
    const { broker, api, executeScript } = setup();
    const legacy = { ...sender, documentId: undefined };
    executeScript.mockImplementation(async () => [{ frameId: 0, result: 12345 }]);
    const run = await broker.begin(21, url);
    expect(await broker.handle({ channel: VAULT_CHANNEL, command: 'draft', run, url, questions: [question] }, legacy))
      .toEqual({ answers: [answer] });

    const restarted = createVaultBroker(api);
    expect(await restarted.handle(sources, extensionPage)).toEqual({ receipts });
    executeScript.mockImplementation(async () => [{ frameId: 0, result: 23456 }]);
    expect(await restarted.handle(sources, extensionPage)).toEqual({ receipts: [] });
  });

  it('limits repeat frame requests and expires cached receipts', async () => {
    vi.useFakeTimers();
    const { broker } = setup();
    const run = await broker.begin(21, url);
    const draft = { channel: VAULT_CHANNEL, command: 'draft', run, url, questions: [question] };
    await broker.handle(draft, sender);
    await broker.handle(draft, sender);
    expect(await broker.handle(draft, sender)).toMatchObject({ answers: [], error: expect.any(String) });
    expect(draftVaultAnswers).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(await broker.handle(sources, extensionPage)).toEqual({ receipts: [] });
  });
});
