import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test('keeps asynchronously parsed application data across a contact section rerender and follow-up fill', async () => {
  document.body.innerHTML = `<form>
    <label>Resume <input type="file" id="resume" accept=".pdf"></label>
    <section id="contact"><label>Email <input type="email" autocomplete="email"></label></section>
  </form>`;
  const resume = document.querySelector<HTMLInputElement>('#resume')!;
  const contact = document.querySelector<HTMLElement>('#contact')!;
  const parsedEmail = 'parsed@example.test';

  // jsdom lacks DataTransfer and rejects assignment of a synthetic FileList.
  vi.stubGlobal('DataTransfer', class {
    readonly files: File[] = [];
    readonly items = { add: (file: File) => this.files.push(file) };
  });
  let assignedFiles: FileList | null = null;
  Object.defineProperty(resume, 'files', {
    get: () => assignedFiles,
    set: (files: FileList) => { assignedFiles = files; },
  });

  resume.addEventListener('change', () => {
    if (!resume.files?.length) return;
    window.setTimeout(() => {
      const parsedContact = document.createElement('section');
      parsedContact.innerHTML = `<label>Email <input type="email" autocomplete="email" value="${parsedEmail}"></label>
        <label>Last name <input autocomplete="family-name"></label>`;
      contact.replaceWith(parsedContact);
    }, 70);
  });

  const profile = emptyProfile();
  profile.personal.email = 'saved-profile@example.test';
  profile.personal.lastName = 'Fixture';
  profile.resume = { name: 'fixture.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,Zml4dHVyZQ==', lastModified: 1 };
  const controller = createPageController(document, createEngine(document), () => {});

  expect(controller.start(profile)).toBe(true);
  await vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 2_500 });

  expect(Array.from(resume.files ?? [], file => file.name)).toEqual(['fixture.pdf']);
  expect(contact.isConnected).toBe(false);
  expect(document.querySelector<HTMLInputElement>('[autocomplete="family-name"]')?.value).toBe('Fixture');
  expect(document.querySelector<HTMLInputElement>('[autocomplete="email"]')?.value).toBe(parsedEmail);
});
