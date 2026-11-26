import { describe, expect, it } from 'vitest';
import { emptyProfile, exportProfile, parseProfile } from '../../src/shared/profile';

describe('extended local profile', () => {
  const legacy = {
    schemaVersion: 1,
    personal: { firstName: 'Casey' },
    education: [{ school: 'Example University', endDate: '2018-05' }],
  };

  it('loads legacy profiles without inventing optional answers', () => {
    const profile = parseProfile(legacy);
    expect(profile.personal.firstName).toBe('Casey');
    expect(profile.personal.preferredFirstName).toBeUndefined();
    expect(profile.education[0].current).toBeUndefined();
    expect(profile.workAuthorizations).toBeUndefined();
    expect(profile.skills).toBeUndefined();
    expect(emptyProfile().answers).toEqual([]);
  });

  it('roundtrips optional contact details and current education status', () => {
    const profile = parseProfile({
      ...legacy,
      personal: {
        ...legacy.personal, middleName: ' R ', preferredFirstName: ' C.J. ',
        preferredMiddleName: ' Ray ', preferredLastName: ' Rivers ',
        address2: ' Suite 4 ', county: ' Wayne ', phoneCountryCode: ' +1 ', phoneType: ' Mobile ',
      },
      education: [{ ...legacy.education[0], current: false }],
    });
    expect(profile.personal).toMatchObject({
      middleName: 'R', preferredFirstName: 'C.J.', preferredMiddleName: 'Ray',
      preferredLastName: 'Rivers', address2: 'Suite 4', county: 'Wayne',
      phoneCountryCode: '+1', phoneType: 'Mobile',
    });
    expect(profile.education[0].current).toBe(false);
    expect(parseProfile(JSON.parse(exportProfile(profile)))).toEqual(profile);
  });

  it('preserves both explicit no and unanswered work authorization choices', () => {
    const profile = parseProfile({
      ...legacy,
      workAuthorizations: [
        { country: ' United States ', authorized: true, sponsorshipRequired: false },
        { country: 'Canada', authorized: false },
      ],
    });
    expect(profile.workAuthorizations).toEqual([
      { country: 'United States', authorized: true, sponsorshipRequired: false },
      { country: 'Canada', authorized: false },
    ]);
    expect(parseProfile(JSON.parse(exportProfile(profile)))).toEqual(profile);
  });

  it('imports only explicitly entered skills and drops blank lines', () => {
    const profile = parseProfile({ ...legacy, skills: [' Figma ', '', 'Prototyping', '  '] });
    expect(profile.skills).toEqual(['Figma', 'Prototyping']);
    expect(parseProfile(JSON.parse(exportProfile(profile)))).toEqual(profile);
  });

  it('rejects invalid types, missing countries, and excessive entries', () => {
    expect(() => parseProfile({ ...legacy, education: [{ ...legacy.education[0], current: 'No' }] })).toThrow(/current education/i);
    expect(() => parseProfile({ ...legacy, workAuthorizations: [{ country: ' ', authorized: true }] })).toThrow(/country/i);
    expect(() => parseProfile({ ...legacy, workAuthorizations: [{ country: 'Canada', authorized: 'No' }] })).toThrow(/work authorization/i);
    expect(() => parseProfile({ ...legacy, workAuthorizations: [{ country: 'Canada', sponsorshipRequired: 0 }] })).toThrow(/sponsorship/i);
    expect(() => parseProfile({ ...legacy, skills: ['Figma', 5] })).toThrow(/skill/i);
    expect(() => parseProfile({ ...legacy, skills: Array(101).fill('Design') })).toThrow(/skills/i);
  });
});
