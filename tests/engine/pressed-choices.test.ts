import { afterEach, expect, it } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const question = 'Are you open to relocation?';

function ashbyGroup({
  caption = `<label>${question} <span aria-hidden="true">*</span></label>`,
  yes = '<button data-option="yes" aria-pressed="false">Yes</button>',
  no = '<button data-option="no" aria-pressed="false">No</button>',
  backing = '<input type="checkbox" aria-hidden="true" tabindex="-1" hidden>',
} = {}) {
  return `<div class="ashby-application-form-field-entry">${caption}
    <div id="choice" class="ashby-application-form-input-yesno">${yes}${no}${backing}</div>
  </div>`;
}

function simulateChoice() {
  const choices = document.querySelector<HTMLElement>('#choice')!;
  choices.addEventListener('click', (event) => {
    const selected = (event.target as HTMLElement).closest('button');
    if (!selected) return;
    for (const button of choices.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button === selected));
    }
    const backing = choices.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (backing) backing.checked = true;
  });
  return choices;
}

function profileFor(answer: 'Yes' | 'No' = 'Yes') {
  return { ...emptyProfile(), answers: [{ question, answer }] };
}

afterEach(() => { document.body.innerHTML = ''; });

it('discovers the Ashby question once and commits its answer through the site button', async () => {
  document.body.innerHTML = ashbyGroup();
  const group = simulateChoice();
  const engine = createEngine(document);
  const plan = await engine.scan(profileFor());

  expect(plan.fields).toMatchObject([{ label: question, kind: 'radio', required: true, options: ['Yes', 'No'], status: 'ready' }]);
  expect(group.querySelector('[aria-pressed="true"]')).toBeNull();
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe('Yes');
  expect(group.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
  expect(await engine.scan(profileFor('No'))).toMatchObject({ fields: [{ status: 'preserved', currentValue: 'Yes' }] });
});

it('fills a choice when the rendered and accessible captions agree', async () => {
  document.body.innerHTML = '<span id="no-caption" hidden>No</span>' + ashbyGroup({
    yes: '<button aria-label="yes" aria-pressed="false">Yes</button>',
    no: '<button aria-labelledby="no-caption" aria-pressed="false">No</button>',
  });
  const group = simulateChoice();
  const engine = createEngine(document);
  const plan = await engine.scan(profileFor('No'));

  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe('No');
});

it('leaves an originally empty choice selected when the site offers no reset', async () => {
  document.body.innerHTML = ashbyGroup();
  const group = simulateChoice();
  const engine = createEngine(document);
  const plan = await engine.scan(profileFor());
  await engine.fill(plan.scanId);

  expect(await engine.undo(plan.scanId)).toEqual({ restored: 0, skipped: 1 });
  expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe('Yes');
});

it('restores a prior answer in an explicitly labeled group of safe buttons', async () => {
  document.body.innerHTML = `<form><p id="prompt">${question}</p>
    <div id="choice" role="group" aria-labelledby="prompt">
      <button type="button" aria-pressed="false">Yes</button>
      <button type="button" aria-pressed="true">No</button>
    </div></form>`;
  const group = simulateChoice();
  const engine = createEngine(document);
  const plan = await engine.scan(profileFor(), { overwriteExisting: true });

  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(await engine.undo(plan.scanId)).toEqual({ restored: 1, skipped: 0 });
  expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe('No');
});

it('excludes the hidden validation checkbox even when it has a native label', async () => {
  document.body.innerHTML = `<form>${ashbyGroup({
    caption: `<label for="validation">${question}</label>`,
    yes: '<button type="button" aria-pressed="false">Yes</button>',
    no: '<button type="button" aria-pressed="false">No</button>',
    backing: '<input id="validation" type="checkbox" tabindex="-1" hidden>',
  })}</form>`;
  const plan = await createEngine(document).scan(profileFor());
  expect(plan.fields).toMatchObject([{ kind: 'radio', label: question, status: 'ready' }]);
});

it('does not use a replaced option even when its appearance and metadata are unchanged', async () => {
  document.body.innerHTML = ashbyGroup();
  const group = simulateChoice();
  const engine = createEngine(document);
  const plan = await engine.scan(profileFor());
  const original = group.querySelector('button')!;
  original.replaceWith(original.cloneNode(true));

  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 0, skipped: 1 });
  expect(group.querySelector('[aria-pressed="true"]')).toBeNull();
});

it.each([
  ['an implicit submit button in a form', `<form>${ashbyGroup()}</form>`],
  ['a button attached to a form elsewhere', `<form id="remote"></form>${ashbyGroup({ yes: '<button form="remote" aria-pressed="false">Yes</button>' })}`],
  ['an explicit reset action', ashbyGroup({ yes: '<button type="reset" aria-pressed="false">Yes</button>' })],
  ['an ambiguous caption', ashbyGroup({ caption: `<label>${question}</label><label>Another question</label>` })],
  ['a missing caption', ashbyGroup({ caption: '' })],
  ['duplicate choice names', ashbyGroup({ no: '<button aria-pressed="false">Yes</button>' })],
  ['swapped aria-label captions', ashbyGroup({
    yes: '<button aria-label="Yes" aria-pressed="false">No</button>',
    no: '<button aria-label="No" aria-pressed="false">Yes</button>',
  })],
  ['swapped aria-labelledby captions', '<span id="yes-caption" hidden>Yes</span><span id="no-caption" hidden>No</span>' + ashbyGroup({
    yes: '<button aria-labelledby="yes-caption" aria-pressed="false">No</button>',
    no: '<button aria-labelledby="no-caption" aria-pressed="false">Yes</button>',
  })],
  ['swapped captions on visible text marked aria-hidden', ashbyGroup({
    yes: '<button aria-label="Yes" aria-pressed="false"><span aria-hidden="true">No</span></button>',
    no: '<button aria-label="No" aria-pressed="false"><span aria-hidden="true">Yes</span></button>',
  })],
  ['a disabled choice', ashbyGroup({ no: '<button disabled aria-pressed="false">No</button>' })],
  ['a second visible question control', ashbyGroup({ backing: '<label>Other question<input type="checkbox"></label>' })],
  ['multiple groups under one untargeted caption', ashbyGroup().replace('</label>', '</label><div class="ashby-application-form-input-yesno"><button aria-pressed="false">Yes</button><button aria-pressed="false">No</button></div>')],
  ['simultaneously pressed choices', ashbyGroup({ yes: '<button aria-pressed="true">Yes</button>', no: '<button aria-pressed="true">No</button>' })],
  ['a toolbar of unrelated actions', `<div id="choice" role="toolbar" aria-label="${question}">
    <button aria-pressed="false">Yes</button><button aria-pressed="false">No</button></div>`],
])('does not activate %s', async (_description, html) => {
  document.body.innerHTML = html;
  const pressed = () => [...document.querySelectorAll('button')].map((element) => element.getAttribute('aria-pressed'));
  const group = document.querySelector('#choice')!;
  let clicks = 0;
  group.addEventListener('click', () => { clicks++; });
  const initial = pressed();
  const engine = createEngine(document);
  const plan = await engine.scan(profileFor());

  await engine.fill(plan.scanId);

  expect(clicks).toBe(0);
  expect(pressed()).toEqual(initial);
});
