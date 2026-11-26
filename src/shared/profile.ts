import type { ApplicationDefaults, Profile, ResumeAttachment, WorkAuthorization } from './types';

const personalKeys = ['firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country', 'linkedin', 'website', 'github'] as const;
const optionalPersonalKeys = ['middleName', 'preferredFirstName', 'preferredMiddleName', 'preferredLastName',
  'address2', 'county', 'phoneCountryCode', 'phoneType'] as const;
export const MAX_RESUME_BYTES = 2 * 1024 * 1024;
export function emptyProfile(): Profile {
  return { schemaVersion: 1, personal: fields({}, personalKeys), employment: [], education: [], answers: [] };
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 10000) throw new Error(`${label} must be text under 10,000 characters.`);
  return value.trim();
}
function list(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${label} must contain at most 100 entries.`);
  return value;
}
function records(value: unknown, label: string): Record<string, unknown>[] {
  return list(value, label).map((entry, i) => object(entry, `${label} ${i + 1}`));
}
function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value;
  throw new Error(`${label} must be true or false.`);
}
function optionalChoice<T extends string>(value: unknown, label: string, choices: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  const choice = choices.find((candidate) => candidate === value);
  if (!choice) throw new Error(`${label} must be one of: ${choices.join(', ')}.`);
  return choice;
}
function applicationDefaults(value: unknown): ApplicationDefaults {
  const data = object(value, 'Application defaults');
  const disclosureChoices = ['yes', 'no', 'decline'] as const;
  const defaults: ApplicationDefaults = {
    visaSponsorship: optionalChoice(data.visaSponsorship, 'Visa sponsorship', ['yes', 'no']),
    gender: optionalChoice(data.gender, 'Gender', ['male', 'female', 'nonbinary', 'decline']),
    disability: optionalChoice(data.disability, 'Disability', disclosureChoices),
    veteran: optionalChoice(data.veteran, 'Veteran status', disclosureChoices),
    hispanicLatino: optionalChoice(data.hispanicLatino, 'Hispanic or Latino', disclosureChoices),
    acceptApplicationPrivacy: optionalBoolean(data.acceptApplicationPrivacy, 'Application privacy acknowledgment'),
    relocation: optionalChoice(data.relocation, 'Willingness to relocate', ['yes', 'no']),
    onsiteWork: optionalChoice(data.onsiteWork, 'Willingness to work onsite', ['yes', 'no']),
    raceEthnicity: optionalChoice(data.raceEthnicity, 'Race or ethnicity', ['south_asian', 'asian', 'decline']),
    referralSource: optionalChoice(data.referralSource, 'Referral source', ['linkedin']),
  };
  return Object.fromEntries(Object.entries(defaults).filter(([, answer]) => answer !== undefined));
}
function fields<T extends readonly string[]>(value: Record<string, unknown>, keys: T): Record<T[number], string> {
  return Object.fromEntries(keys.map(key => [key, string(value[key], key)])) as Record<T[number], string>;
}
function attachment(value: unknown): ResumeAttachment {
  const r = object(value, 'Resume');
  const name = string(r.name, 'Resume name'), type = string(r.type, 'Resume type');
  const types = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (!name || !/\.(pdf|doc|docx)$/i.test(name) || !types.includes(type)) throw new Error('Resume must be a PDF, DOC, or DOCX file.');
  const dataUrl = r.dataUrl;
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_RESUME_BYTES / 3) * 4 + 200) throw new Error('Resume must be 2 MiB or smaller.');
  const prefix = `data:${type};base64,`;
  if (!dataUrl.startsWith(prefix) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataUrl.slice(prefix.length))) throw new Error('Resume contains invalid file data.');
  const bytes = atob(dataUrl.slice(prefix.length));
  if (!bytes.length || bytes.length > MAX_RESUME_BYTES) throw new Error('Resume must be nonempty and 2 MiB or smaller.');
  if (typeof r.lastModified !== 'number' || !Number.isFinite(r.lastModified) || r.lastModified < 0) throw new Error('Resume has an invalid file date.');
  return { name, type, dataUrl, lastModified: r.lastModified };
}
export function parseProfile(input: unknown): Profile {
  const data = object(input, 'Profile');
  if (data.schemaVersion !== 1 || !data.personal) throw new Error('Import a JobRight Local profile with schemaVersion 1.');
  const profile = emptyProfile();
  const personal = object(data.personal, 'Personal details');
  profile.personal = fields(personal, personalKeys);
  for (const key of optionalPersonalKeys) {
    const value = string(personal[key], key);
    if (value) profile.personal[key] = value;
  }
  profile.employment = records(data.employment, 'Employment').map(entry => {
    return { ...fields(entry, ['company', 'title', 'location', 'startDate', 'endDate', 'description'] as const),
      current: optionalBoolean(entry.current, 'Current employment') ?? false };
  });
  profile.education = records(data.education, 'Education').map(entry => {
    const details = fields(entry, ['school', 'degree', 'fieldOfStudy', 'startDate', 'endDate', 'gpa'] as const);
    const campus = string(entry.campus, 'Education campus');
    const current = optionalBoolean(entry.current, 'Current education');
    const degreeAlternatives = entry.degreeAlternatives === undefined ? undefined
      : list(entry.degreeAlternatives, 'Degree alternatives')
        .map((value, index) => string(value, `Degree alternative ${index + 1}`).replace(/\s+/g, ' ')).filter(Boolean);
    const fieldOfStudyAlternatives = entry.fieldOfStudyAlternatives === undefined ? undefined
      : list(entry.fieldOfStudyAlternatives, 'Field of study alternatives')
        .map((value, index) => string(value, `Field of study alternative ${index + 1}`).replace(/\s+/g, ' ')).filter(Boolean);
    return { ...details, ...(campus ? { campus } : {}), ...(current === undefined ? {} : { current }),
      ...(degreeAlternatives === undefined ? {} : { degreeAlternatives }),
      ...(fieldOfStudyAlternatives === undefined ? {} : { fieldOfStudyAlternatives }) };
  });
  const workAuthorizations = records(data.workAuthorizations, 'Work authorizations').map(entry => {
    const country = string(entry.country, 'Work authorization country');
    if (!country) throw new Error('Each work authorization entry needs a country.');
    const authorization: WorkAuthorization = { country };
    const authorized = optionalBoolean(entry.authorized, 'Work authorization');
    const fullTimeAuthorized = optionalBoolean(entry.fullTimeAuthorized, 'Full-time work authorization');
    const sponsorshipRequired = optionalBoolean(entry.sponsorshipRequired, 'Sponsorship required');
    if (authorized !== undefined) authorization.authorized = authorized;
    if (fullTimeAuthorized !== undefined) authorization.fullTimeAuthorized = fullTimeAuthorized;
    if (sponsorshipRequired !== undefined) authorization.sponsorshipRequired = sponsorshipRequired;
    return authorization;
  });
  if (workAuthorizations.length) profile.workAuthorizations = workAuthorizations;
  if (data.applicationDefaults !== undefined) {
    profile.applicationDefaults = applicationDefaults(data.applicationDefaults);
  }
  const skills = list(data.skills, 'Skills').map((value, index) => string(value, `Skill ${index + 1}`)).filter(Boolean);
  if (skills.length) profile.skills = skills;
  profile.answers = records(data.answers, 'Saved answers').map(entry => {
    const result = fields(entry, ['question', 'answer'] as const);
    if (!result.question || !result.answer) throw new Error('Each saved answer needs a question and answer.');
    return result;
  });
  if (data.resume !== undefined) profile.resume = attachment(data.resume);
  return profile;
}
export function exportProfile(profile: Profile): string { return JSON.stringify(parseProfile(profile), null, 2); }
