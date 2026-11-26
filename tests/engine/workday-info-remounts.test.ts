import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

function information() {
  document.body.innerHTML = `<main data-automation-id="applyFlowPage"><form id="application">
    <div data-automation-id="applyFlowMyInfoPage">
      <div role="group" aria-labelledby="Legal-Name-section"><h4 id="Legal-Name-section">Legal Name</h4>
        <div data-automation-id="formField-legalName--firstName"><label for="name--legalName--firstName">First Name</label><input id="name--legalName--firstName" name="legalName--firstName"></div>
        <div data-automation-id="formField-legalName--lastName"><label for="name--legalName--lastName">Last Name</label><input id="name--legalName--lastName" name="legalName--lastName"></div>
      </div>
      <div role="group" aria-labelledby="Address-section"><h4 id="Address-section">Address</h4>
        <div data-automation-id="formField-city"><label for="address--city">City</label><input id="address--city" name="city"></div>
      </div>
      <div role="group" aria-labelledby="Phone-section"><h4 id="Phone-section">Phone</h4>
        <div data-automation-id="formField-phoneNumber"><label for="phoneNumber--phoneNumber">Phone Number</label><input id="phoneNumber--phoneNumber" name="phoneNumber"></div>
      </div>
    </div></form></main>`;
  const page = document.querySelector<HTMLElement>('[data-automation-id="applyFlowMyInfoPage"]')!;
  const profile = emptyProfile();
  Object.assign(profile.personal, { firstName: 'Robin', lastName: 'Example', city: 'Ann Arbor', phone: '3135550100' });
  const engine = createEngine(document);
  return { page, profile, engine, first: document.getElementById('name--legalName--firstName') as HTMLInputElement };
}

function remount(input: HTMLInputElement) {
  const replacement = input.cloneNode() as HTMLInputElement;
  replacement.value = input.value;
  input.replaceWith(replacement);
  return replacement;
}

test('confirms and undoes exact owned My Information writes after individual input remounts', async () => {
  const { page, profile, engine } = information();
  page.addEventListener('input', event => remount(event.target as HTMLInputElement));
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 4, failed: 0, undoAvailable: true });
  expect([...page.querySelectorAll('input')].map(el => el.value)).toEqual(['Robin', 'Example', 'Ann Arbor', '3135550100']);
  expect(await engine.undo(scan.scanId)).toEqual({ restored: 4, skipped: 0 });
  expect([...page.querySelectorAll('input')].map(el => el.value)).toEqual(['', '', '', '']);
});

test.each(['field wrapper', 'group', 'page', 'form owner', 'duplicate id', 'changed label', 'changed name', 'changed value', 'manual edit and clear'])('rejects the contact remount after %s changes', async change => {
  const { page, profile, engine, first } = information();
  const scan = await engine.scan(profile);
  const plan = scan.fields.find(field => field.label === 'First Name')!;
  first.addEventListener('input', () => {
    const replacement = remount(first);
    if (change === 'field wrapper' || change === 'group' || change === 'page') {
      const wrapper = change === 'page' ? page : change === 'group' ? replacement.closest('[role="group"]')! : replacement.parentElement!;
      wrapper.replaceWith(wrapper.cloneNode(true));
    } else if (change === 'form owner') replacement.setAttribute('form', 'different');
    else if (change === 'duplicate id') replacement.after(replacement.cloneNode());
    else if (change === 'changed label') replacement.previousElementSibling!.textContent = 'Contact person';
    else if (change === 'changed name') replacement.name = 'unrelatedFirstName';
    else if (change === 'changed value') replacement.value = 'Another person';
    else {
      replacement.value = '';
      replacement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, { once: true });
  expect(await engine.fill(scan.scanId, [plan.id])).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
});

test('does not use the Workday remount exception for untouched replacement fields', async () => {
  const { profile, engine, first } = information();
  const scan = await engine.scan(profile);
  const plan = scan.fields.find(field => field.label === 'First Name')!;
  const replacement = remount(first);
  expect(await engine.fill(scan.scanId, [plan.id])).toMatchObject({ filled: 0, skipped: 1 });
  expect(replacement.value).toBe('');
});

function replaceContainerKeepingInput(input: HTMLInputElement, scope: string) {
  const original = scope === 'page' ? input.closest('[data-automation-id="applyFlowMyInfoPage"]')!
    : scope === 'group' ? input.closest('[role="group"]')! : input.parentElement!;
  const replacement = original.cloneNode(true) as Element;
  replacement.querySelector(`[id="${input.id}"]`)!.replaceWith(input);
  original.replaceWith(replacement);
}

test.each(['wrapper', 'group', 'page'])('pins the original %s before writing even when it keeps the same input node', async scope => {
  const { profile, engine, first } = information();
  const scan = await engine.scan(profile);
  const plan = scan.fields.find(field => field.label === 'First Name')!;
  replaceContainerKeepingInput(first, scope);
  expect(await engine.fill(scan.scanId, [plan.id])).toMatchObject({ filled: 0, skipped: 1 });
  expect(first.value).toBe('');
});

test.each(['wrapper', 'group', 'page'])('Undo preserves the input when its original %s was replaced', async scope => {
  const { profile, engine, first } = information();
  const scan = await engine.scan(profile);
  const plan = scan.fields.find(field => field.label === 'First Name')!;
  expect(await engine.fill(scan.scanId, [plan.id])).toMatchObject({ filled: 1 });
  replaceContainerKeepingInput(first, scope);
  expect(await engine.undo(scan.scanId)).toEqual({ restored: 0, skipped: 1 });
  expect(first.value).toBe('Robin');
});

test('does not confirm a same-node write that moves to a replacement field wrapper', async () => {
  const { profile, engine, first } = information();
  const scan = await engine.scan(profile);
  const plan = scan.fields.find(field => field.label === 'First Name')!;
  first.addEventListener('input', () => replaceContainerKeepingInput(first, 'wrapper'), { once: true });
  expect(await engine.fill(scan.scanId, [plan.id])).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
});

test('does not report Undo success when restoration moves the same input outside its original wrapper', async () => {
  const { profile, engine, first } = information();
  const scan = await engine.scan(profile);
  const plan = scan.fields.find(field => field.label === 'First Name')!;
  let writes = 0;
  first.addEventListener('input', () => {
    if (++writes === 2) replaceContainerKeepingInput(first, 'wrapper');
  });
  expect(await engine.fill(scan.scanId, [plan.id])).toMatchObject({ filled: 1 });
  expect(await engine.undo(scan.scanId)).toEqual({ restored: 0, skipped: 1 });
});

test('Undo preserves a manual clear of an adopted contact field', async () => {
  const { page, profile, engine } = information();
  page.addEventListener('input', event => {
    if (!(event.target as HTMLInputElement).dataset.manual) remount(event.target as HTMLInputElement);
  });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 4 });
  const input = page.querySelector('input')!;
  input.dataset.manual = 'true';
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(await engine.undo(scan.scanId)).toEqual({ restored: 3, skipped: 1 });
  expect(input.value).toBe('');
});

function educationAndSocial() {
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Education-section"><h4 id="Education-section">Education</h4>
      <div role="group" aria-labelledby="Education-1-panel"><h5 id="Education-1-panel">Education 1</h5>
        <div data-automation-id="formField-schoolName"><label for="education-5--schoolName">School or University</label><input id="education-5--schoolName" name="schoolName"></div>
        <label>Degree <select id="degree"><option></option><option>Master of Science</option></select></label>
      </div>
    </div>
    <div role="group" aria-labelledby="Social-Network-URLs-section"><h4 id="Social-Network-URLs-section">Social Network URLs</h4>
      <div data-automation-id="formField-linkedInAccount"><label for="socialNetworkAccounts--linkedInAccount">LinkedIn</label><input id="socialNetworkAccounts--linkedInAccount" name="linkedInAccount"></div>
    </div>
  </main>`;
  const profile = emptyProfile();
  profile.personal.linkedin = 'https://linkedin.com/in/robin-example';
  profile.education = [{ school: 'Example University', degree: 'Master of Science', fieldOfStudy: '', startDate: '', endDate: '', gpa: '' }];
  return { profile, engine: createEngine(document), school: document.getElementById('education-5--schoolName') as HTMLInputElement };
}

test('adopts school and social URL remounts without invalidating the following education field', async () => {
  const { profile, engine } = educationAndSocial();
  document.querySelector('main')!.addEventListener('input', event => {
    if ((event.target as Element).tagName === 'INPUT') remount(event.target as HTMLInputElement);
  });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 3, failed: 0 });
  expect(document.querySelector<HTMLSelectElement>('#degree')!.value).toBe('Master of Science');
  expect(await engine.undo(scan.scanId)).toEqual({ restored: 3, skipped: 0 });
});

test.each(['education section', 'education row', 'row heading'])('rejects remounted schools when the %s changes', async change => {
  const { profile, engine, school } = educationAndSocial();
  const scan = await engine.scan(profile);
  const plan = scan.fields.find(field => field.label === 'School or University')!;
  school.addEventListener('input', () => {
    const replacement = remount(school);
    const row = replacement.closest('[role="group"]')!;
    if (change === 'row heading') row.setAttribute('aria-labelledby', 'Education-2-panel');
    else {
      const group = change === 'education section' ? row.parentElement! : row;
      group.replaceWith(group.cloneNode(true));
    }
  }, { once: true });
  expect(await engine.fill(scan.scanId, [plan.id])).toMatchObject({ filled: 0, failed: 1 });
});
