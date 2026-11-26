import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { sameEmbeddedApplication } from '../../src/services/application-frames';
import type { EmbeddedApplicationBinding } from '../../src/shared/jobs';
import type { InterpretationQuestion, InterpretationResult } from '../../src/shared/interpretation';
import { emptyProfile } from '../../src/shared/profile';

const question = 'Is moving for this position off the table?';

function setup() {
  document.body.innerHTML = `<form id="application-form">
    <label>First Name<input id="first" autocomplete="given-name"></label>
    <label>${question}<select id="moving"><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
  </form><form id="other"><label>First Name<input autocomplete="given-name"></label></form>`;
  const binding: EmbeddedApplicationBinding = {
    tabId: 10, topUrl: 'https://application.example.test/posting?gh_jid=500', topDocumentId: 'top', topTimeOrigin: 100,
    iframeKey: 'original-frame', iframeIndex: 0, frameId: 2, frameUrl: document.URL, documentId: 'child',
    frameTimeOrigin: 200, formKey: 'original-form',
  };
  const form = document.querySelector<HTMLFormElement>('#application-form')!;
  const engine = createEngine(document, { applicationForm: () => form });
  const profile = emptyProfile();
  profile.personal.firstName = 'Sasha';
  profile.applicationDefaults = { relocation: 'yes' };
  const validateEmbedded = vi.fn(async () => true);
  const options = {
    matchesEmbedded: (candidate: EmbeddedApplicationBinding) => sameEmbeddedApplication(binding, candidate),
    validateEmbedded,
  };
  const first = form.querySelector<HTMLInputElement>('#first')!;
  const moving = form.querySelector<HTMLSelectElement>('#moving')!;
  const other = document.querySelector<HTMLInputElement>('#other input')!;
  return { binding, engine, profile, options, validateEmbedded, first, moving, other };
}

afterEach(() => document.body.replaceChildren());

describe('scoped page controller', () => {
  it('requires the approved binding for status and Undo and confines writes to the scanned application form', async () => {
    const { binding, engine, profile, options, first, other } = setup();
    const controller = createPageController(document, engine, () => {}, undefined, undefined, options);
    expect(controller.start(profile)).toBe(false);
    expect(controller.start(profile, false, undefined, undefined, binding)).toBe(true);
    await vi.waitFor(() => expect(controller.status(binding)).toMatchObject({ running: false, filled: 1, undoAvailable: true }), { timeout: 3000 });
    expect(first.value).toBe('Sasha');
    expect(other.value).toBe('');
    const wrong = { ...binding, iframeKey: 'replacement-frame' };
    expect(controller.status(wrong)).toMatchObject({ started: false, undoAvailable: false, remaining: [] });
    await controller.undo(wrong);
    expect(first.value).toBe('Sasha');
    await controller.undo(structuredClone(binding));
    expect(first.value).toBe('');
  });

  it('discards pending interpretation when the posting changes but the child still looks current', async () => {
    const { binding, engine, profile, options, validateEmbedded, first, moving } = setup();
    let finish!: (value: InterpretationResult) => void;
    const interpreter = vi.fn((_questions: InterpretationQuestion[]) => new Promise<InterpretationResult>(resolve => { finish = resolve; }));
    const controller = createPageController(document, engine, () => {}, interpreter, undefined, options);
    controller.start(profile, false, { token: 'fixture-token', topUrl: binding.topUrl }, undefined, binding);
    await vi.waitFor(() => expect(interpreter).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(first.value).toBe('Sasha');
    validateEmbedded.mockResolvedValue(false);
    finish({ meanings: [{ fieldId: interpreter.mock.calls[0][0][0].id, fact: 'relocation', inverse: true, country: null,
      confidence: 'high', evidence: 'moving for this position off the table' }] });
    await vi.waitFor(() => expect(controller.status(binding)).toMatchObject({ running: false, started: false, remaining: [] }));
    expect(moving.value).toBe('');
  });
});
