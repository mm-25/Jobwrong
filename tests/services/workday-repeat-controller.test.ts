import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';
import type { Profile } from '../../src/shared/types';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function educationRow(index: number, degree = '', school = ''): string {
  const id = 229 + index * 12;
  return `<div role="group" aria-labelledby="Education-${index}-panel">
    <h5 id="Education-${index}-panel">Education ${index}</h5>
    <div data-fkit-id="education-${id}--null">
      <div data-automation-id="formField-schoolName">
        <label for="education-${id}--schoolName">School or University</label>
        <input id="education-${id}--schoolName" name="schoolName" value="${school}">
      </div>
      <label for="education-${id}--degree">Degree</label>
      <select id="education-${id}--degree">
        <option></option>
        <option ${degree === 'Bachelor of Science' ? 'selected' : ''}>Bachelor of Science</option>
        <option ${degree === 'Master of Science' ? 'selected' : ''}>Master of Science</option>
      </select>
    </div>
  </div>`;
}

function websiteRow(index: number, value = ''): string {
  const record = `webAddress-${569 + index * 19}`;
  return `<div role="group" aria-labelledby="Websites-${index}-panel">
    <h5 id="Websites-${index}-panel">Websites ${index}</h5>
    <div data-fkit-id="${record}--null">
      <div data-automation-id="formField-url" data-fkit-id="${record}--url">
        <label for="${record}--url">URL*</label>
        <input type="text" id="${record}--url" name="url" aria-required="true" value="${value}">
      </div>
    </div>
  </div>`;
}

function fixture(education = '', websites = '') {
  document.body.innerHTML = `<main data-automation-id="applyFlowPage"><div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Education-section">
      <h4 id="Education-section">Education</h4><div id="degrees">${education}</div>
      <button data-automation-id="add-button">${education ? 'Add Another' : 'Add'}</button>
    </div>
    <div role="group" aria-labelledby="Websites-section">
      <h4 id="Websites-section">Websites</h4><div id="urls">${websites}</div>
      <button data-automation-id="add-button">${websites ? 'Add Another' : 'Add'}</button>
    </div>
    <button type="submit">Save and Continue</button>
  </div></main>`;
  const degrees = document.getElementById('degrees')!;
  const urls = document.getElementById('urls')!;
  const clicks: string[] = [];
  degrees.nextElementSibling!.addEventListener('click', () => {
    clicks.push('Education');
    degrees.insertAdjacentHTML('beforeend', educationRow(degrees.children.length + 1));
  });
  urls.nextElementSibling!.addEventListener('click', () => {
    clicks.push('Websites');
    urls.insertAdjacentHTML('beforeend', websiteRow(urls.children.length + 1));
  });
  document.querySelector('[type="submit"]')!.addEventListener('click', () => { clicks.push('Save and Continue'); });
  const profile = emptyProfile();
  profile.personal.website = 'https://portfolio.example.test';
  profile.personal.github = 'https://github.com/example-applicant';
  profile.education = [
    { school: 'Example College', degree: 'Bachelor of Science', fieldOfStudy: '', startDate: '', endDate: '', gpa: '' },
    { school: 'Example University', degree: 'Master of Science', fieldOfStudy: '', startDate: '', endDate: '', gpa: '' },
  ];
  const engine = createEngine(document);
  const controller = createPageController(document, engine, () => {});
  return {
    profile, engine, controller, clicks,
    degrees: () => [...degrees.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].map(field => field.value),
    websites: () => [...urls.querySelectorAll<HTMLInputElement>('input')].map(field => field.value),
  };
}

const complete = (controller: ReturnType<typeof createPageController>) =>
  vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 5000 });

test('one Autofill creates and fills both initially empty Workday repeat sections', async () => {
  const { controller, profile, degrees, websites, clicks, engine } = fixture();
  await engine.scan(profile);
  expect(clicks).toEqual([]);
  expect(controller.start(profile)).toBe(true);
  await complete(controller);
  expect(degrees()).toEqual(['Example College', 'Bachelor of Science', 'Example University', 'Master of Science']);
  expect(websites()).toEqual(['https://portfolio.example.test', 'https://github.com/example-applicant']);
  expect(clicks.filter(click => click === 'Education')).toHaveLength(2);
  expect(clicks.filter(click => click === 'Websites')).toHaveLength(2);
  expect(clicks).not.toContain('Save and Continue');
  const scan = await engine.scan(profile);
  expect(scan.fields.map(field => field.section)).toEqual([
    'Education · 1', 'Education · 1', 'Education · 2', 'Education · 2', 'Websites · 1', 'Websites · 2',
  ]);
  expect(controller.start(profile)).toBe(true);
  await complete(controller);
  expect(clicks).toHaveLength(4);
});

test('keeps a manual partial degree and existing Website links through Autofill and Undo', async () => {
  const { controller, profile, degrees, websites, clicks } = fixture(
    educationRow(1, 'Master of Science'),
    websiteRow(1, 'https://unrelated.example.test') + websiteRow(2, 'https://portfolio.example.test/') + websiteRow(3),
  );
  expect(controller.start(profile)).toBe(true);
  await complete(controller);
  expect(degrees()).toEqual(['Example University', 'Master of Science', 'Example College', 'Bachelor of Science']);
  expect(websites()).toEqual(['https://unrelated.example.test', 'https://portfolio.example.test/', 'https://github.com/example-applicant']);
  expect(clicks).toEqual(['Education']);
  await controller.undo();
  expect(degrees()).toEqual(['', 'Master of Science', '', '']);
  expect(websites()).toEqual(['https://unrelated.example.test', 'https://portfolio.example.test/', '']);
});

test('uses the selected degree to distinguish two records from the same school', async () => {
  const { controller, profile, degrees, clicks } = fixture(educationRow(1, 'Master of Science', 'Example University'));
  profile.education[0].school = 'Example University';
  profile.personal.website = '';
  profile.personal.github = '';
  controller.start(profile);
  await complete(controller);
  expect(degrees()).toEqual(['Example University', 'Master of Science', 'Example University', 'Bachelor of Science']);
  expect(clicks).toEqual(['Education']);
});

test('leaves a school-only row and a spare blank row untouched when the institution matches two saved degrees', async () => {
  const { controller, profile, degrees, clicks } = fixture(educationRow(1, '', 'Example University') + educationRow(2));
  profile.education[0].school = 'Example University';
  profile.personal.website = '';
  profile.personal.github = '';
  controller.start(profile);
  await complete(controller);
  expect(degrees()).toEqual(['Example University', '', '', '']);
  expect(clicks).toEqual([]);
});

test('invalidates the scanned education assignment if the applicant selects a degree afterward', async () => {
  const { profile, engine, degrees } = fixture(educationRow(1));
  const scan = await engine.scan(profile);
  expect(scan.fields.find(field => field.label === 'School or University')?.value).toBe('Example College');
  const degree = document.querySelector('select')!;
  degree.value = 'Master of Science';
  degree.dispatchEvent(new Event('change', { bubbles: true }));
  await engine.fill(scan.scanId);
  expect(degrees()).toEqual(['', 'Master of Science']);
});

test('invalidates the scanned link allocation when the applicant places a saved URL into a different row', async () => {
  const { profile, engine, websites } = fixture('', websiteRow(1) + websiteRow(2));
  const scan = await engine.scan(profile);
  const second = document.querySelectorAll<HTMLInputElement>('#urls input')[1];
  second.value = profile.personal.website;
  second.dispatchEvent(new Event('input', { bubbles: true }));
  await expect(engine.fill(scan.scanId)).resolves.toMatchObject({ filled: 0, skipped: 2 });
  expect(websites()).toEqual(['', 'https://portfolio.example.test']);
});

function resumeFixture(profile: Profile, clicks: string[], parseResume: () => void) {
  profile.resume = { name: 'synthetic.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,Zml4dHVyZQ==', lastModified: 1 };
  document.querySelector('[data-automation-id="applyFlowMyExpPage"]')!.insertAdjacentHTML('afterbegin', `
    <div role="group" aria-labelledby="Resume/CV-section"><h4 id="Resume/CV-section">Resume/CV</h4>
      <div data-automation-id="formField-"><label id="resume-label">Upload a file (5MB max)</label>
        <div data-automation-id="attachments-FileUpload" aria-labelledby="resume-label">
          <input type="file" hidden multiple data-automation-id="file-upload-input-ref">
          <div data-automation-id="file-upload-drop-zone">
            <button type="button" id="resumeAttachments--attachments" data-automation-id="select-files">Select files</button>
          </div>
        </div>
      </div>
    </div>`);
  vi.stubGlobal('DataTransfer', class {
    readonly files: File[] = [];
    readonly items = { add: (entry: File) => this.files.push(entry) };
  });
  const file = document.querySelector<HTMLInputElement>('input[type=file]')!;
  let assigned: FileList | null = null;
  Object.defineProperty(file, 'files', { get: () => assigned, set: (next: FileList) => { assigned = next; } });
  file.addEventListener('change', () => {
    if (!file.files?.length) return;
    clicks.push('Upload started');
    const upload = file.parentElement!;
    upload.setAttribute('aria-busy', 'true');
    window.setTimeout(() => {
      parseResume();
      upload.insertAdjacentHTML('beforeend', '<div><span>synthetic.pdf</span><button type="button" aria-label="Delete attachment"></button></div>');
      upload.removeAttribute('aria-busy');
      clicks.push('Upload confirmed');
    }, 30);
  });
}

test('waits for résumé-parsed education before adding the remaining row', async () => {
  const { profile, controller, degrees, clicks } = fixture();
  profile.personal.website = '';
  profile.personal.github = '';
  resumeFixture(profile, clicks, () => {
    document.getElementById('degrees')!.innerHTML = educationRow(1, 'Master of Science', 'Example University');
  });
  controller.start(profile);
  await complete(controller);
  expect(clicks).toEqual(['Upload started', 'Upload confirmed', 'Education']);
  expect(degrees()).toEqual(['Example University', 'Master of Science', 'Example College', 'Bachelor of Science']);
});

test('does not expand a retained education section moved to a new form during résumé parsing', async () => {
  const { profile, controller, degrees, clicks } = fixture();
  profile.personal.website = '';
  profile.personal.github = '';
  const section = document.querySelector('[aria-labelledby="Education-section"]')!;
  section.querySelector('button')!.type = 'button';
  resumeFixture(profile, clicks, () => {
    const newForm = document.createElement('form');
    section.before(newForm);
    newForm.append(section);
  });
  controller.start(profile);
  await complete(controller);
  expect(clicks).toEqual(['Upload started', 'Upload confirmed']);
  expect(degrees()).toEqual([]);
});
