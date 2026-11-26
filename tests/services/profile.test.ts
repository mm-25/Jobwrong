import { describe, expect, it } from 'vitest';
import { emptyProfile, parseProfile, exportProfile } from '../../src/shared/profile';

describe('profile data boundary', () => {
  it('imports a profile and exports only the supported schema, never credentials', () => {
    const input = { ...emptyProfile(), personal: { firstName: ' Ada ', email: 'ada@example.test' }, apiKey: 'SECRET', ai: { apiKey: 'SECRET' } };
    const result = parseProfile(input);
    expect(result.personal.firstName).toBe('Ada');
    expect(result.personal.lastName).toBe('');
    expect(exportProfile(result)).not.toContain('SECRET');
  });
  it('rejects a non-profile rather than replacing saved data with a blank profile', () => {
    expect(() => parseProfile({ random: 'data' })).toThrow();
    expect(() => parseProfile({ ...emptyProfile(), schemaVersion: 7 })).toThrow();
  });
  it('rejects malformed records, oversize values, and executable attachment URLs', () => {
    expect(() => parseProfile({ ...emptyProfile(), employment: [{}], answers: [{ question: 'q', answer: 123 }] })).toThrow();
    expect(() => parseProfile({ ...emptyProfile(), personal: { firstName: 'x'.repeat(10001) } })).toThrow();
    expect(() => parseProfile({ ...emptyProfile(), resume: {name:'resume.pdf', type:'application/pdf', dataUrl:'https://tracker.test/file', lastModified:0} })).toThrow();
  });
  it('roundtrips local records and attachment without adding made-up data', () => {
    const p = emptyProfile();
    p.answers = [{ question:'Can you relocate?', answer:'No' }];
    p.resume = { name:'resume.pdf', type:'application/pdf', dataUrl:'data:application/pdf;base64,JVBERg==', lastModified:0 };
    expect(parseProfile(JSON.parse(exportProfile(p)))).toEqual(p);
  });
});
