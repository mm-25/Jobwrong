import { expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';
import type { InterpretationResult, QuestionInterpreter } from '../../src/shared/interpretation';
import type { Profile } from '../../src/shared/types';

const run = { token: 'test-job-token', topUrl: document.URL };
const question = 'Is moving for this position off the table?';
const profile = (): Profile => ({ ...emptyProfile(), personal: { ...emptyProfile().personal, firstName: 'Lin' }, applicationDefaults: { relocation: 'yes', gender: 'male' } });
function form() {
  document.body.innerHTML = `<form><label>First name<input id="name" autocomplete="given-name"></label><label>${question}<input id="moving"></label></form>`;
}
const movingMeaning = (fieldId: string) => ({ fieldId, fact: 'relocation' as const, inverse: true, country: null, confidence: 'high' as const, evidence: 'moving for this position off the table' });
async function done(controller: ReturnType<typeof createPageController>) {
  await vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 3500 });
}

test('fills local facts before AI matching and groups both changes into one Undo', async () => {
  form();
  const observations: string[] = [];
  const interpret: QuestionInterpreter = async questions => {
    observations.push(document.querySelector<HTMLInputElement>('#name')!.value);
    return { meanings: [movingMeaning(questions[0].id)] };
  };
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(profile(), false, run);
  await done(controller);
  expect(observations).toEqual(['Lin']);
  expect(document.querySelector<HTMLInputElement>('#moving')!.value).toBe('No');
  expect(controller.status()).toMatchObject({ filled: 2, aiFilled: 1, undoAvailable: true });
  await controller.undo();
  expect([...document.querySelectorAll<HTMLInputElement>('input')].map(input => input.value)).toEqual(['', '']);
});

test('never overwrites a manual edit made while the interpretation is pending', async () => {
  form();
  let release!: (value: InterpretationResult) => void;
  let fieldId = '';
  const interpret: QuestionInterpreter = questions => {
    fieldId = questions[0].id;
    return new Promise(resolve => { release = resolve; });
  };
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(profile(), false, run);
  await vi.waitFor(() => expect(fieldId).not.toBe(''));
  const input = document.querySelector<HTMLInputElement>('#moving')!;
  input.value = 'Applicant decision'; input.dispatchEvent(new Event('input', { bubbles: true }));
  release({ meanings: [movingMeaning(fieldId)] });
  await done(controller);
  expect(input.value).toBe('Applicant decision');
  expect(controller.status().filled).toBe(1);
  expect(controller.status().remaining.some(field => field.label === question)).toBe(false);
});

test('continues to an unrelated AI question when a local control cannot be filled', async () => {
  form();
  const engine = createEngine(document);
  const fill = engine.fill.bind(engine);
  let first = true;
  engine.fill = async (...args) => {
    if (!first) return fill(...args);
    first = false;
    return { filled: 0, failed: 0, skipped: 1, needsRescan: true, undoAvailable: false,
      entries: [{ id: args[1]![0], label: 'First name', status: 'skipped', reason: 'Control changed.' }] };
  };
  const interpret: QuestionInterpreter = async questions => ({ meanings: [movingMeaning(questions[0].id)] });
  const controller = createPageController(document, engine, () => {}, interpret);
  controller.start(profile(), false, run);
  await done(controller);
  expect(document.querySelector<HTMLInputElement>('#moving')!.value).toBe('No');
  expect(controller.status()).toMatchObject({ filled: 1, aiFilled: 1 });
});

test('advanced fills do not inherit the previous runs AI count or notice', async () => {
  form();
  const interpret: QuestionInterpreter = async questions => ({ meanings: [movingMeaning(questions[0].id)] });
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(profile(), false, run);
  await done(controller);
  expect(controller.status().aiFilled).toBe(1);
  controller.noteFill('reviewed-scan', { filled: 1, failed: 0, skipped: 0, needsRescan: false, entries: [] });
  expect(controller.status()).toMatchObject({ filled: 1, aiFilled: 0, aiMessage: undefined });
});

test('an iframe drops a pending interpretation when only its parent SPA URL changes', async () => {
  const original = document.URL;
  document.body.innerHTML = '<iframe></iframe>';
  const child = document.querySelector('iframe')!.contentDocument!;
  child.body.innerHTML = `<form><label>${question}<input id="moving"></label></form>`;
  let release!: (value: InterpretationResult) => void;
  let id = '';
  const interpret: QuestionInterpreter = questions => { id = questions[0].id; return new Promise(resolve => { release = resolve; }); };
  const controller = createPageController(child, createEngine(child), () => {}, interpret);
  try {
    controller.start(profile(), false, { ...run, topUrl: original });
    await vi.waitFor(() => expect(id).not.toBe(''));
    history.pushState({}, '', '?parent-step=2');
    release({ meanings: [movingMeaning(id)] });
    await done(controller);
    expect(child.querySelector<HTMLInputElement>('#moving')!.value).toBe('');
    expect(controller.status().message).toMatch(/changed/i);
  } finally { history.replaceState({}, '', original); }
});

test('local fill and Undo remain available when the AI provider fails', async () => {
  form();
  let requests = 0;
  const interpret: QuestionInterpreter = async () => { requests++; return { meanings: [], error: 'AI matching unavailable.' }; };
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(profile(), false, run);
  await done(controller);
  expect(requests).toBe(1);
  expect(document.querySelector<HTMLInputElement>('#name')!.value).toBe('Lin');
  expect(document.querySelector<HTMLInputElement>('#moving')!.value).toBe('');
  expect(controller.status()).toMatchObject({ filled: 1, aiMessage: expect.stringMatching(/unavailable/i), undoAvailable: true });
  await controller.undo();
  expect(document.querySelector<HTMLInputElement>('#name')!.value).toBe('');
});

test('does not call AI without an authorized run or when all fields are locally resolved', async () => {
  form();
  const interpret = vi.fn<QuestionInterpreter>(async () => ({ meanings: [] }));
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(profile());
  await done(controller);
  expect(interpret).not.toHaveBeenCalled();
  document.querySelector('#moving')!.closest('label')!.remove();
  controller.start(profile(), false, run);
  await done(controller);
  expect(interpret).not.toHaveBeenCalled();
});

test('can interpret a form with no locally ready fields without a second click', async () => {
  form(); document.querySelector('#name')!.closest('label')!.remove();
  const interpret: QuestionInterpreter = async questions => ({ meanings: [movingMeaning(questions[0].id)] });
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(profile(), false, run);
  await done(controller);
  expect(document.querySelector<HTMLInputElement>('#moving')!.value).toBe('No');
  expect(controller.status()).toMatchObject({ filled: 1, aiFilled: 1 });
});

test('drops an interpretation if the application navigates while the provider runs', async () => {
  form();
  const original = document.URL;
  let release!: (value: InterpretationResult) => void;
  let id = '';
  const interpret: QuestionInterpreter = questions => { id = questions[0].id; return new Promise(resolve => { release = resolve; }); };
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  try {
    controller.start(profile(), false, run);
    await vi.waitFor(() => expect(id).not.toBe(''));
    history.pushState({}, '', '?replacement=1');
    release({ meanings: [movingMeaning(id)] });
    await done(controller);
    expect(document.querySelector<HTMLInputElement>('#moving')!.value).toBe('');
    expect(controller.status().undoAvailable).toBe(false);
  } finally { history.replaceState({}, '', original); }
});

test('interprets distinct follow-up questions with the same generic caption', async () => {
  document.body.innerHTML = `<form>
    <p id="visa-help">Is employment visa sponsorship something you will not need?</p>
    <label>Status<select id="visa" aria-describedby="visa-help"><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
    <section id="next" hidden><p id="moving-help">${question}</p>
      <label>Status<select id="moving" aria-describedby="moving-help"><option value="">Choose</option><option>Yes</option><option>No</option></select></label></section>
  </form>`;
  document.querySelector('#visa')!.addEventListener('change', () => { document.querySelector<HTMLElement>('#next')!.hidden = false; });
  const interpret = vi.fn<QuestionInterpreter>(async questions => ({ meanings: questions.map(field => ({
    fieldId: field.id, fact: field.context!.includes('sponsorship') ? 'visaSponsorship' : 'relocation',
    inverse: true, country: null, confidence: 'high', evidence: field.context!,
  })) }));
  const candidate = profile();
  candidate.applicationDefaults = { ...candidate.applicationDefaults, visaSponsorship: 'yes' };
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(candidate, false, run);
  await done(controller);
  expect(interpret).toHaveBeenCalledTimes(2);
  expect(document.querySelector<HTMLSelectElement>('#visa')!.value).toBe('No');
  expect(document.querySelector<HTMLSelectElement>('#moving')!.value).toBe('No');
  expect(controller.status()).toMatchObject({ filled: 2, aiFilled: 2 });
});

test.each([false, true])('fills a local follow-up revealed during AI even when no meaning is applied (error=%s)', async failed => {
  form();
  let release!: (value: InterpretationResult) => void;
  const interpret = vi.fn<QuestionInterpreter>(() => new Promise(resolve => { release = resolve; }));
  const candidate = profile(); candidate.personal.lastName = 'Rivera';
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(candidate, false, run);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<label>Last name<input id="late-name" autocomplete="family-name"></label>');
  release({ meanings: [], ...(failed ? { error: 'Provider unavailable.' } : {}) });
  await done(controller);
  expect(document.querySelector<HTMLInputElement>('#late-name')!.value).toBe('Rivera');
  expect(interpret).toHaveBeenCalledTimes(1);
  expect(controller.status()).toMatchObject({ filled: 2, aiFilled: 0 });
  await controller.undo();
  expect(document.querySelector<HTMLInputElement>('#late-name')!.value).toBe('');
  expect(document.querySelector<HTMLInputElement>('#name')!.value).toBe('');
});

test('withholds applicant-specific choice labels at the interpreter boundary', async () => {
  document.body.innerHTML = `<form><label>First name<input value="Avery Example"></label>
    <label>Which ethnicity category best reflects how you identify?<select><option value="">Choose</option><option>South Asian (Avery Example)</option></select></label>
    <label>Which gender category best reflects how you identify?<select><option value="">Choose</option><option>avery@example.test</option><option>Man</option></select></label>
    <label>${question}<select><option value="">Choose</option><option>Yes</option><option>No</option></select></label></form>`;
  const interpret = vi.fn<QuestionInterpreter>(async () => ({ meanings: [] }));
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(profile(), false, run);
  await done(controller);
  expect(interpret).toHaveBeenCalledTimes(1);
  expect(interpret.mock.calls[0][0].map(field => field.label)).toEqual([question]);
  expect(JSON.stringify(interpret.mock.calls)).not.toMatch(/Avery Example|avery@example\.test/);
});

test.each([false, true])('preserves a deliberate clear through later follow-up passes (AI filled=%s)', async applied => {
  form();
  const name = document.querySelector<HTMLInputElement>('#name')!;
  name.value = 'Existing applicant answer';
  let release!: (value: InterpretationResult) => void;
  let id = '';
  const interpret: QuestionInterpreter = questions => { id = questions[0].id; return new Promise(resolve => { release = resolve; }); };
  const candidate = profile(); candidate.personal.lastName = 'Rivera';
  const controller = createPageController(document, createEngine(document), () => {}, interpret);
  controller.start(candidate, false, run);
  await vi.waitFor(() => expect(id).not.toBe(''));
  name.value = ''; name.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<label>Last name<input id="late-name" autocomplete="family-name"></label>');
  release({ meanings: applied ? [movingMeaning(id)] : [] });
  await done(controller);
  expect(name.value).toBe('');
  expect(document.querySelector<HTMLInputElement>('#late-name')!.value).toBe('Rivera');
  expect(controller.status().filled).toBe(applied ? 2 : 1);
  await controller.undo();
  expect(name.value).toBe('');
});
