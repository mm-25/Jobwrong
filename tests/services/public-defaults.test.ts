import { expect, test } from 'vitest';
import { emptyProfile } from '../../src/shared/profile';
import { migrateRequestedDefaults, withRequestedDefaults } from '../../src/shared/requested-defaults';

test('new public profiles contain no prefilled personal facts or privacy consent', () => {
  const profile = withRequestedDefaults(emptyProfile());
  expect(profile.applicationDefaults).toEqual({});
  expect(Object.values(profile.personal).every(value => value === '')).toBe(true);
  expect(profile.employment).toEqual([]);
  expect(profile.education).toEqual([]);
  expect(profile.workAuthorizations).toBeUndefined();
});

test.each([0, 1, 2, 3, 4, 5, 6])('revision %s does not infer authorization, campus or study preferences', revision => {
  const profile = {
    ...emptyProfile(),
    education: [{ school: 'University of Michigan', degree: 'MS', fieldOfStudy: 'Information',
      startDate: '', endDate: '', gpa: '' }],
  };
  const before = structuredClone(profile);
  const migrated = migrateRequestedDefaults(profile, revision);
  expect(migrated).toEqual({ ...profile, applicationDefaults: {} });
  expect(profile).toEqual(before);
});

test('explicitly saved answers, cleared defaults, and education preferences remain untouched', () => {
  const profile = {
    ...emptyProfile(),
    applicationDefaults: { gender: 'decline' as const, acceptApplicationPrivacy: false },
    workAuthorizations: [{ country: 'Canada', authorized: false }],
    education: [{ school: 'Example University', campus: 'North', degree: 'BA', fieldOfStudy: 'Design',
      fieldOfStudyAlternatives: ['Other'], startDate: '', endDate: '', gpa: '' }],
  };
  expect(migrateRequestedDefaults(profile, 0)).toEqual(profile);
  expect(withRequestedDefaults({ ...emptyProfile(), applicationDefaults: {} }).applicationDefaults).toEqual({});
});
