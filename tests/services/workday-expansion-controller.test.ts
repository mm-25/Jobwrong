import { afterEach, expect, test, vi } from 'vitest';
import { createPageController } from '../../src/page-controller';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function row(index: number, company = '', title = '') {
  const opaque = 265 + index * 18;
  return `<div role="group" aria-labelledby="Work-Experience-${index}-panel">
    <h5 id="Work-Experience-${index}-panel">Work Experience ${index}</h5>
    <label>Job Title<input id="workExperience-${opaque}--jobTitle" value="${title}"></label>
    <label>Company<input id="workExperience-${opaque}--companyName" value="${company}"></label>
  </div>`;
}

function fixture(rows = '') {
  document.body.innerHTML = `<main data-automation-id="applyFlowPage"><div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Work-Experience-section">
      <h4 id="Work-Experience-section">Work Experience</h4><div id="rows">${rows}</div>
      <button data-automation-id="add-button">Add Another</button>
    </div><button type="submit">Save and Continue</button>
  </div></main>`;
  const container = document.getElementById('rows')!;
  const add = vi.fn(() => container.insertAdjacentHTML('beforeend', row(container.children.length + 1)));
  document.querySelector('[data-automation-id="add-button"]')!.addEventListener('click', add);
  const advance = vi.fn();
  document.querySelector('[type="submit"]')!.addEventListener('click', advance);
  const profile = emptyProfile();
  profile.employment = ['Studio', 'Research Lab', 'Design Shop'].map((company, index) => ({
    company, title: `Designer ${index + 1}`, location: '', startDate: '', endDate: '', current: false, description: '',
  }));
  const controller = createPageController(document, createEngine(document), () => {});
  const values = () => [...container.querySelectorAll<HTMLInputElement>('input')].map(input => input.value);
  return { container, add, advance, profile, controller, values };
}

const complete = (controller: ReturnType<typeof createPageController>) =>
  vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 5000 });

test('one Autofill uses blank rows, adds only missing records, and preserves edited rows on Undo', async () => {
  const { controller, profile, add, advance, values, container } = fixture(row(1) + row(2, 'Local project', 'Volunteer'));
  expect(controller.start(profile)).toBe(true);
  await complete(controller);
  expect(values()).toEqual(['Designer 1', 'Studio', 'Volunteer', 'Local project', 'Designer 2', 'Research Lab', 'Designer 3', 'Design Shop']);
  expect(add).toHaveBeenCalledTimes(2);
  expect(controller.status()).toMatchObject({ filled: 6, failed: 0 });
  controller.start(profile);
  await complete(controller);
  expect(add).toHaveBeenCalledTimes(2);
  await controller.undo();
  expect(values()).toEqual(['', '', 'Volunteer', 'Local project', '', '', '', '']);
  expect(container.children).toHaveLength(4);
  expect(advance).not.toHaveBeenCalled();
});

test('an initially empty work-history group can add and fill rows on the same click', async () => {
  const { controller, profile, add, values, advance } = fixture();
  controller.start(profile);
  await complete(controller);
  expect(values()).toEqual(['Designer 1', 'Studio', 'Designer 2', 'Research Lab', 'Designer 3', 'Design Shop']);
  expect(add).toHaveBeenCalledTimes(3);
  expect(advance).not.toHaveBeenCalled();
});

test('a replacement work-history group is not authorized by the original click', async () => {
  const { controller, profile, container } = fixture();
  document.querySelector('[data-automation-id="add-button"]')!.addEventListener('click', () => {
    const group = container.parentElement!;
    group.replaceWith(group.cloneNode(true));
  });
  controller.start(profile);
  await complete(controller);
  expect([...document.querySelectorAll('input')].map(input => input.value)).toEqual(['', '']);
  expect(controller.status().filled).toBe(0);
});

test('uploads and waits for the résumé receipt before allocating rows parsed from that résumé', async () => {
  const { controller, profile, container, add, values } = fixture();
  document.querySelector('[data-automation-id="applyFlowMyExpPage"]')!.insertAdjacentHTML('beforeend', `
    <div role="group" aria-labelledby="Resume/CV-section"><h4 id="Resume/CV-section">Resume/CV</h4>
      <div data-automation-id="formField-"><label id="resume-label">Upload a file (5MB max)</label>
      <div data-automation-id="attachments-FileUpload" aria-labelledby="resume-label"><input type="file" hidden multiple data-automation-id="file-upload-input-ref">
        <div data-automation-id="file-upload-drop-zone"><button type="button" id="resumeAttachments--attachments" data-automation-id="select-files">Select files</button></div>
      </div></div>
    </div>`);
  const file = document.querySelector<HTMLInputElement>('input[type=file]')!;
  vi.stubGlobal('DataTransfer', class {
    readonly files: File[] = [];
    readonly items = { add: (entry: File) => this.files.push(entry) };
  });
  let assigned: FileList | null = null;
  Object.defineProperty(file, 'files', { get: () => assigned, set: (next: FileList) => { assigned = next; } });
  file.addEventListener('change', () => {
    if (!file.files?.length) return;
    expect(add).not.toHaveBeenCalled();
    const upload = file.parentElement!;
    upload.setAttribute('aria-busy', 'true');
    window.setTimeout(() => {
      container.innerHTML = row(1, 'Research Lab', 'Designer 2');
      const name = document.createElement('span'); name.textContent = 'synthetic.pdf';
      const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', 'Delete attachment');
      const receipt = document.createElement('div'); receipt.append(name, remove); upload.append(receipt);
      upload.removeAttribute('aria-busy');
    }, 30);
  });
  profile.resume = { name: 'synthetic.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,Zml4dHVyZQ==', lastModified: 1 };
  controller.start(profile);
  await complete(controller);
  expect(values()).toEqual(['Designer 2', 'Research Lab', 'Designer 1', 'Studio', 'Designer 3', 'Design Shop']);
  expect(add).toHaveBeenCalledTimes(2);
  expect(controller.status()).toMatchObject({ filled: 5, failed: 0 });
});
