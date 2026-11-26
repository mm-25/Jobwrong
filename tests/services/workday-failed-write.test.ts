import { expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';

test.each([
  { scenario: 'original work-history section retained', ambiguous: false },
  { scenario: 'a second Workday section makes the original section ambiguous', ambiguous: true },
])('a rejected work-history write cannot reallocate that job during the same click when $scenario', async ({ ambiguous }) => {
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage">
    <label>First name<input id="first" autocomplete="given-name"></label>
    <div role="group" aria-labelledby="Work-Experience-section"><h4 id="Work-Experience-section">Work Experience</h4>
      ${[1, 2].map(n => `<div role="group" aria-labelledby="Work-Experience-${n}-panel">
        <h5 id="Work-Experience-${n}-panel">Work Experience ${n}</h5>
        <label>Job Title<input id="workExperience-${n * 20}--jobTitle"></label>
        <label>Company<input id="workExperience-${n * 20}--companyName"></label></div>`).join('')}
    </div></main>`;
  const original = document.querySelector<HTMLInputElement>('#workExperience-20--jobTitle')!;
  original.addEventListener('input', () => {
    const next = original.cloneNode() as HTMLInputElement;
    next.value = original.value;
    original.replaceWith(next);
    next.dispatchEvent(new Event('input', { bubbles: true }));
    const page = document.querySelector('main')!;
    page.insertAdjacentHTML('beforeend', '<label>Last name<input id="last" autocomplete="family-name"></label>');
    if (ambiguous) page.insertAdjacentHTML('beforeend', '<div data-automation-id="workExperienceSection"></div>');
  }, { once: true });
  const profile = emptyProfile();
  profile.personal.firstName = 'Sasha';
  profile.personal.lastName = 'Rivera';
  profile.employment = [{ company: 'Fixture Studio', title: 'Designer', location: '', startDate: '', endDate: '', current: false, description: '' }];
  const controller = createPageController(document, createEngine(document), () => {});
  controller.start(profile);
  await vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 5000 });
  expect(document.querySelector<HTMLInputElement>('#first')!.value).toBe('Sasha');
  expect(document.querySelector<HTMLInputElement>('#workExperience-20--jobTitle')!.value).toBe('Designer');
  expect([...document.querySelectorAll<HTMLInputElement>('[id^="workExperience-40--"]')].map(e => e.value)).toEqual(['', '']);
  expect(document.querySelector<HTMLInputElement>('#last')!.value).toBe(ambiguous ? '' : 'Rivera');
  if (ambiguous) {
    expect(controller.status()).toMatchObject({ message: expect.stringMatching(/work experience section changed/i), remaining: [] });
  } else {
    expect(controller.status().experienceMessage).toMatch(/review/i);
  }
});
