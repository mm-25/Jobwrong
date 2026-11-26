import { expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';
import type { VaultDrafter, VaultResult } from '../../src/shared/vault';
import type { QuestionInterpreter } from '../../src/shared/interpretation';

const run = { token: 'vault-run', topUrl: document.URL };
const prompt = 'Describe a project you led.';
const followup = 'Explain how you handled a challenge in your work.';
const answer = 'I organized a usability study.';
const get = (id: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement>('#' + id)!;
const profile = emptyProfile();
profile.personal.firstName = 'Lin';
profile.applicationDefaults = { relocation: 'yes' };

function form() {
  document.body.innerHTML = `<form><label>First name<input id="name"></label><label>${prompt}<textarea id="prompt"></textarea></label></form>`;
}
function done(controller: ReturnType<typeof createPageController>) {
  return vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 4500 });
}

test('fills local, semantic and vault answers in order and undoes them as one run', async () => {
  form();
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<label>Is moving for this position off the table?<input id="moving"></label>');
  const interpret = vi.fn<QuestionInterpreter>(async ([field]) => {
    expect(get('name').value).toBe('Lin');
    return { meanings: [{ fieldId: field.id, fact: 'relocation', inverse: true, country: null, confidence: 'high', evidence: 'moving for this position off the table' }] };
  });
  const draft = vi.fn<VaultDrafter>(async ([field]) => {
    expect(get('moving').value).toBe('No');
    return { answers: [{ fieldId: field.id, answer, sourceIds: ['opaque_source'] }] };
  });
  const controller = createPageController(document, createEngine(document), () => {}, interpret, draft);
  controller.start(profile, false, run, run);
  await done(controller);
  expect(draft.mock.calls[0][0]).toEqual([{ id: expect.any(String), label: prompt, kind: 'text', maxLength: 4000 }]);
  expect(get('prompt').value).toBe(answer);
  expect(controller.status()).toMatchObject({ filled: 3, aiFilled: 1, vaultFilled: 1, undoAvailable: true });
  await controller.undo();
  expect(['name', 'moving', 'prompt'].map(id => get(id).value)).toEqual(['', '', '']);
});

test('keeps local fill and Undo when vault drafting fails and requires an authorized run', async () => {
  form();
  const draft = vi.fn<VaultDrafter>(async () => { throw new Error('Unavailable'); });
  const controller = createPageController(document, createEngine(document), () => {}, undefined, draft);
  controller.start(profile);
  await done(controller);
  expect(draft).not.toHaveBeenCalled();
  await controller.undo();
  controller.start(profile, false, undefined, run);
  await done(controller);
  expect(draft).toHaveBeenCalledTimes(1);
  expect(controller.status()).toMatchObject({ filled: 1, vaultFilled: 0, vaultMessage: expect.stringMatching(/unavailable/i), undoAvailable: true });
  expect(get('prompt').value).toBe('');
  await controller.undo();
  expect(get('name').value).toBe('');
});

test.each(['edit and clear', 'remount', 'new page'])('never retries a pending narrative response after %s', async mutation => {
  form();
  let release!: (value: VaultResult) => void;
  const draft = vi.fn<VaultDrafter>(() => new Promise(resolve => { release = resolve; }));
  const controller = createPageController(document, createEngine(document), () => {}, undefined, draft);
  const original = document.URL;
  try {
    controller.start(profile, false, undefined, run);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (mutation === 'edit and clear') {
      const field = get('prompt');
      field.value = 'Manual'; field.dispatchEvent(new Event('input', { bubbles: true }));
      field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (mutation === 'remount') {
      get('prompt').replaceWith(get('prompt').cloneNode(true));
    } else {
      history.pushState({}, '', '?new-application');
    }
    release({ answers: [{ fieldId: draft.mock.calls[0][0][0].id, answer, sourceIds: ['opaque_source'] }] });
    await done(controller);
    expect(draft).toHaveBeenCalledTimes(1);
    expect(get('prompt').value).toBe('');
    expect(controller.status().vaultFilled ?? 0).toBe(0);
  } finally { history.replaceState({}, '', original); }
});

test('fills newly revealed narrative fields and preserves edits to other questions made before the vault request', async () => {
  form();
  get('name').addEventListener('input', () => {
    document.querySelector('form')!.insertAdjacentHTML('beforeend', `<label>${followup}<textarea id="followup"></textarea></label>`);
    const prompt = get('prompt');
    prompt.value = 'Manual'; prompt.dispatchEvent(new Event('input', { bubbles: true }));
    prompt.value = ''; prompt.dispatchEvent(new Event('input', { bubbles: true }));
  }, { once: true });
  const draft = vi.fn<VaultDrafter>(async questions => ({ answers: questions.map(({ id }) => ({ fieldId: id, answer, sourceIds: ['opaque_source'] })) }));
  const controller = createPageController(document, createEngine(document), () => {}, undefined, draft);
  controller.start(profile, false, undefined, run);
  await done(controller);
  expect(draft.mock.calls[0][0].map(field => field.label)).toEqual([followup]);
  expect(get('prompt').value).toBe('');
  expect(get('followup').value).toBe(answer);
  await controller.undo();
  expect(get('name').value).toBe('');
  expect(get('followup').value).toBe('');
});

test('can draft a second narrative revealed by a vault fill', async () => {
  form();
  get('prompt').addEventListener('input', () => {
    document.querySelector('form')!.insertAdjacentHTML('beforeend', `<label>${followup}<textarea id="followup"></textarea></label>`);
  }, { once: true });
  const draft = vi.fn<VaultDrafter>(async ([{ id }]) => ({ answers: [{ fieldId: id, answer, sourceIds: ['opaque_source'] }] }));
  const controller = createPageController(document, createEngine(document), () => {}, undefined, draft);
  controller.start(profile, false, undefined, run);
  await done(controller);
  expect(draft.mock.calls.map(([questions]) => questions.map(({ label }) => label))).toEqual([[prompt], [followup]]);
  expect(controller.status()).toMatchObject({ vaultFilled: 2 });
  await controller.undo();
  expect(['name', 'prompt', 'followup'].map(id => get(id).value)).toEqual(['', '', '']);
});
