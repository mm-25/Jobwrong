import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function workdayRow(index: number) {
  return `<div role="group" aria-labelledby="Work-Experience-${index}-panel">
    <h5 id="Work-Experience-${index}-panel">Work Experience ${index}</h5>
    <label>Job Title<input id="workExperience-${300 + index * 3}--jobTitle"></label>
    <label>Company<input id="workExperience-${300 + index * 3}--companyName"></label>
  </div>`;
}

function workdayStep() {
  document.body.innerHTML = `<main data-automation-id="applyFlowPage"><div data-automation-id="applyFlowMyExpPage">
    <label>First Name<input id="first" autocomplete="given-name"></label>
    <div role="group" aria-labelledby="Work-Experience-section">
      <h4 id="Work-Experience-section">Work Experience</h4>
      <div id="workday-rows">${workdayRow(1)}</div>
      <button data-automation-id="add-button">Add Another</button>
    </div>
  </div></main>`;
  const page = document.querySelector('[data-automation-id="applyFlowMyExpPage"]')!;
  const first = document.querySelector<HTMLInputElement>('#first')!;
  const rows = document.getElementById('workday-rows')!;
  const add = document.querySelector<HTMLButtonElement>('[data-automation-id="add-button"]')!;
  const profile = emptyProfile();
  profile.personal.firstName = 'Saved name';
  profile.employment = ['Studio', 'Research Lab'].map((company, index) => ({
    company, title: `Designer ${index + 1}`, location: '', startDate: '', endDate: '', current: false, description: '',
  }));
  const controller = createPageController(document, createEngine(document), () => {});
  return {
    add, controller, first, page, profile, rows,
    completed: () => vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 5000 }),
    workValues: () => [...rows.querySelectorAll('input')].map(input => input.value),
  };
}

function enterAndClear(field: HTMLInputElement) {
  field.value = 'Manual response';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.value = '';
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

test('an unconfirmed addition does not authorize replacement rows inside the same Workday section', async () => {
  const { add, controller, profile, rows, completed, workValues } = workdayStep();
  add.addEventListener('click', () => { rows.innerHTML = workdayRow(1) + workdayRow(2); });
  controller.start(profile);
  await completed();
  expect(workValues()).toEqual(['', '', '', '']);
  expect(controller.status().experienceMessage).toMatch(/did not confirm|changed/i);
});

test('an initially empty native form authorizes rows added to its original Workday section', async () => {
  const { add, controller, first, page, profile, rows, completed, workValues } = workdayStep();
  first.closest('label')!.remove();
  rows.replaceChildren();
  const form = document.createElement('form');
  form.append(...page.childNodes);
  page.append(form);
  add.type = 'button';
  const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
  form.addEventListener('submit', submit);
  add.addEventListener('click', () => rows.insertAdjacentHTML('beforeend', workdayRow(rows.children.length + 1)));
  controller.start(profile);
  await completed();
  expect(workValues()).toEqual(['Designer 1', 'Studio', 'Designer 2', 'Research Lab']);
  expect(submit).not.toHaveBeenCalled();
});

test('a deliberate clear while a Workday Add is pending survives the refreshed scan', async () => {
  const { add, controller, first, profile, rows, completed, workValues } = workdayStep();
  add.addEventListener('click', () => {
    window.setTimeout(() => {
      enterAndClear(first);
      rows.insertAdjacentHTML('beforeend', workdayRow(2));
    }, 30);
  });
  controller.start(profile);
  await completed();
  expect(first.value).toBe('');
  expect(workValues()).toEqual(['Designer 1', 'Studio', 'Designer 2', 'Research Lab']);
});

test('explicit overwrite applies to unchanged original answers after Add while preserving newly populated fields', async () => {
  const { add, controller, first, page, profile, rows, completed } = workdayStep();
  first.value = 'Original name';
  profile.personal.lastName = 'Saved surname';
  add.addEventListener('click', () => {
    window.setTimeout(() => {
      rows.insertAdjacentHTML('beforeend', workdayRow(2));
      page.insertAdjacentHTML('beforeend', '<label>Last Name<input id="last" autocomplete="family-name" value="Imported surname"></label>');
    }, 30);
  });
  controller.start(profile, true);
  await completed();
  const last = page.querySelector<HTMLInputElement>('#last')!;
  expect(first.value).toBe('Saved name');
  expect(last.value).toBe('Imported surname');
  await controller.undo();
  expect(first.value).toBe('Original name');
  expect(last.value).toBe('Imported surname');
});

test('a deliberate clear while a Workday résumé receipt is pending survives the refreshed scan', async () => {
  const { add, controller, first, page, profile, rows, completed, workValues } = workdayStep();
  add.addEventListener('click', () => rows.insertAdjacentHTML('beforeend', workdayRow(2)));
  page.insertAdjacentHTML('beforeend', `
    <div role="group" aria-labelledby="Resume/CV-section"><h4 id="Resume/CV-section">Resume/CV</h4>
      <div data-automation-id="formField-"><label id="resume-label">Upload a file (5MB max)</label>
      <div data-automation-id="attachments-FileUpload" aria-labelledby="resume-label"><input type="file" hidden multiple data-automation-id="file-upload-input-ref">
        <div data-automation-id="file-upload-drop-zone"><button type="button" id="resumeAttachments--attachments" data-automation-id="select-files">Select files</button></div>
      </div></div>
    </div>`);
  vi.stubGlobal('DataTransfer', class {
    readonly files: File[] = [];
    readonly items = { add: (entry: File) => this.files.push(entry) };
  });
  const file = page.querySelector<HTMLInputElement>('input[type=file]')!;
  let assigned: FileList | null = null;
  Object.defineProperty(file, 'files', { get: () => assigned, set: (next: FileList) => { assigned = next; } });
  file.addEventListener('change', () => {
    if (!file.files?.length) return;
    const upload = file.parentElement!;
    upload.setAttribute('aria-busy', 'true');
    window.setTimeout(() => {
      enterAndClear(first);
      upload.insertAdjacentHTML('beforeend', '<div><span>synthetic.pdf</span><button type="button" aria-label="Delete attachment"></button></div>');
      upload.removeAttribute('aria-busy');
    }, 30);
  });
  profile.resume = { name: 'synthetic.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,Zml4dHVyZQ==', lastModified: 1 };
  controller.start(profile);
  await completed();
  expect(first.value).toBe('');
  expect(workValues()).toEqual(['Designer 1', 'Studio', 'Designer 2', 'Research Lab']);
  expect(controller.status()).toMatchObject({ filled: 5, failed: 0 });
});
