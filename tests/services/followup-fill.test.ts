import { expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';

function setup() {
  document.body.innerHTML = '<form><label>First name<input autocomplete="given-name"></label><div id="next" hidden><label>Last name<input autocomplete="family-name"></label></div></form>';
  const first = document.querySelector<HTMLInputElement>('[autocomplete=given-name]')!;
  const last = document.querySelector<HTMLInputElement>('[autocomplete=family-name]')!;
  first.addEventListener('input', () => { setTimeout(() => { document.querySelector<HTMLElement>('#next')!.hidden = !first.value; }, 80); });
  const profile = emptyProfile();
  profile.personal.firstName = 'Lin'; profile.personal.lastName = 'Rivera';
  const engine = createEngine(document);
  return { first, last, profile, engine, controller: createPageController(document, engine, () => {}) };
}

test('fills newly revealed known fields in one click and undoes all passes together', async () => {
  const { first, last, profile, controller } = setup();
  controller.start(profile);
  await vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 2500 });
  expect(controller.status()).toMatchObject({ filled: 2, failed: 0, undoAvailable: true });
  expect([first.value, last.value]).toEqual(['Lin', 'Rivera']);
  await controller.undo();
  expect([first.value, last.value]).toEqual(['', '']);
});

test('keeps prerequisite answers when undoing them would hide a later manual answer', async () => {
  const { first, last, profile, controller } = setup();
  controller.start(profile);
  await vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 2500 });
  last.value = 'Applicant edit'; last.dispatchEvent(new Event('input', { bubbles: true }));
  await controller.undo();
  expect(first.value).toBe('Lin');
  expect(last.value).toBe('Applicant edit');
  expect(document.querySelector<HTMLElement>('#next')!.hidden).toBe(false);
});

test('a follow-up cannot append to an unrelated undo batch', async () => {
  const { first, last, profile, engine } = setup();
  const scan = await engine.scan(profile);
  await engine.fill(scan.scanId);
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>('#next')!.hidden).toBe(false));
  const followup = await engine.scan(profile);
  const result = await engine.fill(followup.scanId, undefined, 'unrelated-scan');
  expect(result.filled).toBe(0);
  expect(last.value).toBe('');
  expect((await engine.undo(scan.scanId)).restored).toBe(1);
  expect(first.value).toBe('');
});

test('a retained form shell cannot authorize replacement questions at the same URL', async () => {
  const { first, profile, controller } = setup();
  first.addEventListener('input', () => {
    setTimeout(() => { document.querySelector('form')!.innerHTML = '<label>Last name<input autocomplete="family-name"></label>'; }, 90);
  });
  controller.start(profile);
  await vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 2500 });
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('');
  expect(controller.status().remaining[0].reason).toMatch(/different form/i);
});

test('bounds automatically revealed fields to four fill passes', async () => {
  document.body.innerHTML = '<form><label>First name<input autocomplete="given-name"></label></form>';
  const form = document.querySelector('form')!;
  let next = 0;
  form.addEventListener('input', () => {
    if (next < 8) form.insertAdjacentHTML('beforeend', `<label>Which answer ${++next}?<input></label>`);
  });
  const profile = emptyProfile(); profile.personal.firstName = 'Lin';
  profile.answers = Array.from({ length: 8 }, (_, i) => ({ question: `Which answer ${i + 1}?`, answer: 'A' }));
  const engine = createEngine(document);
  const fills = vi.spyOn(engine, 'fill');
  const controller = createPageController(document, engine, () => {});
  controller.start(profile);
  await vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 2500 });
  expect(fills).toHaveBeenCalledTimes(4);
  expect(controller.status().remaining).toContainEqual(expect.objectContaining({ label: 'Which answer 4?', status: 'ready' }));
});
