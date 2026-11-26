import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { fieldIdentity, inspectField } from '../../src/engine/discovery';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

const question = 'Would you consider relocating for this role?';
function questionnaire(label = question) {
  document.body.innerHTML = `<main data-automation-id="applyFlowPage"><div data-automation-id="formField-question"
    data-fkit-id="primaryQuestionnaire--question"><fieldset><legend><div data-automation-id="richText">
    <p><b>${label}<abbr title="required">*</abbr></b></p></div></legend><div><button type="button"
    id="primaryQuestionnaire--question" aria-haspopup="listbox" aria-label=" Select One Required" value="">Select One</button>
    <input style="display:none" type="text" value=""></div></fieldset></div></main>`;
  const button = document.querySelector('button')!;
  const legend = document.querySelector('legend')!;
  button.addEventListener('click', () => {
    const list = document.createElement('ul');
    list.id = 'question-options'; list.setAttribute('role', 'listbox');
    button.setAttribute('aria-controls', list.id); button.setAttribute('aria-expanded', 'true');
    for (const label of ['Yes', 'No']) {
      const option = document.createElement('li'); option.setAttribute('role', 'option'); option.textContent = label;
      option.addEventListener('click', () => {
        button.value = label; button.textContent = label; button.setAttribute('aria-label', ` ${label} Required`);
        button.removeAttribute('aria-controls'); button.removeAttribute('aria-expanded'); list.remove();
      });
      list.append(option);
    }
    document.body.append(list);
  });
  const profile = emptyProfile(); profile.applicationDefaults = { relocation: 'yes', visaSponsorship: 'yes' };
  return { button, legend, profile, engine: createEngine(document) };
}

test('reads the fieldset question and required marker instead of the selection caption', () => {
  const { button } = questionnaire();
  expect(inspectField(button)).toMatchObject({ label: question, required: true, trustedLabel: true });
});

test('fills a lazy questionnaire menu and keeps its question identity after selection', async () => {
  const { button, profile, engine } = questionnaire();
  const before = fieldIdentity(inspectField(button)!);
  const plan = await engine.scan(profile);
  expect(plan.fields).toHaveLength(1);
  expect(plan.fields[0]).toMatchObject({ label: question, status: 'ready' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(button.value).toBe('Yes');
  expect(fieldIdentity(inspectField(button)!)).toBe(before);
});

test('recognizes a sponsorship question through the same fieldset structure', async () => {
  const { profile, engine } = questionnaire('Will you require visa sponsorship?');
  const plan = await engine.scan(profile);
  expect(plan.fields[0]).toMatchObject({ label: 'Will you require visa sponsorship?', status: 'ready' });
});

test('still blocks an attestation in the legend', async () => {
  const { profile, engine } = questionnaire('I acknowledge that these answers are accurate');
  const plan = await engine.scan(profile);
  expect(plan.fields[0].status).not.toBe('ready');
});

test('a changed legend invalidates a pending answer', async () => {
  const { button, legend, profile, engine } = questionnaire();
  const plan = await engine.scan(profile);
  expect(plan.fields[0].status).toBe('ready');
  legend.textContent = 'Would you consider relocating without visa sponsorship?';
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 0 });
  expect(button.value).toBe('');
});

test.each(['another visible input', 'another legend', 'hidden legend', 'different accessible question'])(
  'does not borrow an ambiguous fieldset label: %s', change => {
    const { button, legend } = questionnaire();
    if (change === 'another visible input') document.querySelector('input')!.style.display = '';
    if (change === 'another legend') legend.insertAdjacentHTML('afterend', '<legend>A different question</legend>');
    if (change === 'hidden legend') legend.hidden = true;
    if (change === 'different accessible question') button.setAttribute('aria-label', 'A different question');
    expect(inspectField(button)?.label).not.toBe(question);
  },
);
