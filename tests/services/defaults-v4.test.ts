import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { emptyProfile, exportProfile, parseProfile } from '../../src/shared/profile';
import { loadProfile, saveProfile } from '../../src/services/storage';

const profileKey = 'jobright.profile.v1';
const revisionKey = 'jobright.application-defaults.revision';
let data: Record<string, unknown>;
const school = (name = 'University of Michigan', campus?: string) => ({
  school: name, degree: 'MS', fieldOfStudy: 'Information', startDate: '2024', endDate: '2026', gpa: '',
  ...(campus ? { campus } : {}),
});
beforeEach(() => {
  data = {};
  vi.stubGlobal('browser', { runtime: {}, storage: { local: {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])),
    set: async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); },
  } } });
});
afterEach(() => vi.unstubAllGlobals());

test('round-trips explicit campus without inventing one during import', () => {
  const profile = parseProfile({ ...emptyProfile(), education: [school('University of Michigan', ' Ann Arbor ')] });
  expect(profile.education[0]).toMatchObject({ school: 'University of Michigan', campus: 'Ann Arbor' });
  expect(parseProfile(JSON.parse(exportProfile(profile)))).toEqual(profile);
  expect(parseProfile({ ...emptyProfile(), education: [school()] }).education[0]).not.toHaveProperty('campus');
  expect(() => parseProfile({ ...emptyProfile(), education: [{ ...school(), campus: true }] })).toThrow();
});

test('preserves an unqualified school without adding a campus or study preferences', async () => {
  data[profileKey] = { ...emptyProfile(), applicationDefaults: {}, education: [school(), school('Another University')] };
  data[revisionKey] = 3;
  const loaded = await loadProfile();
  expect(loaded.education).toEqual([
    school(),
    school('Another University'),
  ]);
  expect(loaded.applicationDefaults).toEqual({});
  expect(loaded.workAuthorizations).toBeUndefined();
  expect(data[revisionKey]).toBe(6);
  await saveProfile({ ...loaded, education: [school()] });
  expect((await loadProfile()).education).toEqual([school()]);
});

test.each([
  { education: [school('University of Michigan', 'Dearborn')] },
  { education: [school(), school()] },
  { education: [school('University of Michigan - Flint')] },
  { education: [school('Another University')] },
])('does not overwrite or choose between other campus records (%j)', async ({ education }) => {
  data[profileKey] = { ...emptyProfile(), applicationDefaults: {}, education };
  data[revisionKey] = 3;
  expect((await loadProfile()).education).toEqual(education);
});
