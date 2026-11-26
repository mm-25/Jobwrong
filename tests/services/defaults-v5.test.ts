import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { emptyProfile, exportProfile, parseProfile } from '../../src/shared/profile';
import type { Education } from '../../src/shared/types';
import { loadProfile, saveProfile } from '../../src/services/storage';

const profileKey = 'jobright.profile.v1';
const revisionKey = 'jobright.application-defaults.revision';
const alternatives = ['UX Research', 'Product Design', 'Web Design', 'Other'];
const michigan: Education = {
  school: 'University of Michigan', campus: 'Ann Arbor', degree: "Master's", fieldOfStudy: 'Information',
  startDate: '2024', endDate: '2026', gpa: '',
};
let data: Record<string, unknown>;

beforeEach(() => {
  data = { [revisionKey]: 4 };
  vi.stubGlobal('browser', { runtime: {}, storage: { local: {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])),
    set: async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); },
  } } });
});
afterEach(() => vi.unstubAllGlobals());

test('round-trips ordered field of study alternatives and explicit clears', () => {
  const imported = parseProfile({ ...emptyProfile(), education: [
    { ...michigan, fieldOfStudyAlternatives: [' UX Research ', '', 'Product  Design', 'Web Design', 'Other'] },
    { ...michigan, fieldOfStudyAlternatives: [] },
    michigan,
  ] });
  expect(imported.education).toEqual([
    { ...michigan, fieldOfStudyAlternatives: alternatives },
    { ...michigan, fieldOfStudyAlternatives: [] },
    michigan,
  ]);
  expect(parseProfile(JSON.parse(exportProfile(imported)))).toEqual(imported);
  for (const invalid of ['UX Research', ['Other', true]]) {
    expect(() => parseProfile({ ...emptyProfile(), education: [{ ...michigan, fieldOfStudyAlternatives: invalid }] })).toThrow(/Field of study alternative/i);
  }
});

test.each(['Ann Arbor', undefined])('preserves education at campus %s without adding study alternatives', async campus => {
  const education = [{ ...michigan, campus }, { ...michigan, school: 'Another University' }];
  data[profileKey] = { ...emptyProfile(), applicationDefaults: {}, education };
  const loaded = await loadProfile();
  expect(loaded.education[0]).toEqual(education[0]);
  expect(loaded.education[0].fieldOfStudyAlternatives).toBeUndefined();
  expect(loaded.education[1]).toEqual(education[1]);
  expect(loaded.applicationDefaults).toEqual({});
  expect(data[revisionKey]).toBe(5);
  loaded.education[0].fieldOfStudyAlternatives = [];
  await saveProfile(loaded);
  expect((await loadProfile()).education[0].fieldOfStudyAlternatives).toEqual([]);
});

test.each([
  [{ ...michigan, campus: 'Dearborn' }],
  [{ ...michigan, school: 'University of Michigan - Flint' }],
  [{ ...michigan, school: 'Another University' }],
  [michigan, { ...michigan, campus: 'Flint' }],
  [michigan, { ...michigan, school: 'University of Michigan - Dearborn' }],
  [{ ...michigan, fieldOfStudyAlternatives: [] }],
  [{ ...michigan, fieldOfStudyAlternatives: ['Other', 'Graphic Design'] }],
].map(education => ({ education })))('preserves existing preferences and avoids ambiguous or unrelated records (%j)', async ({ education }) => {
  data[profileKey] = { ...emptyProfile(), applicationDefaults: {}, education };
  expect((await loadProfile()).education).toEqual(education);
  expect(data[revisionKey]).toBe(5);
});
