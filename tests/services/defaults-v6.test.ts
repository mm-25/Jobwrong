import { expect, test } from 'vitest';
import { emptyProfile, exportProfile, parseProfile } from '../../src/shared/profile';
import { migrateRequestedDefaults } from '../../src/shared/requested-defaults';

const entry = { school: 'K.J Somaiya Institute of Technology', degree: "Bachelor's Degree", fieldOfStudy: 'Electronics',
  startDate: '2019', endDate: '2023', gpa: '' };
const alternatives = ['Bachelor of Engineering', 'Bachelor of Science'];

test('degree alternatives round-trip, preserve explicit clears, and validate list input', () => {
  const profile = parseProfile({ ...emptyProfile(), education: [
    { ...entry, degreeAlternatives: [' Bachelor of Engineering ', '', 'Bachelor  of Science'] },
    { ...entry, degreeAlternatives: [] }, entry,
  ] });
  expect(profile.education[0].degreeAlternatives).toEqual(alternatives);
  expect(profile.education[1].degreeAlternatives).toEqual([]);
  expect(profile.education[2].degreeAlternatives).toBeUndefined();
  expect(parseProfile(JSON.parse(exportProfile(profile)))).toEqual(profile);
  for (const bad of ['Bachelor of Science', [false], Array(101).fill('Bachelor of Science')]) {
    expect(() => parseProfile({ ...emptyProfile(), education: [{ ...entry, degreeAlternatives: bad }] })).toThrow(/Degree alternative/i);
  }
});

test.each(['K.J Somaiya Institute of Technology', 'K J Somaiya Institute of Engineering & Information Technology',
  'KJ Somaiya Institute of Engineering and Information Technology'])('preserves the award without inferring alternatives for %s', school => {
  const profile = { ...emptyProfile(), education: [{ ...entry, school }] };
  const migrated = migrateRequestedDefaults(profile, 5);
  expect(migrated.education[0]).toEqual({ ...entry, school });
  const cleared = { ...migrated, education: [{ ...migrated.education[0], degree: '', degreeAlternatives: [] }] };
  expect(migrateRequestedDefaults(cleared, 6).education).toEqual(cleared.education);
});

test.each([[], ['Electrical Engineering']].map(preferences => ({ preferences })))('preserves an explicit subject preference $preferences', ({ preferences }) => {
  const education = [{ ...entry, fieldOfStudyAlternatives: preferences }];
  expect(migrateRequestedDefaults({ ...emptyProfile(), education }, 5).education).toEqual(education);
});

test.each([
  [entry, { ...entry }],
  [{ ...entry, school: 'KJ Somaiya College of Engineering' }],
  [{ ...entry, degree: 'Master of Science' }],
  [{ ...entry, degreeAlternatives: [] }],
  [{ ...entry, degreeAlternatives: ['Bachelor of Science'] }],
].map(education => ({ education })))('preserves ambiguous records and explicit existing preferences $education', ({ education }) => {
  expect(migrateRequestedDefaults({ ...emptyProfile(), education }, 5).education).toEqual(education);
});
