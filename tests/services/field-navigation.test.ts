import { afterEach, expect, test, vi } from 'vitest';
import { createPageController } from '../../src/page-controller';
import { focusPageField } from '../../src/services/jobs';
import { emptyProfile } from '../../src/shared/profile';
import type { AutofillEngine, ScanResult } from '../../src/shared/types';

afterEach(() => vi.unstubAllGlobals());

const scan: ScanResult = { scanId: 'scan', platform: 'generic', frameUrl: document.URL, warnings: [], fields: [
  { id: 'question-a', label: 'Additional information', kind: 'text', status: 'unanswered', scopeId: 'form', scopeType: 'form' },
  { id: 'question-b', label: 'Additional information', kind: 'text', status: 'unanswered', scopeId: 'form', scopeType: 'form' },
] };

test('remaining questions retain distinct field IDs and focusing does not change the fill report', async () => {
  const focus = vi.fn(() => ({ focused: true }));
  const engine: AutofillEngine = {
    scan: async () => scan, focus,
    fill: vi.fn(), undo: vi.fn(),
  };
  const controller = createPageController(document, engine, () => {});
  controller.start(emptyProfile());
  await vi.waitFor(() => expect(controller.status().running).toBe(false));
  expect(controller.status().remaining.map(field => field.id)).toEqual(['question-a', 'question-b']);
  const before = controller.status();
  expect(controller.focus!('question-b')).toEqual({ focused: true });
  expect(focus).toHaveBeenCalledExactlyOnceWith('question-b');
  expect(controller.status()).toEqual(before);
  expect(engine.fill).not.toHaveBeenCalled();
});

test('focus cannot interrupt an active fill or silently succeed without an engine navigator', async () => {
  let release!: (result: ScanResult) => void;
  const focus = vi.fn(() => ({ focused: true }));
  const engine: AutofillEngine = { scan: () => new Promise(resolve => { release = resolve; }), focus, fill: vi.fn(), undo: vi.fn() };
  const controller = createPageController(document, engine, () => {});
  controller.start(emptyProfile());
  expect(controller.focus!('question-a')).toMatchObject({ focused: false, reason: expect.any(String) });
  expect(focus).not.toHaveBeenCalled();
  engine.scan = async () => scan;
  release(scan);
  await vi.waitFor(() => expect(controller.status().running).toBe(false));
  engine.focus = undefined;
  expect(controller.focus!('question-a')).toMatchObject({ focused: false, reason: expect.stringMatching(/reload/i) });
});

test('popup navigation remains bound to the reviewed tab and exact frame, without reading a profile', async () => {
  const sendMessage = vi.fn(async () => ({ focus: { focused: true } }));
  const query = vi.fn(async () => [{ id: 99, url: 'https://another.test' }]);
  const get = vi.fn();
  vi.stubGlobal('browser', { runtime: { sendMessage }, tabs: { query }, storage: { local: { get } } });
  const target = { fieldId: 'question-b', frameId: 3, frameUrl: 'https://example.test/embedded', documentId: 'document-fixture' };
  expect(await focusPageField(44, 'https://example.test/apply', target)).toEqual({ focused: true });
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ channel: 'jobright-local-job-v1', command: 'focus',
    tabId: 44, url: 'https://example.test/apply', focus: target });
  expect(query).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

test('popup navigation reports an unavailable field without claiming a successful jump', async () => {
  vi.stubGlobal('browser', { runtime: { sendMessage: async () => ({ error: 'The application changed.' }) } });
  await expect(focusPageField(44, 'https://example.test/apply', {
    fieldId: 'old', frameId: 0, frameUrl: 'https://example.test/apply',
  })).rejects.toThrow('The application changed.');
});
