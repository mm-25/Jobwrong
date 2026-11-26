import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const profile = emptyProfile();
profile.personal.website = 'https://designer.example/portfolio';

test.each([
  'Please provide the link to a portfolio demonstrating at least one software interface design project.',
  'Share a URL to your design portfolio showcasing your recent projects.',
  'Please enter the URL for your professional portfolio.',
  'Provide a link to your portfolio featuring case studies.',
])('fills a portfolio URL request with descriptive requirements: %s', async question => {
  document.body.innerHTML = `<form><label>${question}<textarea></textarea></label></form>`;
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: profile.personal.website });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector('textarea')!.value).toBe(profile.personal.website);
});

test.each([
  'Please provide the link to a portfolio and explain your contribution.',
  'Share a URL to your portfolio showcasing your projects and describe your process.',
  'Please provide the link to another designer\'s portfolio.',
  'Please provide a portfolio password.',
  'Please describe a project in your portfolio.',
])('does not replace prose, someone else\'s portfolio, or credentials with the saved URL: %s', async question => {
  document.body.innerHTML = `<form><label>${question}<textarea></textarea></label></form>`;
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0].status).not.toBe('ready');
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(document.querySelector('textarea')!.value).toBe('');
});
