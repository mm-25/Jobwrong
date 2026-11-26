import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { FrameScan } from '../../src/shared/types';

type Execution = {
  target: { frameIds?: number[]; allFrames?: boolean };
  files?: string[];
  func?: (...args: unknown[]) => unknown;
  args?: unknown[];
};

const frameDocuments = new Map<number, Document>();
const noteFill = vi.fn();
let requestsBeforeClose: number | undefined;
const profile = emptyProfile();
profile.personal.firstName = 'Casey';
profile.personal.city = 'Detroit';

function field(document: Document, id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('#' + id)!;
}

function previewField(preview: FrameScan[], label: string, frameId = 0): string {
  return preview.find((frame) => frame.frameId === frameId)!.result.fields.find((field) => field.label === label)!.id;
}

beforeEach(() => {
  vi.resetModules();
  noteFill.mockClear();
  requestsBeforeClose = undefined;
  history.replaceState(null, '', '/apply');
  document.body.innerHTML = '<form><label>First name<input id="name"></label><label>City<input id="city"></label></form><iframe></iframe>';
  const frameDocument = document.querySelector('iframe')!.contentDocument!;
  frameDocument.body.innerHTML = '<form><label>First name<input id="name"></label></form>';
  frameDocuments.set(0, document);
  frameDocuments.set(2, frameDocument);
  const worlds = new Map([...frameDocuments].map(([id, doc]) => [id, {
    __jobrightLocal: createEngine(doc), __jobrightPage: { noteFill },
  }]));
  vi.stubGlobal('browser', {
    runtime: {},
    tabs: { query: async () => [{ id: 7, url: location.href }] },
    scripting: {
      executeScript: async ({ target, files, func, args = [] }: Execution) => {
        const frameIds = target.allFrames ? [...frameDocuments.keys()] : target.frameIds!;
        if (files) return frameIds.map((frameId) => ({ frameId }));
        if (requestsBeforeClose !== undefined && requestsBeforeClose-- <= 0) throw new Error('Popup closed');
        const invoke = new Function('globalThis', 'location', 'document', 'args', `return (${func})(...args);`);
        return Promise.all(frameIds.map(async (frameId) => {
          const doc = frameDocuments.get(frameId)!;
          const result = await invoke(worlds.get(frameId), doc.location, doc, structuredClone(args));
          return { frameId, result: structuredClone(result) };
        }));
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  frameDocuments.clear();
});

describe('fill binding and undo recovery', () => {
  it('rejects a stale preview after top navigation even when the embedded form is still mounted', async () => {
    const { fillActiveTab, scanActiveTab } = await import('../../src/services/browser');
    const preview = await scanActiveTab(profile);
    history.pushState(null, '', '/another-job');

    await expect(fillActiveTab(preview, { 2: [previewField(preview, 'First name', 2)] })).rejects.toThrow(/changed/i);
    expect(field(frameDocuments.get(2)!, 'name').value).toBe('');
  });

  it('does not attach an in-flight reviewed fill report to a new parent route', async () => {
    const { fillActiveTab, scanActiveTab } = await import('../../src/services/browser');
    const preview = await scanActiveTab(profile);
    const childInput = field(frameDocuments.get(2)!, 'name');
    childInput.addEventListener('input', () => history.pushState(null, '', '/another-job'), { once: true });

    const [result] = await fillActiveTab(preview, { 2: [previewField(preview, 'First name', 2)] });

    expect(location.pathname).toBe('/another-job');
    expect(noteFill).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({ failed: 1, needsRescan: true });
  });

  it('rejects a superseded preview before filling', async () => {
    const { fillActiveTab, scanActiveTab } = await import('../../src/services/browser');
    const preview = await scanActiveTab(profile);
    await scanActiveTab(profile);

    await expect(fillActiveTab(preview, { 0: [previewField(preview, 'First name')] })).rejects.toThrow(/scan/i);
    expect(field(document, 'name').value).toBe('');
  });

  it('preserves undo from the previous fill when a retry skips every field', async () => {
    const { fillActiveTab, scanActiveTab, undoActiveTab } = await import('../../src/services/browser');

    const initial = await scanActiveTab(profile);
    await fillActiveTab(initial, { 0: [previewField(initial, 'First name')] });
    expect(field(document, 'name').value).toBe('Casey');

    const retry = await scanActiveTab(profile);
    field(document, 'city').value = 'Windsor';
    field(document, 'city').dispatchEvent(new Event('input', { bubbles: true }));
    const result = await fillActiveTab(retry, { 0: [previewField(retry, 'City')] });
    expect(result[0].result.skipped).toBe(1);

    expect(await undoActiveTab()).toEqual([{ restored: 1, skipped: 0 }]);
    expect(field(document, 'name').value).toBe('');
    expect(field(document, 'city').value).toBe('Windsor');
  });

  it('records only changed frames in a later successful undo batch', async () => {
    const { fillActiveTab, scanActiveTab, undoActiveTab } = await import('../../src/services/browser');
    const initial = await scanActiveTab(profile);
    await fillActiveTab(initial, { 2: [previewField(initial, 'First name', 2)] });

    const retry = await scanActiveTab(profile, { overwriteExisting: true });
    const results = await fillActiveTab(retry, {
      0: [previewField(retry, 'First name')],
      2: [previewField(retry, 'First name', 2)],
    });
    expect(results).toHaveLength(2);
    expect(await undoActiveTab()).toEqual([{ restored: 1, skipped: 0 }]);
    expect(field(document, 'name').value).toBe('');
    expect(field(frameDocuments.get(2)!, 'name').value).toBe('Casey');
  });

  it('recovers the previous batch after the popup closes before an all-skipped retry settles', async () => {
    const { fillActiveTab, scanActiveTab } = await import('../../src/services/browser');
    const initial = await scanActiveTab(profile);
    await fillActiveTab(initial, { 0: [previewField(initial, 'First name')] });

    const retry = await scanActiveTab(profile);
    field(document, 'city').value = 'Windsor';
    field(document, 'city').dispatchEvent(new Event('input', { bubbles: true }));
    requestsBeforeClose = 2;
    await fillActiveTab(retry, { 0: [previewField(retry, 'City')] });

    requestsBeforeClose = undefined;
    vi.resetModules();
    const { undoActiveTab } = await import('../../src/services/browser');
    expect(await undoActiveTab()).toEqual([{ restored: 1, skipped: 0 }]);
    expect(field(document, 'name').value).toBe('');
    expect(field(document, 'city').value).toBe('Windsor');
  });

  it('does not fall back when the newer operation has an inaccessible frame', async () => {
    const { fillActiveTab, scanActiveTab, undoActiveTab } = await import('../../src/services/browser');
    const initial = await scanActiveTab(profile);
    await fillActiveTab(initial, { 0: [previewField(initial, 'First name')] });

    const retry = await scanActiveTab(profile);
    document.querySelector('iframe')!.remove();
    frameDocuments.delete(2);
    const results = await fillActiveTab(retry, { 2: [previewField(retry, 'First name', 2)] });
    expect(results[0].result.failed).toBe(1);

    expect(await undoActiveTab()).toEqual([
      expect.objectContaining({ warning: expect.stringMatching(/frame/) }),
    ]);
    expect(field(document, 'name').value).toBe('Casey');
  });

});
