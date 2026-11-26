import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { emptyProfile, exportProfile, parseProfile } from '../../src/shared/profile';
import { loadProfile, saveProfile } from '../../src/services/storage';

const profileKey = 'jobright.profile.v1';
const revisionKey = 'jobright.application-defaults.revision';
let data: Record<string, unknown>;

beforeEach(() => {
  data = {};
  vi.stubGlobal('browser', { runtime: {}, storage: { local: {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])),
    set: async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); },
  } } });
});
afterEach(() => vi.unstubAllGlobals());

test('round-trips explicit full-time authorization and referral source without inventing them during import', () => {
  const profile = parseProfile({ ...emptyProfile(), applicationDefaults: { referralSource: 'linkedin' },
    workAuthorizations: [{ country: 'United States', authorized: true, fullTimeAuthorized: true },
      { country: 'Canada', fullTimeAuthorized: false }] });
  expect(profile.applicationDefaults).toEqual({ referralSource: 'linkedin' });
  expect(profile.workAuthorizations).toEqual([{ country: 'United States', authorized: true, fullTimeAuthorized: true },
    { country: 'Canada', fullTimeAuthorized: false }]);
  expect(parseProfile(JSON.parse(exportProfile(profile)))).toEqual(profile);
  expect(parseProfile(emptyProfile()).workAuthorizations).toBeUndefined();
  expect(() => parseProfile({ ...profile, workAuthorizations: [{ country: 'US', fullTimeAuthorized: 'yes' }] })).toThrow();
  expect(() => parseProfile({ ...profile, applicationDefaults: { referralSource: 'invented-source' } })).toThrow();
});

test('preserves partial authorization without adding source or full-time authorization', async () => {
  data[profileKey] = { ...emptyProfile(), applicationDefaults: {},
    workAuthorizations: [{ country: 'US', authorized: true, sponsorshipRequired: true }] };
  data[revisionKey] = 2;
  const profile = await loadProfile();
  expect(profile.applicationDefaults).toEqual({});
  expect(profile.workAuthorizations).toEqual([{ country: 'US', authorized: true, sponsorshipRequired: true }]);
  expect(data[revisionKey]).toBe(6);
  const cleared = { ...profile, applicationDefaults: {}, workAuthorizations: [] };
  await saveProfile(cleared);
  const loaded = await loadProfile();
  expect(loaded.applicationDefaults).toEqual({});
  expect(loaded.workAuthorizations ?? []).toEqual([]);
});

test('preserves explicit contrary answers and other jurisdictions during migration', async () => {
  const entries = [{ country: 'USA', authorized: false }, { country: 'Canada', authorized: true, fullTimeAuthorized: false }];
  data[profileKey] = { ...emptyProfile(), applicationDefaults: {}, workAuthorizations: entries };
  data[revisionKey] = 2;
  expect((await loadProfile()).workAuthorizations).toEqual(entries);
});

test('does not resolve conflicting United States records during migration', async () => {
  const entries = [{ country: 'US', authorized: true }, { country: 'United States', authorized: false }];
  data[profileKey] = { ...emptyProfile(), applicationDefaults: {}, workAuthorizations: entries };
  data[revisionKey] = 2;
  expect((await loadProfile()).workAuthorizations).toEqual(entries);
});

test.each(['the United States', 'U. S.', 'U. S. A.', 'the U.S.A.', 'United States of America'])(
  'preserves a contrary United States answer stored as %s', async country => {
    const entries = [{ country, authorized: false }];
    data[profileKey] = { ...emptyProfile(), applicationDefaults: {}, workAuthorizations: entries };
    data[revisionKey] = 2;
    expect((await loadProfile()).workAuthorizations).toEqual(entries);
  },
);
