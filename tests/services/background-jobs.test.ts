import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageSender } from '../../src/services/extension-api';
import { JOB_CHANNEL, type JobRequest, type JobState } from '../../src/shared/jobs';
import { emptyProfile } from '../../src/shared/profile';
import type { FieldFocusResult, Profile } from '../../src/shared/types';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { VAULT_CHANNEL, type VaultResult, type VaultRun } from '../../src/shared/vault';
import { INTERPRETATION_CHANNEL, type InterpretationRun } from '../../src/shared/interpretation';

const extensionId = 'jobright-fixture';
const url = 'https://jobs.example.test/apply';
const sender: MessageSender = { id: extensionId, url, frameId: 0, tab: { id: 9, url } };
const request = (command: JobRequest['command']): JobRequest => ({ channel: JOB_CHANNEL, command, url });
const waiting: JobState = {
  url, running: false, started: false, filled: 0, failed: 0, undoAvailable: false,
  message: 'Ready to fill.', remaining: [],
};
const reportedState: JobState = { ...waiting, frameId: 0, documentId: 'original-document' };
type InjectedValue = JobState | FieldFocusResult | boolean | null;

interface Injection {
  target: { tabId: number; allFrames?: boolean; frameIds?: number[]; documentIds?: string[] };
  files?: string[];
  func?: (...args: unknown[]) => InjectedValue;
  args?: unknown[];
}

interface Result { frameId: number; documentId?: string; result?: InjectedValue }

function createBoundary() {
  const profile = { ...emptyProfile(), applicationDefaults: {}, apiKey: 'legacy-inline-secret' };
  profile.personal.firstName = 'Lin';
  const stored: Record<string, unknown> = {
    'jobright.profile.v1': profile,
    'jobright.application-defaults.revision': 6,
    'jobright.ai.v1': { apiKey: 'separate-provider-secret' },
  };
  const state = { tabUrl: url, documentUrl: url, documentId: 'original-document', activeTab: 9 };
  const controller = {
    start: vi.fn((_profile: Profile, _overwrite: boolean, _run?: InterpretationRun, _vaultRun?: VaultRun) => true),
    undo: vi.fn(async () => {}),
    focus: vi.fn((_fieldId: string): FieldFocusResult => ({ focused: true })),
    show: vi.fn(),
    status: vi.fn(() => waiting),
  };
  function invoke(details: Injection, frameWindow: { top: { location: { href: string } }; location?: { href: string; origin: string }; document?: { URL: string } } = {
    top: { location: { href: state.documentUrl } }, location: { href: state.documentUrl, origin: new URL(state.documentUrl).origin }, document: { URL: state.documentUrl },
  }) {
    if (!details.func) throw new Error('Expected an injected callback.');
    const run = new Function('window', 'globalThis', 'args', `return (${details.func})(...args);`);
    return run(frameWindow, { __jobrightPage: controller }, details.args) as InjectedValue;
  }
  const execute = async (details: Injection): Promise<Result[]> => {
    if (details.target.documentIds && !details.target.documentIds.includes(state.documentId)) throw new Error('No document with that ID');
    if (details.files) {
      state.activeTab = 10;
      return [{ frameId: 0, documentId: state.documentId }];
    }
    if (details.args?.some(value => value === undefined)) throw new Error('Chrome scripting arguments must be JSON-serializable.');
    return [{ frameId: 0, documentId: state.documentId, result: invoke(details) }];
  };
  const executeScript = vi.fn(execute);
  const getStorage = vi.fn(async (keys: string | string[]) => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]]),
  ));
  const getTab = vi.fn(async (id: number) => ({ id, url: state.tabUrl }));
  const activeTab = vi.fn(async () => [{ id: state.activeTab, url: state.tabUrl }]);
  const api = {
    runtime: { id: extensionId, getURL: (path: string) => `chrome-extension://${extensionId}/${path}` },
    storage: { local: { get: getStorage } },
    tabs: { get: getTab, query: activeTab },
    scripting: { executeScript },
  };
  return { api, state, stored, controller, execute, executeScript, getStorage, getTab, activeTab, invoke };
}

let boundary: ReturnType<typeof createBoundary>;
let handleJob: typeof import('../../src/background').handleJob;

beforeEach(async () => {
  vi.resetModules();
  boundary = createBoundary();
  vi.stubGlobal('browser', boundary.api);
  ({ handleJob } = await import('../../src/background'));
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('background question interpretation authorization', () => {
  async function authorize() {
    boundary.stored['jobright.ai.v1'] = { provider: 'anthropic', enabled: true, apiKey: 'fixture-provider-secret', model: 'claude-sonnet-5-5', interpretQuestions: true };
    Object.assign(boundary.api, { permissions: { contains: async () => true } });
    await handleJob(request('start'), sender);
    return boundary.controller.start.mock.calls.at(-1)?.[2];
  }
  const classifyRequest = (run: InterpretationRun | undefined) => ({
    channel: INTERPRETATION_CHANNEL, run, url,
    questions: [{ id: 'field-moving', label: 'Is moving for this position off the table?', kind: 'text' }],
  });
  const response = () => new Response(JSON.stringify({
    type: 'message', role: 'assistant', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ meanings: [{ fieldId: 'q1', fact: 'relocation', inverse: true, country: null, confidence: 'high', evidence: 'moving for this position off the table' }] }) }],
  }));

  it('allows only an authorized job to request meanings without injecting provider settings', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => response());
    vi.stubGlobal('fetch', fetcher);
    const run = await authorize();
    expect(run?.topUrl).toBe(url);
    expect(run?.token).toMatch(/^[a-f0-9]{32}$/);
    expect(await handleJob(classifyRequest(run), sender)).toMatchObject({ meanings: [{ fieldId: 'field-moving', fact: 'relocation', inverse: true }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(boundary.executeScript.mock.calls)).not.toContain('fixture-provider-secret');
    expect(String(fetcher.mock.calls[0][1].body)).not.toContain('fixture-provider-secret');
    expect(String(fetcher.mock.calls[0][1].body)).not.toContain('Lin');
  });

  it('matches questions after a same-document URL update and rejects a replacement document', async () => {
    const currentUrl = url + '?tracking=fixture';
    const documentSender = { ...sender, documentId: boundary.state.documentId };
    boundary.state.tabUrl = boundary.state.documentUrl = currentUrl;
    boundary.stored['jobright.ai.v1'] = { provider: 'anthropic', enabled: true, apiKey: 'fixture-key', interpretQuestions: true };
    Object.assign(boundary.api, { permissions: { contains: async () => true } });
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetcher);

    await handleJob({ ...request('start'), url: currentUrl }, documentSender);
    const run = boundary.controller.start.mock.calls.at(-1)?.[2];
    const message = { ...classifyRequest(run), url: currentUrl };
    expect(await handleJob(message, documentSender)).toMatchObject({ meanings: [{ fieldId: 'field-moving', fact: 'relocation' }] });
    boundary.state.documentId = 'replacement-document';
    expect(await handleJob(message, documentSender)).toMatchObject({ error: expect.any(String) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects changed tabs, foreign frames, missing and expired tokens before calling a provider', async () => {
    const fetcher = vi.fn(async () => response()); vi.stubGlobal('fetch', fetcher);
    const run = await authorize();
    const message = classifyRequest(run);
    expect(await handleJob(classifyRequest(undefined), sender)).toMatchObject({ error: expect.any(String) });
    expect(await handleJob(message, { ...sender, id: 'foreign' })).toMatchObject({ error: expect.any(String) });
    expect(await handleJob(message, { ...sender, tab: { id: 10, url } })).toMatchObject({ error: expect.any(String) });
    expect(await handleJob({ ...message, url: 'https://foreign.test/form' }, { ...sender, url: 'https://foreign.test/form', frameId: 2 })).toMatchObject({ error: expect.any(String) });
    boundary.state.tabUrl = url + '/replaced';
    expect(await handleJob(message, sender)).toMatchObject({ error: expect.any(String) });
    boundary.state.tabUrl = url;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 180_000);
    expect(await handleJob(message, sender)).toMatchObject({ error: expect.any(String) });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds provider requests per frame and starts a fresh budget on the next user run', async () => {
    const fetcher = vi.fn(async () => response()); vi.stubGlobal('fetch', fetcher);
    const run = await authorize();
    expect(await handleJob(classifyRequest(run), sender)).toMatchObject({ meanings: expect.any(Array) });
    expect(await handleJob(classifyRequest(run), sender)).toMatchObject({ meanings: expect.any(Array) });
    expect(await handleJob(classifyRequest(run), sender)).toMatchObject({ error: expect.any(String) });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const next = await authorize();
    expect(next?.token).not.toBe(run?.token);
    await handleJob(classifyRequest(next), sender);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not repeat failed provider requests during a job', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 })); vi.stubGlobal('fetch', fetcher);
    const run = await authorize();
    expect(await handleJob(classifyRequest(run), sender)).toMatchObject({ error: expect.any(String), meanings: [] });
    expect(await handleJob(classifyRequest(run), sender)).toMatchObject({ error: expect.any(String) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['navigation', 'expiry', 'other-frame failure'])('rechecks %s after a deferred settings read before sending questions', async scenario => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 })); vi.stubGlobal('fetch', fetcher);
    const run = await authorize();
    let release!: (value: Record<string, unknown>) => void;
    boundary.getStorage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = handleJob(classifyRequest(run), sender);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (scenario === 'navigation') boundary.state.tabUrl = url + '/replaced';
    else if (scenario === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 180_000);
    else {
      await handleJob(classifyRequest(run), { ...sender, frameId: 2 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      fetcher.mockClear();
    }
    release({ 'jobright.ai.v1': boundary.stored['jobright.ai.v1'] });
    expect(await pending).toMatchObject({ error: expect.any(String) });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('background Autofill requests', () => {
  const rejected: { name: string; message: JobRequest; from: MessageSender }[] = [
    { name: 'a different extension', message: request('start'), from: { ...sender, id: 'foreign' } },
    { name: 'a web sender without a tab', message: { ...request('start'), tabId: 9 }, from: { id: extensionId, url } },
    { name: 'a subframe sender', message: request('start'), from: { ...sender, frameId: 2 } },
    { name: 'an explicit tab supplied by a content script', message: { ...request('start'), tabId: 10 }, from: sender },
    { name: 'a different URL supplied by a content script', message: { ...request('start'), url: url + '/other' }, from: sender },
    { name: 'a different origin even with a document ID', message: { ...request('start'), url: 'https://other.example.test/apply' }, from: { ...sender, documentId: 'original-document' } },
  ];

  it.each(rejected)('rejects $name before accessing profile data or injecting', async ({ message, from }) => {
    expect(await handleJob(message, from)).toMatchObject({ error: expect.any(String) });
    expect(boundary.getTab).not.toHaveBeenCalled();
    expect(boundary.getStorage).not.toHaveBeenCalled();
    expect(boundary.executeScript).not.toHaveBeenCalled();
  });

  it('rejects a request after the bound tab navigates', async () => {
    boundary.state.tabUrl = url + '/other';

    expect(await handleJob(request('start'), sender)).toMatchObject({ error: expect.stringMatching(/changed/i) });
    expect(boundary.getStorage).not.toHaveBeenCalled();
    expect(boundary.executeScript).not.toHaveBeenCalled();
  });

  it('coalesces concurrent starts and issues fresh capabilities after the first run completes', async () => {
    boundary.stored['jobright.ai.v1'] = { provider: 'anthropic', enabled: true, apiKey: 'fixture-key', interpretQuestions: true, useVault: true };
    Object.assign(boundary.api, { permissions: { contains: async () => true } });
    let status = waiting;
    boundary.controller.start.mockImplementation(() => { status = { ...waiting, running: true }; return true; });
    boundary.controller.status.mockImplementation(() => status);
    const documentSender = { ...sender, documentId: boundary.state.documentId };
    const replies = await Promise.all(Array.from({ length: 5 }, () => handleJob(request('start'), documentSender)));
    expect(replies).toEqual(Array(5).fill(expect.objectContaining({ states: [expect.objectContaining({ running: true })] })));
    expect(boundary.controller.start).toHaveBeenCalledTimes(1);
    const [, , semantic, vault] = boundary.controller.start.mock.calls[0];
    expect(semantic?.token).toMatch(/^[a-f0-9]{32}$/);
    expect(vault?.token).toMatch(/^[a-f0-9]{32}$/);
    await expect(handleJob(request('start'), { ...documentSender, documentId: 'unrelated-document' }))
      .resolves.toMatchObject({ error: expect.any(String) });
    status = waiting;
    await handleJob(request('start'), documentSender);
    const [, , nextSemantic, nextVault] = boundary.controller.start.mock.calls[1];
    expect(nextSemantic?.token).not.toBe(semantic?.token);
    expect(nextVault?.token).not.toBe(vault?.token);
  });

  it('preserves a pending vault draft and its shared Undo when Autofill is clicked again', async () => {
    boundary.stored['jobright.ai.v1'] = { provider: 'anthropic', enabled: true, apiKey: 'fixture-key', model: 'claude-sonnet-5-5', useVault: true };
    Object.assign(boundary.api, { permissions: { contains: async () => true } });
    const answer = 'I led a catalog redesign.';
    const sendNativeMessage = vi.fn(async () => ({
      v: 1, ok: true, hits: [{ id: 'synthetic-source', questionId: 'q1', text: answer, path: 'Catalog.md', heading: '', lineStart: 1, lineEnd: 2 }],
    }));
    Object.assign(boundary.api.runtime, { sendNativeMessage });
    let release!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    document.body.innerHTML = '<form><label>First name<input></label><label>Describe a project you led.<textarea></textarea></label></form>';
    const documentSender = { ...sender, documentId: boundary.state.documentId };
    const sentRuns: VaultRun[] = [];
    const controller = createPageController(document, createEngine(document), () => {}, undefined, async (questions, run) => {
      sentRuns.push(run);
      return handleJob({ channel: VAULT_CHANNEL, command: 'draft', run: { ...run, topUrl: url }, url, questions }, documentSender) as Promise<VaultResult>;
    });
    // The fixture browser's remote document uses the application URL while jsdom uses localhost.
    boundary.controller.start.mockImplementation((profile, overwrite, semantic, vault) =>
      controller.start(profile, overwrite, semantic && { ...semantic, topUrl: document.URL }, vault && { ...vault, topUrl: document.URL }));
    boundary.controller.status.mockImplementation(() => controller.status());
    await handleJob(request('start'), documentSender);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'), { timeout: 2000 });
    await expect(handleJob(request('start'), documentSender)).resolves.toMatchObject({ states: [{ running: true }] });
    release(new Response(JSON.stringify({
      type: 'message', role: 'assistant', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ answers: [{ fieldId: 'q1', answer, evidence: [{ snippetId: 's1', quote: answer }] }] }) }],
    })));
    await vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 2500 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(sentRuns).toHaveLength(1);
    expect(boundary.controller.start).toHaveBeenCalledTimes(1);
    expect(controller.status()).toMatchObject({ filled: 2, vaultFilled: 1, undoAvailable: true });
    expect(document.querySelector('textarea')?.value).toBe(answer);
    await controller.undo();
    expect(document.querySelector('input')?.value).toBe('');
    expect(document.querySelector('textarea')?.value).toBe('');
  });

  it('starts in the current document after its URL changed without a reload', async () => {
    const currentUrl = url + '?tracking=fixture';
    boundary.state.tabUrl = boundary.state.documentUrl = currentUrl;
    const documentSender = { ...sender, documentId: boundary.state.documentId };

    await expect(handleJob({ ...request('start'), url: currentUrl }, documentSender)).resolves.toMatchObject({ states: [waiting] });
    expect(boundary.controller.start).toHaveBeenCalledTimes(1);
    expect(boundary.executeScript.mock.calls.at(-1)?.[0].target.documentIds).toEqual(['original-document']);
  });

  it('rejects before profile access when the same URL belongs to a replacement document', async () => {
    const documentSender = { ...sender, documentId: boundary.state.documentId };
    boundary.state.documentId = 'replacement-document';

    expect(await handleJob(request('start'), documentSender)).toMatchObject({ error: expect.stringMatching(/changed/i) });
    expect(boundary.getStorage).not.toHaveBeenCalled();
    expect(boundary.controller.start).not.toHaveBeenCalled();
  });

  it('does not start in a same-URL replacement document while the profile loads', async () => {
    const documentSender = { ...sender, documentId: boundary.state.documentId };
    const read = boundary.getStorage.getMockImplementation()!;
    boundary.getStorage.mockImplementationOnce(async keys => {
      boundary.state.documentId = 'replacement-document';
      return read(keys);
    });

    await expect(handleJob(request('start'), documentSender)).rejects.toThrow(/could not reach|changed/i);
    expect(boundary.controller.start).not.toHaveBeenCalled();
  });

  it('allows a trusted extension page opened in a tab to name the application tab', async () => {
    const extensionUrl = boundary.api.runtime.getURL('popup.html');
    const extensionPage = { id: extensionId, url: extensionUrl, frameId: 0, tab: { id: 24, url: extensionUrl } };

    await expect(handleJob({ ...request('start'), tabId: 9 }, extensionPage)).resolves.toMatchObject({ states: [waiting] });

    expect(boundary.getTab).toHaveBeenCalledExactlyOnceWith(9);
    expect(boundary.executeScript.mock.calls.map(([injection]) => injection.target.tabId)).toEqual([9, 9, 9]);
    expect(boundary.controller.start).toHaveBeenCalledTimes(1);
  });

  it('stays on the originating tab after another tab becomes active', async () => {
    await expect(handleJob(request('start'), sender)).resolves.toMatchObject({ states: [waiting] });

    expect(boundary.state.activeTab).toBe(10);
    expect(boundary.activeTab).not.toHaveBeenCalled();
    expect(boundary.getTab).toHaveBeenCalledExactlyOnceWith(9);
    expect(boundary.executeScript.mock.calls.map(([injection]) => injection.target.tabId)).toEqual([9, 9, 9]);
    expect(boundary.controller.start).toHaveBeenCalledTimes(1);
  });

  it('passes the parsed profile without either stored API key', async () => {
    await handleJob(request('start'), sender);

    expect(boundary.getStorage).toHaveBeenCalledWith(['jobright.profile.v1', 'jobright.application-defaults.revision']);
    const [profile] = boundary.controller.start.mock.calls[0];
    expect(profile).toMatchObject({ personal: { firstName: 'Lin' } });
    expect(JSON.stringify(profile)).not.toContain('legacy-inline-secret');
    expect(JSON.stringify(profile)).not.toContain('separate-provider-secret');
  });

  it('ignores an inaccessible frame and a frame whose top URL changed during dispatch', async () => {
    const inaccessible = {
      get top(): { location: { href: string } } { throw new DOMException('Cross-origin top frame', 'SecurityError'); },
    };
    boundary.executeScript.mockImplementation(async injection => injection.files
      ? [{ frameId: 0 }, { frameId: 2 }, { frameId: 4 }]
      : [
        { frameId: 0, result: boundary.invoke(injection) },
        { frameId: 2, result: boundary.invoke(injection, inaccessible) },
        { frameId: 4, result: boundary.invoke(injection, { top: { location: { href: url + '/other' } } }) },
      ]);

    expect(await handleJob(request('start'), sender)).toMatchObject({ states: [waiting], warning: expect.stringMatching(/embedded/i) });
    expect(boundary.controller.start).toHaveBeenCalledTimes(1);
  });

  it.each(['start', 'undo'] as const)('does not retry a %s callback after a partial execution failure', async command => {
    boundary.executeScript.mockImplementation(async injection => {
      if (injection.files || injection.args?.[0] === 'status') return boundary.execute(injection);
      boundary.invoke(injection);
      throw new Error('Another frame disappeared after dispatch');
    });

    await expect(handleJob(request(command), sender)).rejects.toThrow(/could not reach all application frames/i);

    expect(boundary.executeScript.mock.calls.filter(([call]) => call.args?.[0] === command)).toHaveLength(1);
    expect(command === 'start' ? boundary.controller.start : boundary.controller.undo).toHaveBeenCalledTimes(1);
  });

  it('recovers a failed status request with the top-frame status and a warning', async () => {
    boundary.executeScript.mockRejectedValueOnce(new Error('A frame disappeared'));

    expect(await handleJob(request('status'), sender)).toEqual({
      states: [reportedState], warning: expect.stringMatching(/embedded/i),
    });
    expect(boundary.executeScript.mock.calls.map(([call]) => call.target)).toEqual([
      { tabId: 9, allFrames: true }, { tabId: 9, frameIds: [0] },
    ]);
  });

  it('reads status without loading profile data, injecting content files, or applying answers', async () => {
    expect(await handleJob(request('status'), sender)).toEqual({ states: [reportedState], warning: undefined });

    expect(boundary.getStorage).not.toHaveBeenCalled();
    expect(boundary.executeScript).toHaveBeenCalledTimes(1);
    expect(boundary.executeScript.mock.calls[0][0].files).toBeUndefined();
    expect(boundary.controller.status).toHaveBeenCalledTimes(1);
    expect(boundary.controller.start).not.toHaveBeenCalled();
    expect(boundary.controller.undo).not.toHaveBeenCalled();
  });
});

describe('background field focus requests', () => {
  const focus = { fieldId: 'required-answer', frameId: 0, frameUrl: url, documentId: 'original-document' };
  const focusRequest = { ...request('focus'), focus };

  it('focuses the identified field without reading profile data or starting a run', async () => {
    await expect(handleJob(focusRequest, { ...sender, documentId: focus.documentId })).resolves.toMatchObject({ focus: { focused: true } });
    expect(boundary.controller.focus).toHaveBeenCalledExactlyOnceWith(focus.fieldId);
    expect(boundary.controller.start).not.toHaveBeenCalled();
    expect(boundary.getStorage).not.toHaveBeenCalled();
    const injections = boundary.executeScript.mock.calls.map(([injection]) => injection.target);
    expect(injections.every(target => target.documentIds?.length === 1 && target.documentIds[0] === focus.documentId)).toBe(true);
  });

  it('only targets the selected frame on a browser without document IDs', async () => {
    const frameUrl = url + '/form-step';
    boundary.executeScript.mockImplementation(async injection => [{ frameId: 2, result: boundary.invoke(injection, {
      top: { location: { href: url } }, document: { URL: frameUrl },
    }) }]);
    await expect(handleJob({ ...focusRequest, focus: { ...focus, frameId: 2, frameUrl, documentId: undefined } }, sender)).resolves.toMatchObject({ focus: { focused: true } });
    expect(boundary.executeScript.mock.calls.map(([injection]) => injection.target)).toEqual([{ tabId: 9, frameIds: [2] }]);
    expect(boundary.controller.focus).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...focus, frameId: -1 },
    { ...focus, fieldId: ' ' },
    { ...focus, frameId: 2, frameUrl: 'https://foreign.example.test/form' },
  ])('rejects malformed or foreign targets before accessing the browser', async target => {
    await expect(handleJob({ ...focusRequest, focus: target }, sender)).resolves.toMatchObject({ focus: { focused: false } });
    expect(boundary.executeScript).not.toHaveBeenCalled();
  });

  it('rejects a valid document ID associated with a different frame', async () => {
    await expect(handleJob({ ...focusRequest, focus: { ...focus, frameId: 2 } }, sender)).resolves.toMatchObject({ focus: { focused: false } });
    expect(boundary.controller.focus).not.toHaveBeenCalled();
  });

  it('rejects a focus request issued by a subframe', async () => {
    await expect(handleJob(focusRequest, { ...sender, frameId: 2 })).resolves.toMatchObject({ error: expect.any(String) });
    expect(boundary.executeScript).not.toHaveBeenCalled();
  });
});
