import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Profile } from '../../src/shared/types';

export const formUrls = {
  lever: 'https://jobs.lever.co/example-studio/designer/apply',
  greenhouse: 'https://job-boards.greenhouse.io/example-studio/jobs/30000',
  ashby: 'https://jobs.ashbyhq.com/example-studio/design/application',
  workday: 'https://example-studio.wd1.myworkdayjobs.com/en-US/External/job/design/apply',
  icims: 'https://careers-example-studio.icims.com/jobs/1000/design/login',
} as const;

export type Fixture = keyof typeof formUrls;

export async function serveFixture(page: Page, fixture: Fixture): Promise<void> {
  const html = await readFile(resolve('fixtures', fixture + '.html'), 'utf8');
  await page.route('**/*', (route) => route.request().url() === formUrls[fixture]
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.addInitScript(() => {
    const log = { submitEvents: 0, submitButtonClicks: 0 };
    Object.defineProperty(window, 'fixtureEvents', { value: log });
    document.addEventListener('submit', (event) => {
      log.submitEvents++;
      event.preventDefault();
    }, { capture: true });
    document.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[type="submit"]')) log.submitButtonClicks++;
    }, { capture: true });
  });
  await page.goto(formUrls[fixture]);
}

export const resumeText = '%PDF-1.4\nExample applicant fixture\n%%EOF';

export const profile: Profile = {
  schemaVersion: 1,
  personal: {
    firstName: 'Morgan',
    lastName: 'Lee',
    email: 'morgan.lee@example.test',
    phone: '+1 313 555 0123',
    address: '100 Sample Road',
    city: 'Detroit',
    state: 'Michigan',
    postalCode: '48226',
    country: 'United States',
    linkedin: 'https://www.linkedin.com/in/morganlee-example',
    website: 'https://morganlee.example.test',
    github: 'https://github.com/morganlee-example',
  },
  employment: [
    {
      company: 'Cedar Studio', title: 'Product Designer', location: 'Detroit',
      startDate: '2020-04', endDate: '2023-05', current: false, description: 'Designed a mobile app.',
    },
    {
      company: 'Maple Co.', title: 'Senior Designer', location: 'Chicago',
      startDate: '2023-06', endDate: '', current: true, description: 'Led web design.',
    },
  ],
  education: [
    {
      school: 'Huron College', degree: 'Bachelor of Arts', fieldOfStudy: 'Graphic Design',
      startDate: '2014-08', endDate: '2018-05', gpa: '3.7',
    },
    {
      school: 'Lakes University', degree: 'Master of Science', fieldOfStudy: 'Interaction Design',
      startDate: '2018-08', endDate: '2020-03', gpa: '3.9',
    },
  ],
  answers: [
    { question: '  HOW   did you hear about this role? ', answer: 'Company careers page' },
    { question: 'Are you open to relocation?', answer: 'Yes' },
    { question: 'Which office would you prefer?', answer: 'Detroit' },
    { question: 'Describe a design project you are proud of.', answer: 'I redesigned a mobile app.' },
    { question: 'I consent to a background check', answer: 'Yes' },
    { question: 'Electronic signature', answer: 'Morgan Lee' },
    { question: 'Create password', answer: 'fixture-only' },
  ],
  resume: {
    name: 'Morgan Lee - Resume.pdf',
    type: 'application/pdf',
    dataUrl: 'data:application/pdf;base64,' + Buffer.from(resumeText).toString('base64'),
    lastModified: 1_700_000_000_000,
  },
};
