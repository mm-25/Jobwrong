import { expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';

function profileWithName() {
  const profile = emptyProfile();
  profile.personal.firstName = 'Lin';
  return profile;
}

test('starts immediately, runs without awaiting the caller, and refuses a concurrent start', async () => {
  document.body.innerHTML = `
    <form>
      <button type="button" aria-label="Office choice" role="combobox" aria-controls="offices" aria-expanded="false">Select One</button>
      <div id="offices" role="listbox" hidden></div>
    </form>`;
  const button = document.querySelector<HTMLButtonElement>('button')!;
  const list = document.querySelector<HTMLElement>('#offices')!;
  button.addEventListener('click', () => button.setAttribute('aria-expanded', 'true'));
  function showOptions() {
    list.hidden = false;
    list.innerHTML = '<div role="option">Detroit</div>';
    list.firstElementChild!.addEventListener('click', () => {
      button.textContent = 'Detroit';
      button.setAttribute('aria-expanded', 'false');
      list.hidden = true;
    });
  }
  const profile = { ...emptyProfile(), answers: [{ question: 'Office choice', answer: 'Detroit' }] };
  let shown = 0;
  const controller = createPageController(document, createEngine(document), () => { shown++; });

  expect(controller.start(profile)).toBe(true);
  expect(controller.status()).toMatchObject({ started: true, running: true, filled: 0 });
  expect(controller.start(emptyProfile())).toBe(false);
  expect(shown).toBe(1);
  await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
  expect(controller.status().running).toBe(true);

  showOptions();
  await vi.waitFor(() => expect(controller.status()).toMatchObject({ running: false, filled: 1, undoAvailable: true }));
  expect(button.textContent).toBe('Detroit');
});

test('reports newly revealed questions and preserves undo across a no-op fill', async () => {
  document.body.innerHTML = `
    <form>
      <label>First name<input autocomplete="given-name"></label>
      <div id="followup" hidden><label>Which days can you work?<input required></label></div>
    </form>`;
  const name = document.querySelector<HTMLInputElement>('[autocomplete="given-name"]')!;
  const followup = document.querySelector<HTMLElement>('#followup')!;
  name.addEventListener('input', () => { followup.hidden = !name.value; });
  const profile = profileWithName();
  const controller = createPageController(document, createEngine(document), () => {});

  expect(controller.start(profile)).toBe(true);
  await vi.waitFor(() => expect(controller.status()).toMatchObject({ running: false, filled: 1, undoAvailable: true }));
  expect(controller.status().remaining).toEqual([
    expect.objectContaining({ label: 'Which days can you work?', status: 'unanswered', required: true }),
  ]);
  expect(followup.hidden).toBe(false);
  expect(followup.querySelector('input')!.value).toBe('');

  expect(controller.start(profile)).toBe(true);
  await vi.waitFor(() => expect(controller.status()).toMatchObject({ running: false, filled: 0, undoAvailable: true }));
  await controller.undo();
  expect(controller.status()).toMatchObject({ running: false, undoAvailable: false });
  expect(name.value).toBe('');
  expect(followup.hidden).toBe(true);
});

test('drops the prior application undo state when a new application begins in the same page', async () => {
  document.body.innerHTML = '<form><label>First name<input autocomplete="given-name"></label></form>';
  const input = document.querySelector<HTMLInputElement>('input')!;
  const originalUrl = document.URL;
  const controller = createPageController(document, createEngine(document), () => {});
  try {
    expect(controller.start(profileWithName())).toBe(true);
    await vi.waitFor(() => expect(controller.status()).toMatchObject({ running: false, undoAvailable: true }));
    expect(input.value).toBe('Lin');

    history.pushState({}, '', '?application=next');
    expect(controller.start(emptyProfile())).toBe(true);
    await vi.waitFor(() => expect(controller.status().running).toBe(false));
    expect(controller.status()).toMatchObject({ url: document.URL, filled: 0, undoAvailable: false });
  } finally {
    history.replaceState({}, '', originalUrl);
  }
});

test('returns idle status and drops remaining fields when a completed application URL changes', async () => {
  document.body.innerHTML = `<form><label>First name<input autocomplete="given-name"></label>
    <label>What is your desired start date?<input required></label></form>`;
  const originalUrl = document.URL;
  const controller = createPageController(document, createEngine(document), () => {});
  try {
    controller.start(profileWithName());
    await vi.waitFor(() => expect(controller.status()).toMatchObject({ running: false, filled: 1, undoAvailable: true }));
    expect(controller.status().remaining).toEqual([expect.objectContaining({ label: 'What is your desired start date?' })]);

    history.pushState({}, '', '?application=next');
    expect(controller.status()).toMatchObject({ url: document.URL, started: false, filled: 0, failed: 0, undoAvailable: false, remaining: [] });
    history.replaceState({}, '', originalUrl);
    expect(controller.status()).toMatchObject({ started: false, undoAvailable: false, remaining: [] });
  } finally {
    history.replaceState({}, '', originalUrl);
  }
});

test('stops a local-only iframe run when the parent application changes routes', async () => {
  const originalUrl = document.URL;
  document.body.innerHTML = '<iframe></iframe>';
  const child = document.querySelector('iframe')!.contentDocument!;
  child.body.innerHTML = `<form><label>First name<input autocomplete="given-name"></label>
    <div id="follow-up" hidden><label>Last name<input autocomplete="family-name"></label></div></form>`;
  const first = child.querySelector<HTMLInputElement>('[autocomplete="given-name"]')!;
  const followUp = child.getElementById('follow-up')!;
  const last = followUp.querySelector('input')!;
  const profile = profileWithName();
  profile.personal.lastName = 'Fixture';
  const controller = createPageController(child, createEngine(child), () => {});
  first.addEventListener('input', () => {
    window.setTimeout(() => {
      history.pushState({}, '', '?application=other');
      followUp.hidden = false;
    }, 60);
  }, { once: true });

  try {
    expect(controller.start(profile)).toBe(true);
    await vi.waitFor(() => expect(controller.status().running).toBe(false));

    expect(first.value).toBe('Lin');
    expect(followUp.hidden).toBe(false);
    expect(last.value).toBe('');
    expect(controller.status()).toMatchObject({ undoAvailable: false, message: expect.stringMatching(/changed/i) });
  } finally {
    history.replaceState({}, '', originalUrl);
    document.body.replaceChildren();
  }
});

test('clears completed iframe status when only the parent application changes routes', async () => {
  const originalUrl = document.URL;
  document.body.innerHTML = '<iframe></iframe>';
  const child = document.querySelector('iframe')!.contentDocument!;
  child.body.innerHTML = `<form><label>First name<input autocomplete="given-name"></label>
    <label>What is your desired start date?<input required></label></form>`;
  const controller = createPageController(child, createEngine(child), () => {});
  try {
    controller.start(profileWithName());
    await vi.waitFor(() => expect(controller.status()).toMatchObject({ running: false, filled: 1, undoAvailable: true }));
    expect(controller.status().remaining).toHaveLength(1);

    history.replaceState({}, '', '?application=other');
    expect(controller.status()).toMatchObject({ started: false, filled: 0, remaining: [], undoAvailable: false });
  } finally {
    history.replaceState({}, '', originalUrl);
    document.body.replaceChildren();
  }
});

test('binds a reviewed iframe fill to its parent route and rejects Undo on a later route', async () => {
  const originalUrl = document.URL;
  document.body.innerHTML = '<iframe></iframe>';
  const child = document.querySelector('iframe')!.contentDocument!;
  child.body.innerHTML = '<form><label>First name<input autocomplete="given-name"></label></form>';
  const engine = createEngine(child);
  const controller = createPageController(child, engine, () => {});
  const undo = vi.spyOn(engine, 'undo');
  const input = child.querySelector('input')!;
  try {
    history.replaceState({}, '', '?application=reviewed');
    const scan = await engine.scan(profileWithName());
    controller.noteFill(scan.scanId, await engine.fill(scan.scanId));
    expect(controller.status()).toMatchObject({ filled: 1, undoAvailable: true });

    history.replaceState({}, '', '?application=other');
    await controller.undo();
    expect(undo).not.toHaveBeenCalled();
    expect(input.value).toBe('Lin');
    expect(controller.status().undoAvailable).toBe(false);
  } finally {
    history.replaceState({}, '', originalUrl);
    document.body.replaceChildren();
  }
});

test('reports a choice that cannot be reset without implying that the applicant edited it', async () => {
  document.body.innerHTML = `<form>
    <div role="group" aria-label="Are you open to relocation?">
      <button type="button" aria-pressed="false">Yes</button>
      <button type="button" aria-pressed="false">No</button>
    </div></form>`;
  const yes = document.querySelector('button')!;
  yes.addEventListener('click', () => yes.setAttribute('aria-pressed', 'true'));
  const profile = { ...emptyProfile(), applicationDefaults: { relocation: 'yes' as const } };
  const controller = createPageController(document, createEngine(document), () => {});

  controller.start(profile);
  await vi.waitFor(() => expect(controller.status()).toMatchObject({ running: false, filled: 1, undoAvailable: true }));
  await controller.undo();

  expect(yes.getAttribute('aria-pressed')).toBe('true');
  expect(controller.status().message).toBe('0 restored · 1 kept');
});

test('tracks a reviewed browser fill on the current SPA route and undoes its scan', async () => {
  document.body.innerHTML = '<form><label>First name<input autocomplete="given-name"></label></form>';
  const input = document.querySelector<HTMLInputElement>('input')!;
  const originalUrl = document.URL;
  const engine = createEngine(document);
  const controller = createPageController(document, engine, () => {});
  try {
    history.pushState({}, '', '?application=review');
    const scan = await engine.scan(profileWithName());
    const fill = await engine.fill(scan.scanId);
    controller.noteFill(scan.scanId, fill);

    expect(input.value).toBe('Lin');
    expect(controller.status()).toMatchObject({ url: document.URL, filled: 1, undoAvailable: true });
    await controller.undo();
    expect(input.value).toBe('');
  } finally {
    history.replaceState({}, '', originalUrl);
  }
});

test('keeps a later fill when the controller only knows the earlier scan ID', async () => {
  document.body.innerHTML = `
    <form>
      <label>First name<input autocomplete="given-name"></label>
      <label>Last name<input autocomplete="family-name"></label>
    </form>`;
  const engine = createEngine(document);
  const controller = createPageController(document, engine, () => {});
  expect(controller.start(profileWithName())).toBe(true);
  await vi.waitFor(() => expect(controller.status()).toMatchObject({ running: false, undoAvailable: true }));

  const later = emptyProfile();
  later.personal.lastName = 'Smith';
  const scan = await engine.scan(later);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  await controller.undo();

  expect([...document.querySelectorAll<HTMLInputElement>('input')].map((input) => input.value)).toEqual(['Lin', 'Smith']);
  expect(controller.status().undoAvailable).toBe(false);
});

test('reports an uncommitted dropdown answer with its fill failure reason after rescanning', async () => {
  document.body.innerHTML = `
    <form>
      <button type="button" role="combobox" aria-label="Office choice" aria-controls="offices" aria-expanded="false">Select One</button>
    </form>`;
  const button = document.querySelector<HTMLButtonElement>('button')!;
  button.addEventListener('click', () => {
    button.setAttribute('aria-expanded', 'true');
    button.insertAdjacentHTML('afterend', '<div id="offices" role="listbox"><div role="option">Detroit</div></div>');
  });
  const profile = { ...emptyProfile(), answers: [{ question: 'Office choice', answer: 'Detroit' }] };
  const controller = createPageController(document, createEngine(document), () => {});
  expect(controller.start(profile)).toBe(true);
  await vi.waitFor(() => expect(controller.status()).toMatchObject({ running: false, failed: 1, filled: 0 }));

  expect(button.textContent).toBe('Select One');
  expect(controller.status().remaining).toEqual([
    expect.objectContaining({ label: 'Office choice', status: 'unsupported', reason: expect.stringMatching(/did not retain/i) }),
  ]);
});
