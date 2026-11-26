import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalData, loadProfile, saveProfile } from '../../src/services/storage';
import { emptyProfile, exportProfile, parseProfile } from '../../src/shared/profile';

const profileKey = 'jobright.profile.v1';
const revisionKey = 'jobright.application-defaults.revision';
const newDefaults = {};
let entries: Record<string, unknown>;
const write = vi.fn(async (values: Record<string, unknown>) => { Object.assign(entries, structuredClone(values)); });

beforeEach(() => {
  entries = {};
  write.mockClear();
  vi.stubGlobal('browser', {
    runtime: {},
    storage: { local: {
      get: async (keys: string | string[]) => Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map(key => [key, entries[key]]),
      ),
      set: write,
      clear: async () => { entries = {}; },
    } },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('willingness and race or ethnicity defaults', () => {
  it('validates explicit answers and round-trips them through profile JSON', () => {
    const applicationDefaults = { relocation: 'no', onsiteWork: 'yes', raceEthnicity: 'asian' };
    const updated = parseProfile({ ...emptyProfile(), applicationDefaults });
    expect(updated.applicationDefaults).toEqual(applicationDefaults);
    expect(parseProfile(JSON.parse(exportProfile(updated)))).toEqual(updated);
    expect(parseProfile(emptyProfile()).applicationDefaults).toBeUndefined();
  });

  it.each([
    ['relocation', 'maybe'],
    ['onsiteWork', 'decline'],
    ['raceEthnicity', 'unspecified'],
  ])('rejects an unsupported %s answer', (key, value) => {
    expect(() => parseProfile({ ...emptyProfile(), applicationDefaults: { [key]: value } })).toThrow();
  });

  it('leaves answers blank in a fresh profile without persisting an empty record', async () => {
    expect((await loadProfile()).applicationDefaults).toEqual(newDefaults);
    expect(write).not.toHaveBeenCalled();
  });

  it('normalizes storage once and preserves configured answers and privacy choices', async () => {
    entries[profileKey] = { ...emptyProfile(), applicationDefaults: {
      onsiteWork: 'no', raceEthnicity: 'decline', acceptApplicationPrivacy: false,
    } };
    const expected = { onsiteWork: 'no', raceEthnicity: 'decline', acceptApplicationPrivacy: false };

    const loaded = await loadProfile();
    expect(loaded.applicationDefaults).toEqual(expected);
    expect(write).toHaveBeenCalledExactlyOnceWith({ [profileKey]: loaded, [revisionKey]: 6 });
    expect(await loadProfile()).toEqual(loaded);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('keeps an older profile with explicitly cleared defaults blank', async () => {
    entries[profileKey] = { ...emptyProfile(), applicationDefaults: {} };

    expect((await loadProfile()).applicationDefaults).toEqual(newDefaults);
  });

  it('keeps cleared answers after saving and loading the new version', async () => {
    entries[profileKey] = { ...emptyProfile(), applicationDefaults: {} };
    const profile = await loadProfile();
    await saveProfile({ ...profile, applicationDefaults: { onsiteWork: 'no' } });

    expect((await loadProfile()).applicationDefaults).toEqual({ onsiteWork: 'no' });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('uses an explicit saved choice without migrating deferred fields on next load', async () => {
    await saveProfile({ ...emptyProfile(), applicationDefaults: {} });

    expect((await loadProfile()).applicationDefaults).toEqual({});
    expect(entries[revisionKey]).toBe(6);
    await clearLocalData();
    expect((await loadProfile()).applicationDefaults).toEqual(newDefaults);
  });
});
