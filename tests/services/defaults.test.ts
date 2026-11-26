import { expect, test } from 'vitest';
import { emptyProfile, exportProfile, parseProfile } from '../../src/shared/profile';

test('round-trips explicitly configured application answers and keeps old profiles blank', () => {
  const legacy = { schemaVersion: 1, personal: { firstName: 'Morgan' } };
  const applicationDefaults = {
    visaSponsorship: 'yes', gender: 'male', disability: 'no',
    veteran: 'no', hispanicLatino: 'decline', acceptApplicationPrivacy: false,
  };
  expect(parseProfile(legacy).applicationDefaults).toBeUndefined();
  expect(emptyProfile().applicationDefaults).toBeUndefined();
  const profile = parseProfile({ ...legacy, applicationDefaults });
  expect(profile.applicationDefaults).toEqual(applicationDefaults);
  expect(parseProfile(JSON.parse(exportProfile(profile)))).toEqual(profile);
});

test.each([
  ['visaSponsorship', true],
  ['gender', 'yes'],
  ['disability', 'unknown'],
  ['veteran', null],
  ['hispanicLatino', 'Hispanic'],
  ['acceptApplicationPrivacy', 'true'],
])('rejects invalid application default %s', (key, value) => {
  expect(() => parseProfile({
    schemaVersion: 1, personal: {}, applicationDefaults: { [key]: value },
  })).toThrow();
});
