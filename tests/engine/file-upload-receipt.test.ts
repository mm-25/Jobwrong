import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const profile = emptyProfile();
profile.resume = { name: 'fixture.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,Zml4dHVyZQ==', lastModified: 1 };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function fixture() {
  document.body.innerHTML = `<form id="application-form" class="application--form">
    <div class="file-upload" aria-labelledby="resume-label"><p id="resume-label">Resume/CV</p>
      <div class="file-upload__wrapper" id="resume-wrapper"><label for="resume">Attach</label>
        <input id="resume" name="resume" type="file" accept=".pdf" hidden></div>
    </div>
    <div class="file-upload" aria-labelledby="cover-label"><p id="cover-label">Cover Letter</p>
      <div class="file-upload__wrapper" id="cover-wrapper"></div>
    </div></form>`;
  const input = document.querySelector<HTMLInputElement>('#resume')!;
  const resume = document.querySelector<HTMLElement>('#resume-wrapper')!;
  const cover = document.querySelector<HTMLElement>('#cover-wrapper')!;

  // jsdom has no assignable native DataTransfer file list.
  vi.stubGlobal('DataTransfer', class {
    readonly files: File[] = [];
    readonly items = { add: (file: File) => this.files.push(file) };
  });
  let files: FileList | null = null;
  Object.defineProperty(input, 'files', {
    get: () => files,
    set: (value: FileList) => { files = value; },
  });
  return { engine: createEngine(document), input, resume, cover };
}

function showReceipt(container: HTMLElement, name: string) {
  const filename = document.createElement('div');
  filename.className = 'file-upload__filename';
  filename.textContent = name;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove attachment');
  const removeAction = vi.fn(() => container.replaceChildren());
  remove.addEventListener('click', removeAction);
  container.append(filename, remove);
  return removeAction;
}

test('counts a confirmed upload after Greenhouse replaces the file input with an attachment receipt', async () => {
  const { engine, input, resume } = fixture();
  let removeAction: ReturnType<typeof showReceipt> | undefined;
  input.addEventListener('change', () => {
    const name = input.files?.[0]?.name;
    if (!name) return;
    resume.replaceChildren();
    window.setTimeout(() => { removeAction = showReceipt(resume, name); }, 70);
  });

  const plan = await engine.scan(profile);
  expect(plan.fields[0]).toMatchObject({ label: 'Resume/CV', status: 'ready' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0, undoAvailable: false });
  expect(input.isConnected).toBe(false);
  expect(resume.querySelector('.file-upload__filename')?.textContent).toBe('fixture.pdf');

  expect(await engine.undo(plan.scanId)).toEqual({ restored: 0, skipped: 1 });
  expect(removeAction).not.toHaveBeenCalled();
});

test('Undo restores a contact field and reports the site-managed attachment as kept', async () => {
  const { engine, input, resume } = fixture();
  document.querySelector('form')!.insertAdjacentHTML('afterbegin', '<label>First name<input autocomplete="given-name"></label>');
  const name = document.querySelector<HTMLInputElement>('[autocomplete="given-name"]')!;
  const candidate = { ...profile, personal: { ...profile.personal, firstName: 'Fixture' } };
  let removeAction: ReturnType<typeof showReceipt> | undefined;
  input.addEventListener('change', () => {
    resume.replaceChildren();
    removeAction = showReceipt(resume, 'fixture.pdf');
  });

  const plan = await engine.scan(candidate);
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 2, failed: 0, undoAvailable: true });
  expect(name.value).toBe('Fixture');
  expect(await engine.undo(plan.scanId)).toEqual({ restored: 1, skipped: 1 });
  expect(name.value).toBe('');
  expect(resume.querySelector('.file-upload__filename')?.textContent).toBe('fixture.pdf');
  expect(removeAction).not.toHaveBeenCalled();
});

test.each([
  { present: true, separateBatch: false, restored: 0, skipped: 2 },
  { present: false, separateBatch: false, restored: 1, skipped: 0 },
  { present: true, separateBatch: true, restored: 1, skipped: 1 },
])('Undo preserves an earlier prerequisite only in its attachment batch (present: $present, separate: $separateBatch)', async ({ present, separateBatch, restored, skipped }) => {
  const { engine, input, resume } = fixture();
  const group = resume.closest<HTMLElement>('.file-upload')!;
  group.hidden = true;
  document.querySelector('form')!.insertAdjacentHTML('afterbegin', '<label>Include a résumé<input type="checkbox" id="show-resume"></label>');
  const prerequisite = document.querySelector<HTMLInputElement>('#show-resume')!;
  prerequisite.addEventListener('change', () => {
    group.hidden = !prerequisite.checked;
    if (group.hidden) resume.replaceChildren();
  });
  input.addEventListener('change', () => {
    resume.replaceChildren();
    showReceipt(resume, 'fixture.pdf');
  });
  const candidate = { ...profile, answers: [{ question: 'Include a résumé', answer: 'Yes' }] };
  const first = await engine.scan(candidate);
  expect(await engine.fill(first.scanId)).toMatchObject({ filled: 1, undoAvailable: true });
  const next = await engine.scan(candidate);
  expect(await engine.fill(next.scanId, undefined, first.scanId)).toMatchObject({ filled: 1, undoAvailable: false });

  if (!present) resume.replaceChildren();
  let undoId = first.scanId;
  let contact: HTMLInputElement | undefined;
  if (separateBatch) {
    document.querySelector('form')!.insertAdjacentHTML('beforeend', '<label>First name<input autocomplete="given-name"></label>');
    contact = document.querySelector<HTMLInputElement>('[autocomplete="given-name"]')!;
    const independent = await engine.scan({ ...candidate, personal: { ...candidate.personal, firstName: 'Fixture' } });
    expect(await engine.fill(independent.scanId)).toMatchObject({ filled: 1, undoAvailable: true });
    undoId = independent.scanId;
  }
  expect(await engine.undo(undoId)).toEqual({ restored, skipped });
  if (contact) expect(contact.value).toBe('');
  expect(prerequisite.checked).toBe(present);
  expect(resume.querySelector('.file-upload__filename')?.textContent).toBe(present ? 'fixture.pdf' : undefined);
});

test('does not use a matching receipt in a different upload group', async () => {
  const { engine, input, resume, cover } = fixture();
  input.addEventListener('change', () => {
    resume.replaceChildren();
    showReceipt(cover, 'fixture.pdf');
  });

  const plan = await engine.scan(profile);
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
});

test('preserves a preexisting attachment even when the site retains an empty replacement input', async () => {
  const { engine, input, resume } = fixture();
  const changed = vi.fn();
  input.addEventListener('change', changed);
  const remove = showReceipt(resume, 'already-uploaded.pdf');

  const plan = await engine.scan(profile);
  expect(plan.fields[0]).toMatchObject({ status: 'preserved', currentValue: 'already-uploaded.pdf' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 0, failed: 0 });
  expect(changed).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

test.each([
  { pending: 'disabled Remove', succeeds: true },
  { pending: 'busy group', succeeds: true },
  { pending: 'busy group', succeeds: false },
])('waits for a $pending receipt to settle (success: $succeeds)', async ({ pending, succeeds }) => {
  vi.useFakeTimers();
  const { engine, input, resume } = fixture();
  const group = resume.closest('.file-upload')!;
  input.addEventListener('change', () => {
    resume.replaceChildren();
    showReceipt(resume, 'fixture.pdf');
    const button = resume.querySelector('button')!;
    if (pending === 'disabled Remove') button.disabled = true;
    else group.setAttribute('aria-busy', 'true');
    window.setTimeout(() => {
      button.disabled = false;
      group.removeAttribute('aria-busy');
      if (!succeeds) resume.textContent = 'Upload failed';
    }, 150);
  });

  const plan = await engine.scan(profile);
  let settled = false;
  const fill = engine.fill(plan.scanId).then(result => { settled = true; return result; });
  await vi.advanceTimersByTimeAsync(100);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(2100);
  expect(await fill).toMatchObject({ filled: Number(succeeds), failed: Number(!succeeds), undoAvailable: false });
});
