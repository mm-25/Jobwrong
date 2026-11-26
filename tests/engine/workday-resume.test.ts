import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function application() {
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Resume/CV-section">
      <h4 id="Resume/CV-section">Resume/CV</h4>
      <div data-automation-id="formField-">
        <label id="label266">Upload a file (5MB max)</label>
        <div aria-labelledby="label266" data-automation-id="attachments-FileUpload">
          <div><input type="file" multiple hidden data-automation-id="file-upload-input-ref"></div>
          <div data-automation-id="file-upload-drop-zone">
            <button type="button" id="resumeAttachments--attachments" data-automation-id="select-files">Select files</button>
          </div>
        </div>
      </div>
    </div>
    <div role="group" aria-label="Cover Letter">
      <input type="file" hidden data-automation-id="file-upload-input-ref">
    </div>
  </main>`;
  vi.stubGlobal('DataTransfer', class {
    readonly files: File[] = [];
    readonly items = { add: (file: File) => this.files.push(file) };
  });
  const input = document.querySelector<HTMLInputElement>('input')!;
  const wrapper = input.closest<HTMLElement>('[data-automation-id="attachments-FileUpload"]')!;
  let assigned: FileList | null = null;
  Object.defineProperty(input, 'files', {
    get: () => assigned,
    set: (value: FileList) => { assigned = value; },
  });
  const profile = emptyProfile();
  profile.resume = { name: 'fixture.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,Zml4dHVyZQ==', lastModified: 1 };
  return { engine: createEngine(document), input, wrapper, profile };
}

function receipt(target: HTMLElement, filename: string) {
  const item = document.createElement('div');
  const caption = document.createElement('span');
  caption.textContent = filename;
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Delete attachment');
  item.append(caption, button);
  target.append(item);
  return button;
}

test('uploads through the hidden Workday résumé control and accepts the original section’s completed receipt after input remount', async () => {
  const { engine, input, wrapper, profile } = application();
  let deleteReceipt: ReturnType<typeof vi.fn> | undefined;
  input.addEventListener('change', () => {
    const filename = input.files?.[0]?.name;
    if (!filename) return;
    const next = wrapper.cloneNode(false) as HTMLElement;
    wrapper.replaceWith(next);
    next.setAttribute('aria-busy', 'true');
    const remove = receipt(next, filename);
    deleteReceipt = vi.fn();
    remove.addEventListener('click', deleteReceipt);
    window.setTimeout(() => next.removeAttribute('aria-busy'), 40);
  });

  const scan = await engine.scan(profile);
  expect(scan.fields).toEqual([expect.objectContaining({ label: 'Resume/CV', kind: 'file', status: 'ready' })]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0, undoAvailable: false });
  expect(input.isConnected).toBe(false);
  expect(await engine.undo(scan.scanId)).toEqual({ restored: 0, skipped: 1 });
  expect(deleteReceipt).not.toHaveBeenCalled();
});

test('keeps an existing attachment when Workday still renders an empty input for additional files', async () => {
  const { engine, input, wrapper, profile } = application();
  receipt(wrapper, 'attached.docx');
  const scan = await engine.scan(profile, { overwriteExisting: true });
  expect(scan.fields).toEqual([expect.objectContaining({ label: 'Resume/CV', status: 'preserved', currentValue: 'attached.docx' })]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 0 });
  expect(input.files).toBeNull();
});

test('confirms the uploaded résumé when another attachment appears first during the upload', async () => {
  vi.useFakeTimers();
  const { engine, input, wrapper, profile } = application();
  input.addEventListener('change', () => {
    const filename = input.files?.[0]?.name;
    if (!filename) return;
    receipt(wrapper, 'manual.docx');
    window.setTimeout(() => receipt(wrapper, filename), 40);
  });

  const scan = await engine.scan(profile);
  const fill = engine.fill(scan.scanId);
  await vi.advanceTimersByTimeAsync(9000);
  expect(await fill).toMatchObject({ filled: 1, failed: 0, undoAvailable: false });
  expect([...wrapper.querySelectorAll('span')].map(span => span.textContent)).toEqual(['manual.docx', 'fixture.pdf']);
});

test('Undo counts the uploaded résumé as kept when a different Workday attachment was later inserted first', async () => {
  const { engine, input, wrapper, profile } = application();
  input.addEventListener('change', () => {
    const filename = input.files?.[0]?.name;
    if (filename) receipt(wrapper, filename);
  });

  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  const manual = receipt(wrapper, 'manual.docx');
  wrapper.prepend(manual.parentElement!);
  for (const remove of wrapper.querySelectorAll('button[aria-label="Delete attachment"]')) {
    remove.addEventListener('click', () => remove.parentElement?.remove());
  }

  expect(await engine.undo(scan.scanId)).toEqual({ restored: 0, skipped: 1 });
  expect([...wrapper.querySelectorAll('span')].map(span => span.textContent)).toEqual(['manual.docx', 'fixture.pdf']);
});

test('does not treat a native FileList or a filename in another Workday section as upload confirmation', async () => {
  vi.useFakeTimers();
  const { engine, input, profile } = application();
  input.addEventListener('change', () => {
    receipt(document.querySelector<HTMLElement>('[aria-label="Cover Letter"]')!, input.files![0].name);
  });
  const scan = await engine.scan(profile);
  const fill = engine.fill(scan.scanId);
  await vi.advanceTimersByTimeAsync(9000);
  expect(await fill).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
});
