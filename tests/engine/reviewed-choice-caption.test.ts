import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const question = 'Which design discipline is closest to your background?';
const original = 'Product design';
const replacement = 'Sales operations';

function application() {
  document.body.innerHTML = `<form>
    <label for="discipline">${question}</label>
    <input id="discipline" role="combobox" aria-expanded="true" aria-controls="disciplines">
    <div id="disciplines" role="listbox">
      <button type="button" role="option" data-value="${original}">${original}</button>
      <button type="button" role="option" data-value="graphic">Graphic design</button>
    </div>
  </form>`;
  const input = document.querySelector<HTMLInputElement>('#discipline')!;
  const menu = document.querySelector<HTMLElement>('#disciplines')!;
  const option = menu.querySelector('button')!;
  option.addEventListener('click', () => { input.value = option.textContent!; });
  return { input, menu, option, engine: createEngine(document) };
}

test('leaves a reviewed choice unanswered if its caption changes before approval', async () => {
  const { input, option, engine } = application();
  const profile = emptyProfile();
  const [field] = (await engine.scan(profile)).fields;
  expect(field).toMatchObject({ status: 'unanswered', aiEligible: true, options: [original, 'Graphic design'] });

  option.textContent = replacement;
  const scan = await engine.scan(profile, { reviewedAnswers: { [field.id]: original } });
  expect(scan.fields[0]).toMatchObject({ id: field.id, status: 'unanswered', options: [replacement, 'Graphic design'] });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(input.value).toBe('');
});

test('leaves a reviewed choice untouched if the reopened menu only matches its machine value', async () => {
  const { input, menu, option, engine } = application();
  const profile = emptyProfile();
  const [field] = (await engine.scan(profile)).fields;
  menu.remove();
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('click', () => {
    option.textContent = replacement;
    input.after(menu);
    input.setAttribute('aria-expanded', 'true');
  });

  const scan = await engine.scan(profile, { reviewedAnswers: { [field.id]: original } });
  expect(scan.fields[0]).toMatchObject({ id: field.id, status: 'ready', value: original, answerSource: 'reviewed' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(input.value).toBe('');
}, 8_000);

test('still matches machine values in exact saved answers', async () => {
  const { input, option, engine } = application();
  const profile = emptyProfile();
  profile.answers = [{ question, answer: original }];
  option.textContent = replacement;

  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: replacement, answerSource: 'profile' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(input.value).toBe(replacement);
});
