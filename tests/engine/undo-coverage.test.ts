import { afterEach, expect, it } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => { document.body.innerHTML = ''; });

it('reports no new undo batch when an overwrite is a no-op', async () => {
  document.body.innerHTML = '<label>First name<input id="first"></label>';
  const profile = emptyProfile();
  profile.personal.firstName = 'Casey';
  const engine = createEngine(document);
  const original = await engine.scan(profile);
  const changed = await engine.fill(original.scanId);
  expect(changed.undoAvailable).toBe(true);
  const repeated = await engine.scan(profile, { overwriteExisting: true });
  const same = await engine.fill(repeated.scanId);
  expect(same.filled).toBe(1);
  expect(same.undoAvailable).toBe(false);
  expect((await engine.undo(original.scanId)).restored).toBe(1);
  expect(document.querySelector<HTMLInputElement>('#first')!.value).toBe('');
});

it('reports no new undo batch after a stale field is skipped', async () => {
  document.body.innerHTML = '<label>First name<input id="first"></label><label>City<input id="city"></label>';
  const profile = emptyProfile();
  profile.personal.firstName = 'Casey';
  profile.personal.city = 'Detroit';
  const engine = createEngine(document);
  const initial = await engine.scan(profile);
  await engine.fill(initial.scanId, [initial.fields.find(field => field.label === 'First name')!.id]);
  const next = await engine.scan(profile);
  document.querySelector<HTMLInputElement>('#city')!.value = 'Edited by applicant';
  const skipped = await engine.fill(next.scanId);
  expect(skipped.skipped).toBe(1);
  expect(skipped.undoAvailable).toBe(false);
  expect((await engine.undo(initial.scanId)).restored).toBe(1);
});

it('distinguishes an in-progress fill from an empty undo batch', async () => {
  document.body.innerHTML = '<label>First name<input id="first"></label>';
  const profile = emptyProfile();
  profile.personal.firstName = 'Casey';
  const engine = createEngine(document);
  const plan = await engine.scan(profile);
  const filling = engine.fill(plan.scanId);
  expect(await engine.undo(plan.scanId)).toMatchObject({ restored: 0, skipped: 0, warning: expect.stringMatching(/still running/) });
  await filling;
  expect((await engine.undo(plan.scanId)).restored).toBe(1);
});
