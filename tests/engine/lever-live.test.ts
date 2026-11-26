import { readFileSync } from 'node:fs';
import { beforeEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { isResumeField } from '../../src/engine/answers';
import { discover } from '../../src/engine/discovery';
import { emptyProfile } from '../../src/shared/profile';

const markup = readFileSync('fixtures/lever-live.html', 'utf8');
const sponsorshipQuestion = 'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B, etc.)?';

beforeEach(() => {
  // Keep the fixture's CSS so the hidden status text stays in the DOM.
  const fixture = new DOMParser().parseFromString(markup, 'text/html');
  document.body.replaceChildren(...fixture.body.childNodes);
});

test('reads the visible Lever radio prompt and applies the saved sponsorship default', async () => {
  const engine = createEngine(document);
  const profile = { ...emptyProfile(), applicationDefaults: { visaSponsorship: 'yes' as const } };
  const plan = await engine.scan(profile);
  const sponsorship = plan.fields.find(field => field.kind === 'radio');

  expect(sponsorship).toMatchObject({ label: sponsorshipQuestion, required: true, status: 'ready', value: 'Yes', options: ['Yes', 'No'] });
  expect(await engine.fill(plan.scanId, [sponsorship!.id])).toMatchObject({ filled: 1, failed: 0 });
  expect(document.querySelector<HTMLInputElement>('#sponsorship input:checked')?.value).toBe('Yes');
});

test('reports each Lever multiselect as a single question with its checkbox choices', async () => {
  const plan = await createEngine(document).scan(emptyProfile());
  expect(plan.fields.filter(field => field.kind === 'checkbox')).toMatchObject([
    { label: 'Language Skill(s) (Check all that apply)', required: true, options: ['English (ENG)', 'Spanish (SPA)', 'Other'] },
    { label: 'If so, what are the dates?', required: false, options: ['September 1 - September 15', 'September 16 - September 30'] },
  ]);
});

test('uses Lever’s dedicated captions for native selects and textareas', async () => {
  const plan = await createEngine(document).scan(emptyProfile());
  expect(plan.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'select', label: 'Which university did you last attend?', required: true }),
    expect.objectContaining({ kind: 'text', label: 'Describe a difficult design project and its impact.', required: true }),
  ]));
});

test('reads the Lever resume and location captions without the hidden status text', () => {
  const fields = discover(document);
  const resume = fields.find(field => field.element.id === 'resume-upload-input');
  const location = fields.find(field => field.element.id === 'location-input');

  expect(resume).toMatchObject({ kind: 'file', label: 'Resume/CV', required: true });
  expect(isResumeField(resume!)).toBe(true);
  expect(location).toMatchObject({ label: 'Current location', required: true });
});
