import { workdaySkillsWidget } from './workday-skills';
import type { Education, Employment, PersonalDetails, Profile } from '../shared/types';
import { isAshbyLocation, labelText, normalize, normalizeQuestion, words, type Choice, type Field, type SectionKind } from './discovery';
import { countryKey, degreeRecordCompatible, explicitCountryKey, fitKnownChoice, formatDate, formatDegree, formatDegreePreferences, formatDialCode, formatPhoneCountry, formatRegion } from './answer-formats';
import { configuredApplicationAnswer, semanticQuestion } from './semantic-options';
import { isReferralQuestion, referralAnswer } from './referral-source';
import { answerWorkAuthorization, applicationPostingLocation } from './work-authorization';
import { formatSchoolName, sameSchoolIdentity, sameWorkdaySchoolIdentity, workdaySchoolSearch, type WorkdaySchoolSearch } from './education-school';
import { formatFieldOfStudy } from './field-of-study';
import { greenhouseLocationWidget, isGreenhouseCandidateLocation } from './greenhouse-location';
import { workdayEducationRow, workdayExperienceSelector } from './workday-structure';
import { workdaySchoolWidget } from './workday-school';

type SemanticKey = keyof PersonalDetails | 'fullName' | 'preferredName' | 'hasPreferredName';
type Answer = string | boolean;
type RecordKey = keyof Employment | keyof Education;
const degreeLabel = /^(?:degree(?: type| name)?|qualification(?: type)?)$/;
const medicalDegreeCaption = /^(?:medical doctor|doctor of medicine)(?: m ?d)?$/;
const fieldOfStudyLabel = /^(?:field of study|major|course of study|discipline)$/;

const personalLabels: [SemanticKey, RegExp][] = [
  ['firstName', /^(?:(?:legal|given) )?first name$|^given name$|^fname$/],
  ['middleName', /^(?:legal )?(?:middle|additional) name$/],
  ['lastName', /^(?:legal )?(?:last|family) name$|^surname$|^lname$/],
  ['fullName', /^(?:full|legal|candidate|applicant)? ?name$|^(?:your )?full legal name$/],
  ['preferredFirstName', /^(?:preferred|chosen) (?:first|given) name$/],
  ['preferredMiddleName', /^(?:preferred|chosen) middle name$/],
  ['preferredLastName', /^(?:preferred|chosen) (?:last|family) name$|^(?:preferred|chosen) surname$/],
  ['preferredName', /^(?:(?:preferred|chosen|preferred or chosen) (?:full )?name|(?:preferred name )?what would you like us to call you)$/],
  ['hasPreferredName', /^(?:i have|do you have) a preferred name$/],
  ['email', /^(?:(?:primary|personal|contact) )?e ?mail(?: address)?$/],
  ['phone', /^(?:(?:primary|contact|mobile|cell|daytime|home) )?(?:phone|telephone)(?: number)?$|^(?:mobile|cell) number$/],
  ['phoneCountryCode', /^(?:(?:phone|telephone|mobile) (?:country )?code|country (?:phone|telephone|dialing|calling) code|international (?:dialing|calling) code|dial(?:ing)? code)$/],
  ['phoneType', /^(?:phone|telephone)(?: device)? type$|^type of phone$/],
  ['address', /^(?:home |street |mailing )?address(?: line)? 1$|^(?:street|mailing|home) address$|^address$/],
  ['address2', /^(?:(?:street |home |mailing )?address(?: line)? 2|address line two|apartment(?: suite| unit)?|apt suite|suite|unit)$/],
  ['county', /^(?:current )?county$/],
  ['city', /^(?:(?:current )?city(?: or town)?|town|(?:current )?location city)$/],
  ['state', /^(?:current )?(?:state|province|region)(?: (?:or )?(?:state|province|region))?$/],
  ['postalCode', /^(?:zip postal|postal zip|zip|postal|post) code$|^zip$/],
  ['country', /^(?:country(?: territory| region| of residence)?|current country)$/],
  ['linkedin', /^(?:your )?linked ?in(?: profile)?(?: url| link)?$/],
  ['website', /^(?:your )?(?:portfolio(?: website)?|personal website|other website|website)(?: url| link)?$/],
  ['github', /^(?:your )?git ?hub(?: profile)?(?: url| link)?$/],
];

const autocompleteKey: Record<string, SemanticKey | undefined> = {
  'given-name': 'firstName', 'additional-name': 'middleName', 'family-name': 'lastName', 'name': 'fullName', 'nickname': 'preferredName',
  'email': 'email', 'tel': 'phone', 'tel-country-code': 'phoneCountryCode',
  'street-address': 'address', 'address-line1': 'address', 'address-line2': 'address2', 'address-level1': 'state', 'address-level2': 'city',
  'postal-code': 'postalCode', 'country': 'country', 'country-name': 'country',
};

const employmentKeys: [keyof Employment, RegExp][] = [
  ['company', /^(?:company(?: name)?|employer(?: name)?|organization(?: name)?)$/],
  ['title', /^(?:job |position |role )?title$|^(?:position|job role)$/],
  ['location', /^(?:work |job |company )?location$/],
  ['startDate', /^(?:start|from|begin)(?: date)?$/],
  ['endDate', /^(?:end|to)(?: date)?$/],
  ['current', /^(?:current(?:ly)?(?: job| role| employer)?|i currently work here|current position|do you currently work here)$/],
  ['description', /^(?:role |job |position )?description$|^(?:role |job )?responsibilities$/],
];

const educationKeys: [keyof Education, RegExp][] = [
  ['school', /^(?:school(?: name| or university)?|university(?: name)?|college(?: name)?|institution(?: name)?|educational institution)$/],
  ['degree', degreeLabel],
  ['fieldOfStudy', fieldOfStudyLabel],
  ['startDate', /^(?:start|from|begin)(?: date)?$/],
  ['endDate', /^(?:end|to|graduation|expected graduation)(?: date)?$/],
  ['current', /^(?:(?:i )?(?:am )?currently (?:attend(?:ing)?|enrolled|studying)(?: here)?|(?:do you|are you) currently (?:attend(?:ing)?|enrolled)(?: here)?|current(?:ly)? (?:education|student|enrollment))$/],
  ['gpa', /^(?:cumulative |overall )?(?:gpa|grade point average)$/],
];

const sensitivePurpose = /\b(?:authori[sz](?:ed|ation)|sponsor(?:ship|ed)?|visa|citizen(?:ship)?|immigra(?:nt|tion)|work permit|right to work|(?:eligible|entitled|permitted) to work|legal(?:ly)?|lawful(?:ly)?|religion|religious|ethnicity|ethnic|race|racial|gender|pronouns?|sexual(?:ity| orientation)?|sex(?:ual)?|transgender|marital|married|spouse|dependents|family status|veteran|military service|disabilit(?:y|ies)|disabled|medical|health|accommodations?|medical history|birth(?:date|day)?|dob|age|e ?e ?o(?: c)?|self identifica(?:tion|tion form)|hispanic|latino|latina|latinx|salary|compensation|pay expectation|income|nationality|national origin|social security|ssn|national id|tax(?:payer)?|criminal|felony|convict(?:ed|ion)|background check|drug test|credit check|security clearance|passport|drivers? licen[cs]e|references?|political|genetic|height|weight)\b/i;
const harmlessLegalName = /\b(?:legal (?:first |given |middle |additional |last |family )?name|full legal name)\b/g;
const firstAndLastName = /^(?:(?:please )?(?:list|enter|provide)(?: your)? |what (?:is|are) your |your )?(?:legal )?(?:first|given)(?: name)? (?:and )?(?:legal )?(?:last|family) names?$/;
const preferredNameCaption = /\b(?:(?:preferred|chosen)(?: or (?:preferred|chosen))? (?:(?:first|given|middle|additional|last|family|full|first and last) )?names?|(?:preferred|chosen) surname|what would you like us to call you)\b/;
const nameAsConfirmation = /\bby (?:entering|typing|providing|writing|listing|submitting) (?:(?:your|the) )?(?:(?:full|legal|first and last) )*names?(?: above| below)? (?:you )?(?:confirm|affirm|declare|acknowledge|agree|certify|attest)\b/;
const currentEmployer = /^(?:(?:your |who is your |what is your )?current (?:company|employer|organization)(?: name)?|name of your current employer)$/;
const currentTitle = /^(?:your |what is your )?current (?:job |position |role )?title$/;
const splitDateLabel = /^(?:(start|from|begin|end|to|graduation|expected graduation)(?: date)? (month|year)|(month|year) (?:of )?(start|from|begin|end|to|graduation|expected graduation)(?: date)?)$/;
const hiringQuestion = /^(?:what|when|why|how|where|which|who|tell|describe|share|explain|provide an example|give an example|have|are|is|do|does|can|could|will|would|did)\b|^(?:additional (?:information|details|comments)|cover letter)$/;
const currentLocationLabel = /^(?:current location|where are you currently located)$/;
const portfolioObject = '(?:portfolio(?: website)?|personal website|website(?: or portfolio)?|portfolio or website)';
const portfolioRequest = new RegExp('^(?:please )?(?:provide|share|enter|link)(?: (?:a|the))?(?: (?:link|url) to)?(?: your)? '
  + portfolioObject + '(?: (?:url|link))?(?: with us| here)?$');
const portfolioShareQuestion = /^do you have a portfolio (?:that )?you would like to share(?: with us)?$/;
const portfolioLinkRequest = /^(?:please )?(?:provide|share|enter)(?: (?:a|the))? (?:link|url) (?:to|for) (?:(?:your|a|the) )?(?:(?:design|online|professional) )?portfolio(?: (?:demonstrating|showcasing|showing|featuring|containing) [\p{L}\p{N} ]{1,180})?$/u;
const portfolioAdditionalRequest = /\b(?:explain|describe|tell|include|list|provide|share|attach|upload|write|someone else|another designer)\b/;

function asksPortfolioUrl(label: string): boolean {
  if (portfolioRequest.test(label) || portfolioShareQuestion.test(label)) return true;
  if (!portfolioLinkRequest.test(label)) return false;
  const description = label.split(/\bportfolio\b/)[1] ?? '';
  return !portfolioAdditionalRequest.test(description);
}
const schoolName = '(?:school|university|college|educational institution)';
const currentSchool = new RegExp(`^(?:(?:your )?current ${schoolName}(?: name)?|(?:which|what) ${schoolName} are you (?:currently )?attending)$`);
const lastSchool = new RegExp(`^(?:(?:your )?(?:last|most recent) ${schoolName}(?: attended)?|(?:which|what) ${schoolName} did you (?:last|most recently) attend)$`);
const currentOrLastSchool = new RegExp(`^(?:(?:your )?current or (?:last|most recent) ${schoolName}|(?:which|what) ${schoolName} are you currently attending or did you last attend)$`);
const simpleSchool = new RegExp(`^(?:your )?(?:${schoolName}(?: name)?|(?:school|college) (?:or )?university|name of (?:your )?${schoolName})$`);
const unlistedSchoolInstruction = / please (?:select|choose) other school not listed if your school is not listed$/;
const academicInstitution = /\b(?:universit(?:y|ies)|college|school|institute|academy|seminary|polytechnic|conservatory|faculty)\b/;
const graduationYear = /^(?:(?:what is|when is|please (?:include|enter|provide|select|specify)) )?(?:your )?(?:(intended|expected|anticipated|projected|actual) )?graduation year$|^year of (?:(intended|expected|anticipated|projected|actual) )?graduation$/;
const programGraduationYear = /^please include your intended graduation year for the degree or relevant learning program that you are currently pursuing or have completed$/;

function matchingKey<Key extends string>(source: string, rules: [Key, RegExp][]): Key | undefined {
  return rules.find(([, pattern]) => pattern.test(source))?.[0];
}

function identifierTail(identifier: string): string {
  return words(identifier.split(/(?:[.\]]|\d[_-])/).at(-1) ?? '').replace(/^\d+\s+|\s+\d+$/g, '');
}

function schoolQuestion(source: string): 'any' | 'current' | 'last' | 'currentOrLast' | undefined {
  const label = source.replace(unlistedSchoolInstruction, '');
  if (currentSchool.test(label)) return 'current';
  if (lastSchool.test(label)) return 'last';
  if (currentOrLastSchool.test(label)) return 'currentOrLast';
  if (simpleSchool.test(label)) return 'any';
}

function standaloneEducationControl(field: Field): boolean {
  return !field.multiple && (field.kind === 'text' || field.kind === 'select' || field.kind === 'combobox');
}

function graduationQuestion(label: string): 'any' | 'expected' | 'completed' | 'pursuedOrCompleted' | undefined {
  if (programGraduationYear.test(label)) return 'pursuedOrCompleted';
  if (/^(?:what year did you graduate|year graduated)$/.test(label)) return 'completed';
  const match = graduationYear.exec(label);
  if (!match) return undefined;
  const qualifier = match[1] ?? match[2];
  return qualifier === 'actual' ? 'completed' : qualifier ? 'expected' : 'any';
}

export function asksFirstAndLastName(field: Field): boolean {
  return field.kind === 'text' && field.trustedLabel && firstAndLastName.test(words(field.label));
}

export function asksPreferredName(field: Field): boolean {
  return field.trustedLabel && preferredNameCaption.test(words(field.label));
}

function nameAttestation(field: Field): boolean {
  return asksFirstAndLastName(field) && nameAsConfirmation.test(words(field.context));
}

function isEducationDegreeChoice(field: Field, label = words(field.label)): boolean {
  return field.section === 'education' && field.trustedLabel && !field.multiple
    && (field.kind === 'select' || field.kind === 'combobox') && degreeLabel.test(label);
}

function matchesMedicalDegreeCaption(choice: Choice, caption: string): boolean {
  if (!medicalDegreeCaption.test(caption)) return false;
  const { element, label } = choice;
  const displayed = element.matches('option') ? (element as HTMLOptionElement).label : element.innerText ?? labelText(element);
  return normalize(displayed) === normalize(label);
}

function isSensitive(field: Field): boolean {
  const label = words(field.label);
  const asksSchool = field.trustedLabel && standaloneEducationControl(field) && field.section !== 'employment' && !!schoolQuestion(label);
  const asksDegree = isEducationDegreeChoice(field, label);
  // An institution name or a medical degree caption can be ordinary education evidence.
  const choices = field.choices.flatMap(choice => {
    const caption = words(choice.label);
    return (asksSchool && academicInstitution.test(caption)) || (asksDegree && matchesMedicalDegreeCaption(choice, caption))
      ? [] : [caption];
  });
  const evidence = [label, words(field.context), ...field.metadata.map(words), ...choices];
  const sensitiveEvidence = asksFirstAndLastName(field) ? evidence.filter(part => !firstAndLastName.test(part)) : evidence;
  return nameAttestation(field) || !!semanticQuestion(field) || sensitivePurpose.test(sensitiveEvidence.join(' ').replace(harmlessLegalName, 'name'));
}

export function eligibleForReviewedAnswer(field: Field): boolean {
  if (isReferralQuestion(field)) return false;
  if (isAshbyLocation(field.element) || isGreenhouseCandidateLocation(field.element)) return false;
  if (!field.trustedLabel || field.blocked || field.section || isSensitive(field) || field.kind === 'file' || field.kind === 'checkbox') return false;
  const label = words(field.label);
  return !asksFirstAndLastName(field) && !asksPreferredName(field) && !asksPortfolioUrl(label)
    && !currentLocationLabel.test(label) && !currentEmployer.test(label) && !currentTitle.test(label)
    && !schoolQuestion(label) && !graduationQuestion(label)
    && hiringQuestion.test(label);
}

function personalAnswer(field: Field, personal: PersonalDetails): Answer | undefined {
  const autocomplete = field.autocomplete.split(/\s+/).at(-1) ?? '';
  const label = words(field.label);
  if (asksFirstAndLastName(field)) {
    const first = personal.firstName.trim();
    const last = personal.lastName.trim();
    return first && last ? first + ' ' + last : undefined;
  }
  if (isGreenhouseCandidateLocation(field.element) && (field.kind !== 'combobox' || !field.trustedLabel || !greenhouseLocationWidget(field.element))) return undefined;
  if (field.kind === 'combobox' && (isAshbyLocation(field.element) || isGreenhouseCandidateLocation(field.element))) {
    const parts = [personal.city, personal.state, personal.country].map(value => value?.trim());
    return parts.every(Boolean) ? parts.join(', ') : undefined;
  }
  if (field.kind === 'text' && field.trustedLabel && asksPortfolioUrl(label)) {
    return personal.website || undefined;
  }
  if (field.kind === 'text' && field.trustedLabel && currentLocationLabel.test(label)) {
    const location = [personal.city, personal.state, personal.country].map((value) => value?.trim()).filter(Boolean).join(', ');
    return location || undefined;
  }
  const humanKey = matchingKey(label, personalLabels);
  if (!humanKey && asksPreferredName(field)) return undefined;
  // A meaningful visible question takes priority over machine names.
  const metadataKey = field.trustedLabel ? undefined : field.metadata.map((name) => matchingKey(identifierTail(name), personalLabels)).find(Boolean);
  const key = humanKey ?? (!field.trustedLabel || !hiringQuestion.test(label) ? autocompleteKey[autocomplete] : undefined) ?? metadataKey
    ?? (!field.trustedLabel && field.element.matches('input[type="email"]') ? 'email' : undefined)
    ?? (!field.trustedLabel && field.element.matches('input[type="tel"]') ? 'phone' : undefined);
  if (key === 'fullName') return [personal.firstName, personal.middleName, personal.lastName].filter(Boolean).join(' ');
  if (key === 'preferredName' || key === 'hasPreferredName') {
    const preferred = [personal.preferredFirstName, personal.preferredMiddleName, personal.preferredLastName].filter(Boolean).join(' ');
    return preferred ? key === 'hasPreferredName' || preferred : undefined;
  }
  if (key === 'country') {
    if (label === 'country' && field.trustedLabel && /^(?:phone|telephone|mobile)(?: number)?$/.test(words(field.context))) {
      return formatPhoneCountry(field, personal.country, personal.phone, personal.phoneCountryCode);
    }
    return fitKnownChoice(field, personal.country, countryKey, true);
  }
  if (key === 'state') return formatRegion(field, personal.state, personal.country);
  if (key === 'phoneCountryCode') {
    if (personal.phoneCountryCode) return formatDialCode(field, personal.phoneCountryCode, personal.country);
    if (field.kind === 'select' || field.kind === 'combobox') return formatPhoneCountry(field, personal.country, personal.phone);
    return undefined;
  }
  return key ? personal[key] : undefined;
}

function booleanControl(field: Field): boolean {
  if (field.kind === 'checkbox') return !field.multiple;
  const options = new Set(field.choices.map(({ label }) => words(label)));
  return options.size === 2 && options.has('yes') && options.has('no');
}

function currentJobKey(field: Field, label: string): 'company' | 'title' | undefined {
  if (field.kind === 'file' || field.kind === 'radio' || field.kind === 'checkbox' || field.multiple) return undefined;
  if (currentTitle.test(label)) return 'title';
  return currentEmployer.test(label) && !booleanControl(field) ? 'company' : undefined;
}

type DateKey = 'startDate' | 'endDate';
type DatePart = 'month' | 'year';

function fieldLabels(field: Field): string[] {
  const label = words(field.label);
  return field.trustedLabel ? [label] : [label, ...field.metadata.map(identifierTail)];
}

function datePart(field: Field): { key: DateKey; part: DatePart } | undefined {
  const labels = fieldLabels(field);
  for (const label of labels) {
    const match = label.match(splitDateLabel);
    if (!match) continue;
    const direction = match[1] ?? match[4];
    const part = (match[2] ?? match[3]) as DatePart;
    return { key: /^(?:start|from|begin)$/.test(direction) ? 'startDate' : 'endDate', part };
  }
}

function recordKey(field: Field): RecordKey | undefined {
  const employment = field.section === 'employment';
  const rules: [RecordKey, RegExp][] = employment ? employmentKeys : educationKeys;
  const labels = fieldLabels(field);
  return datePart(field)?.key ?? labels.map((label) => {
    if (employment && currentEmployer.test(label) && booleanControl(field)) return 'current';
    return (employment ? currentJobKey(field, label) : undefined) ?? matchingKey(label, rules);
  }).find(Boolean);
}

function recordAnswer(field: Field, record: ProfileRecord): Answer | undefined {
  const key = recordKey(field);
  if (!key || !(key in record)) return undefined;
  const value = (record as unknown as { [key: string]: Answer })[key];
  if (key === 'endDate' && record.current === true) return undefined;
  if (typeof value !== 'string') return value;
  if (key === 'startDate' || key === 'endDate') return formatDate(field, value, datePart(field)?.part);
  if (key === 'degree' && 'school' in record) return formatDegreePreferences(field, value, record.degreeAlternatives);
  if (key === 'school' && 'school' in record) return formatSchoolName(field, value, record.campus);
  return value;
}

function educationAnswer(field: Field, records: Education[]): { answer?: string; semantic?: 'visible' } | undefined {
  if (!standaloneEducationControl(field)) return undefined;
  const label = words(field.label);
  const school = schoolQuestion(label);
  const graduation = graduationQuestion(label);
  if (!school && !graduation) return undefined;

  const entries = records.filter(record => [record.school, record.degree, record.fieldOfStudy, record.startDate, record.endDate, record.gpa]
    .some(value => value.trim()));
  const only = entries.length === 1 ? entries[0] : undefined;
  const ongoing = entries.filter(record => record.current === true);
  const current = ongoing.length === 1 ? ongoing[0] : undefined;
  let record = only;
  if (school === 'current') record = current;
  if (school === 'last' || school === 'currentOrLast' || graduation === 'pursuedOrCompleted') {
    if (ongoing.length) {
      record = current;
    } else if (!record && entries.length) {
      const yearField = { ...field, choices: [] };
      const endYears = entries.map(entry => formatDate(yearField, entry.endDate, 'year'));
      if (endYears.some(year => year === undefined)) return {};
      const latest = Math.max(...endYears.map(Number));
      const latestEntries = entries.filter((_, index) => Number(endYears[index]) === latest);
      if (latestEntries.length === 1) record = latestEntries[0];
    }
  }
  if (graduation === 'expected') record = current ?? (only?.current === undefined ? only : undefined);
  if (!record) return {};

  if (school) {
    return { answer: formatSchoolName(field, record.school, record.campus), semantic: 'visible' };
  }
  if (graduation === 'completed') {
    const endYear = formatDate({ ...field, choices: [] }, record.endDate, 'year');
    if (record.current === true || !endYear || Number(endYear) > new Date().getFullYear()) return {};
  }
  return { answer: formatDate(field, record.endDate, 'year') };
}

function workAuthorizationAnswer(field: Field, profile: Profile): { answer?: boolean; conflict?: boolean; semantic?: true } {
  if (!field.trustedLabel || field.blocked || field.kind === 'file') return {};
  const sponsorship = semanticQuestion(field);
  const visa = sponsorship?.topic === 'visaSponsorship' ? sponsorship : undefined;
  if (!visa && (booleanControl(field) || (field.kind === 'combobox' && !field.multiple && !field.choices.length))) {
    const authorization = answerWorkAuthorization(field.label, profile.workAuthorizations, applicationPostingLocation(field.element));
    if (authorization) return { answer: authorization.answer, conflict: authorization.conflict };
  }
  const scope = visa?.location;
  if (scope && /^(?:the )?us$/.test(scope) && !/\bUS\b/.test(field.label + ' ' + field.context)) return {};
  const country = scope && explicitCountryKey(scope);
  if (!country) return {};
  const answers = new Set<boolean>();
  for (const entry of profile.workAuthorizations ?? []) {
    const answer = entry.sponsorshipRequired;
    if (countryKey(entry.country) === country && typeof answer === 'boolean') answers.add(answer);
  }
  if (answers.size > 1) return { conflict: true };
  const answer = answers.values().next().value;
  if (visa && answer !== undefined) return { answer: visa.inverse ? !answer : answer, semantic: true };
  return { answer };
}

type ProfileRecord = Employment | Education;
type ReadValue = (field: Field) => string;

export interface RecordMatch {
  record?: ProfileRecord;
  identities: Field[];
  possibleRecords: ProfileRecord[];
}

export function matchRows(fields: Field[], profile: Profile, currentValue: ReadValue): Map<Field, RecordMatch> {
  const groupKeys = new Map<Element, Map<string, Field[]>>();
  for (const field of fields) {
    if (!field.row || !field.section) continue;
    const rows = groupKeys.get(field.row) ?? new Map<string, Field[]>();
    const key = [field.section, field.rowIndex ?? ''].join('/');
    const row = rows.get(key) ?? [];
    row.push(field);
    rows.set(key, row);
    groupKeys.set(field.row, rows);
  }
  const rows = [...groupKeys.values()].flatMap((group) => [...group.values()]);
  const records = new Map<Field, RecordMatch>();
  const sections: [SectionKind, ProfileRecord[], 'company' | 'school'][] = [
    ['employment', profile.employment, 'company'], ['education', profile.education, 'school'],
  ];
  for (const [section, candidates, identityKey] of sections) {
    const matchingRows = rows.filter((row) => row[0].section === section).map((row) => {
      const identities = row.filter((field) => recordKey(field) === identityKey);
      const identity = identities[0];
      const workday = section === 'employment' && !!row[0].element.closest(workdayExperienceSelector);
      const titles = workday ? row.filter(field => recordKey(field) === 'title') : [];
      const workdayEducation = section === 'education' && !!workdayEducationRow(row[0].element);
      const details = workdayEducation ? row.filter(field => field !== identity && !!recordKey(field) && !!currentValue(field)) : [];
      return {
        row, identity, title: titles[0], workday, workdayEducation, details, ambiguous: identities.length > 1 || titles.length > 1,
        value: identity ? normalize(currentValue(identity)) : '',
      };
    });
    const used = new Set<number>();
    const reserved = new Set<number>();
    const blocked = new Set<Field[]>();
    const assign = ({ row, identity, title, details }: typeof matchingRows[number], index: number, possible: number[] = []) => {
      const record = candidates[index];
      const identities = [...new Set([identity, title, ...details, ...row.filter(field => section === 'education' && !!workdayEducationRow(field.element) && recordKey(field) === 'degree')])].filter((field): field is Field => !!field);
      const match = { record, identities, possibleRecords: possible.map(candidate => candidates[candidate]) };
      row.forEach((field) => records.set(field, match));
      if (record) used.add(index);
    };
    const detailsMatch = (entry: typeof matchingRows[number], candidate: ProfileRecord) => entry.details.every(field => {
      const key = recordKey(field);
      const observed = currentValue(field);
      if (key === 'degree' && 'school' in candidate) return [candidate.degree, ...(candidate.degreeAlternatives ?? [])]
        .some(degree => degreeRecordCompatible(observed, degree));
      const expected = recordAnswer(field, candidate);
      return typeof expected === 'boolean' ? words(observed) === (expected ? 'yes' : 'no')
        : typeof expected === 'string' && normalize(observed) === normalize(expected);
    });
    const populatedRows = matchingRows.filter(entry => entry.value).map(entry => {
      const currentTitle = entry.title ? normalize(currentValue(entry.title)) : '';
      const matches = candidates.map((candidate, index) => {
        if (!(identityKey in candidate)) return -1;
        if (entry.workday && 'company' in candidate && currentTitle && normalize(candidate.title) !== currentTitle) return -1;
        const same = identityKey === 'school' && 'school' in candidate
          ? (workdaySchoolWidget(entry.identity!.element) ? sameWorkdaySchoolIdentity(entry.value, candidate.school, candidate.campus) : sameSchoolIdentity(entry.value, candidate.school, candidate.campus))
          : normalize((candidate as unknown as { [key: string]: string })[identityKey]) === entry.value;
        return same && (!entry.workdayEducation || detailsMatch(entry, candidate)) ? index : -1;
      }).filter((index) => index >= 0);
      return { entry, matches };
    });
    const workdayClaims = new Map<number, number>();
    for (const { entry, matches } of populatedRows) {
      if ((!entry.workday && !entry.workdayEducation) || matches.length !== 1) continue;
      const [index] = matches;
      workdayClaims.set(index, (workdayClaims.get(index) ?? 0) + 1);
    }
    for (const { entry, matches: candidatesForRow } of populatedRows) {
      // A broad school label stays ambiguous even if a different row already used one campus.
      const matches = entry.workday || identityKey === 'school' ? candidatesForRow : candidatesForRow.filter(index => !used.has(index));
      const duplicateWorkdayClaim = (entry.workday || entry.workdayEducation) && matches.length === 1 && (workdayClaims.get(matches[0]) ?? 0) > 1;
      if ((entry.workday || entry.workdayEducation) && (matches.length > 1 || entry.ambiguous || duplicateWorkdayClaim)) {
        matches.forEach(index => reserved.add(index));
      }
      assign(entry, matches.length === 1 && !used.has(matches[0]) && !entry.ambiguous && !duplicateWorkdayClaim ? matches[0] : -1, matches);
      blocked.add(entry.row);
    }
    const partialRows = matchingRows.filter(item => item.workdayEducation && !item.value && item.details.length).map(entry => ({
      entry, matches: candidates.map((candidate, index) => !used.has(index) && detailsMatch(entry, candidate) ? index : -1).filter(index => index >= 0),
    }));
    for (const { entry, matches } of partialRows) {
      const duplicate = matches.length === 1 && partialRows.filter(item => item.matches.includes(matches[0])).length > 1;
      const unique = matches.length === 1 && !entry.ambiguous && !duplicate && !reserved.has(matches[0]);
      assign(entry, unique ? matches[0] : -1, matches);
      if (!unique) matches.forEach(index => reserved.add(index));
      blocked.add(entry.row);
    }
    for (const entry of matchingRows) {
      if (blocked.has(entry.row)) continue;
      // Already populated details without a company/school cannot be paired reliably.
      const unexplained = entry.row.some((field) =>
        field !== entry.identity && !!recordKey(field) && !!currentValue(field));
      const index = candidates.findIndex((candidate, i) => !used.has(i) && !reserved.has(i)
        && (!entry.workday || ('company' in candidate && !!normalize(candidate.company) && !reserved.has(i))));
      if (entry.ambiguous || unexplained || (!entry.identity && matchingRows.length > 1)) {
        assign(entry, -1);
      } else {
        assign(entry, index);
      }
    }
  }
  return records;
}

export function localAnswer(field: Field, profile: Profile, row: RecordMatch | undefined): {
  answer?: Answer;
  sensitive: boolean;
  conflict?: boolean;
  semantic?: true | 'visible';
  choiceRank?: (choice: Choice) => number;
  schoolSearch?: WorkdaySchoolSearch;
} {
  const sensitive = isSensitive(field);
  if (nameAttestation(field)) return { sensitive };
  const question = field.trustedLabel ? normalizeQuestion(field.label) : '';
  const saved = question ? new Set(profile.answers
    .filter((entry) => normalizeQuestion(entry.question) === question)
    .map((entry) => entry.answer.trim())
    .filter(Boolean)) : undefined;
  if (saved && saved.size > 1) return { sensitive, conflict: true };
  const answer = saved?.values().next().value;
  if (answer) {
    if (!sensitive && isEducationDegreeChoice(field)) {
      const key = normalize(answer);
      const exactChoice = field.choices.some(choice => normalize(choice.label) === key || normalize(choice.value) === key);
      if (!exactChoice) return { answer: formatDegree(field, answer), sensitive };
    }
    return { answer, sensitive };
  }
  if (isReferralQuestion(field)) return { answer: referralAnswer(field, profile.applicationDefaults), sensitive };
  if (sensitive) {
    const context = words(field.context);
    if (/^(?:(?:your|applicant s) )?(?:spouse|partner|dependent|dependant|emergency contact|reference)\b/.test(context)) return { sensitive };
    const meaning = semanticQuestion(field);
    if (meaning?.unlessLocatedIn) {
      const city = words(profile.personal.city);
      // Do not assert a location-dependent branch for residents or unknown cities.
      if (!city || /^[A-Z]{2,4}$/.test(profile.personal.city.trim())
        || (` ${meaning.unlessLocatedIn} `).includes(` ${city} `)) return { sensitive };
    }
    const workAnswer = workAuthorizationAnswer(field, profile);
    if (workAnswer.answer !== undefined || workAnswer.conflict) return { ...workAnswer, sensitive };
    const defaults = profile.applicationDefaults;
    const answer = defaults && field.trustedLabel && !field.blocked && field.kind !== 'file'
      ? configuredApplicationAnswer(field, defaults) : undefined;
    return answer === undefined ? { sensitive } : { answer, sensitive, semantic: true };
  }
  if (field.section) {
    const record = row?.record;
    if (field.section === 'education' && record && 'school' in record
      && field.trustedLabel && fieldOfStudyLabel.test(words(field.label))) {
      return { ...formatFieldOfStudy(field, record), sensitive };
    }
    if (record && 'school' in record && recordKey(field) === 'school' && workdaySchoolWidget(field.element)) {
      const search = workdaySchoolSearch(record.school, record.campus);
      return { answer: search?.label, sensitive, semantic: 'visible', schoolSearch: search };
    }
    return { answer: record && recordAnswer(field, record), sensitive,
      ...(field.section === 'education' && recordKey(field) === 'school' ? { semantic: 'visible' } : {}) };
  }
  if (field.trustedLabel) {
    const study = educationAnswer(field, profile.education);
    if (study) return { ...study, sensitive };
    const label = words(field.label);
    const jobKey = currentJobKey(field, label);
    if (jobKey) {
      const current = profile.employment.filter((entry) => entry.current);
      return { answer: current.length === 1 ? current[0][jobKey] : undefined, sensitive };
    }
    if ((/^(?:skills|skill ?set)$/.test(label) || !!workdaySkillsWidget(field.element)) && (field.kind === 'text' || field.multiple)) {
      const delimiter = field.element.matches('input') && !field.multiple ? ', ' : '\n';
      return { answer: profile.skills?.join(delimiter), sensitive };
    }
  }
  return { answer: personalAnswer(field, profile.personal), sensitive };
}

export function isResumeField(field: Field): boolean {
  const labels = field.trustedLabel ? [field.label] : field.metadata;
  return field.kind === 'file' && labels.some((label) =>
    /^(?:upload |attach |choose |select )?(?:your )?(?:resume(?: or)? cv|résumé(?: or)? cv|resume|résumé|cv|curriculum vitae)(?: file| upload)?$/.test(words(label)),
  );
}
