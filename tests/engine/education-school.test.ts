import { expect, test } from 'vitest';
import type { Field } from '../../src/engine/discovery';
import { formatSchoolName, sameSchoolIdentity, workdaySchoolChoice, workdaySchoolSearch, selectWorkdaySchool, sameWorkdaySchoolIdentity } from '../../src/engine/education-school';

const michigan = 'University of Michigan';
const annArbor = 'University of Michigan - Ann Arbor';
const dearborn = 'University of Michigan - Dearborn';
const flint = 'University of Michigan - Flint';
const campuses = [annArbor, dearborn, flint];

function schoolSelect(...labels: string[]): Pick<Field, 'kind' | 'choices'> {
  return {
    kind: 'select',
    choices: labels.map((label, index) => ({ label, value: `school-${index}`, element: document.createElement('option') })),
  };
}

test('uses the explicitly saved campus when several campuses and a broad label appear', () => {
  expect(formatSchoolName(schoolSelect(michigan, ...campuses), michigan, 'Ann Arbor')).toBe(annArbor);
  expect(formatSchoolName(schoolSelect(...campuses), michigan, 'Flint')).toBe(flint);
});

test('resolves case, spacing, and punctuation differences in a saved full campus name', () => {
  expect(formatSchoolName(schoolSelect(...campuses), ' UNIVERSITY OF MICHIGAN  (ANN ARBOR) ')).toBe(annArbor);
  expect(formatSchoolName(schoolSelect(...campuses), 'University of Michigan Ann Arbor', 'Ann Arbor')).toBe(annArbor);
  expect(formatSchoolName(schoolSelect('McGill University'), 'MCGILL UNIVERSITY')).toBe('McGill University');
});

test('resolves a different institution with diacritics while preserving its visible label', () => {
  const label = 'Université de Montréal — Campus de Laval';
  expect(formatSchoolName(schoolSelect(label, 'Université de Montréal — Campus de Longueuil'),
    'Universite de Montreal', 'campus de laval')).toBe(label);
});

test('uses a unique broad label only if the catalog offers no qualified names for that institution', () => {
  expect(formatSchoolName(schoolSelect(michigan, 'Michigan State University', 'Example University - Ann Arbor'), michigan, 'Ann Arbor')).toBe(michigan);
  expect(formatSchoolName(schoolSelect(michigan, dearborn), michigan, 'Ann Arbor')).toBeUndefined();
  expect(formatSchoolName(schoolSelect(dearborn), michigan, 'Ann Arbor')).toBeUndefined();
});

test('does not infer a campus from an unqualified school or from similar names', () => {
  expect(formatSchoolName(schoolSelect(...campuses), michigan)).toBeUndefined();
  expect(formatSchoolName(schoolSelect(annArbor), michigan)).toBeUndefined();
  expect(formatSchoolName(schoolSelect(michigan, ...campuses), michigan)).toBe(michigan);
  expect(formatSchoolName(schoolSelect('U of M - Ann Arbor', 'Ann Arbor University of Michigan'), michigan, 'Ann Arbor')).toBeUndefined();
});

test('leaves duplicate campus and broad labels unanswered after normalization', () => {
  expect(formatSchoolName(schoolSelect(annArbor, 'University of Michigan (Ann Arbor)'), michigan, 'Ann Arbor')).toBeUndefined();
  expect(formatSchoolName(schoolSelect(michigan, michigan.toUpperCase()), michigan, 'Ann Arbor')).toBeUndefined();
});

test('matches school labels without consulting or returning option IDs', () => {
  const field = schoolSelect(annArbor, dearborn);
  field.choices[1].value = annArbor;
  expect(formatSchoolName(field, annArbor)).toBe(annArbor);
  expect(formatSchoolName(schoolSelect(dearborn), 'school-0')).toBeUndefined();
});

test('previews an explicit campus before a lazy menu opens and rechecks loaded labels', () => {
  expect(formatSchoolName({ kind: 'combobox', choices: [] }, michigan, 'Ann Arbor')).toBe(annArbor);
  expect(formatSchoolName({ ...schoolSelect(...campuses), kind: 'combobox' }, michigan, 'Ann Arbor')).toBe(annArbor);
  expect(formatSchoolName({ ...schoolSelect(flint), kind: 'combobox' }, michigan, 'Ann Arbor')).toBeUndefined();
});

test('recognizes an existing broad or campus-qualified label for the saved record', () => {
  expect(sameSchoolIdentity(annArbor, michigan, 'Ann Arbor')).toBe(true);
  expect(sameSchoolIdentity(michigan, michigan, 'Ann Arbor')).toBe(true);
  expect(sameSchoolIdentity('Université de Montréal — Campus de Laval', 'Universite de Montreal', 'Campus de Laval')).toBe(true);
});

test('accepts an explicitly qualified saved school with equivalent punctuation', () => {
  expect(sameSchoolIdentity(annArbor, 'University of Michigan Ann Arbor')).toBe(true);
  expect(sameSchoolIdentity(annArbor, `${michigan} (Ann Arbor)`, 'Ann Arbor')).toBe(true);
  expect(sameSchoolIdentity(michigan, `${michigan} (Ann Arbor)`)).toBe(false);
});

test('does not assign a row to an unknown or different campus or an empty school', () => {
  expect(sameSchoolIdentity(dearborn, michigan, 'Ann Arbor')).toBe(false);
  expect(sameSchoolIdentity(annArbor, michigan)).toBe(false);
  expect(sameSchoolIdentity('U of M - Ann Arbor', michigan, 'Ann Arbor')).toBe(false);
  expect(sameSchoolIdentity('', '')).toBe(false);
  expect(sameSchoolIdentity(michigan, michigan, '---')).toBe(false);
});

test.each([
  [annArbor, 'Dearborn'], [`${michigan}, Ann Arbor`, 'Dearborn'], [`${michigan} (Ann Arbor)`, 'Dearborn'],
  [`${michigan} - Greater Ann Arbor`, 'Ann Arbor'],
])('leaves contradictory qualifiers in %s unresolved', (school, campus) => {
  expect(formatSchoolName(schoolSelect(school), school, campus)).toBeUndefined();
  expect(formatSchoolName({ kind: 'combobox', choices: [] }, school, campus)).toBeUndefined();
  expect(sameSchoolIdentity(school, school, campus)).toBe(false);
});

test('does not fill a visible campus that contradicts the campus saved with an unpunctuated school name', () => {
  expect(formatSchoolName(schoolSelect(annArbor), `${michigan} Ann Arbor`, 'Dearborn')).toBeUndefined();
});

test('does not bind an existing visible campus that contradicts the campus saved with an unpunctuated school name', () => {
  expect(sameSchoolIdentity(annArbor, `${michigan} Ann Arbor`, 'Dearborn')).toBe(false);
});

test('preserves an internal hyphen in the institution name with a separate campus', () => {
  const school = 'Université Paris-Saclay';
  const label = `${school} — Orsay`;
  expect(formatSchoolName(schoolSelect(label), school, 'Orsay')).toBe(label);
  expect(sameSchoolIdentity(label, school, 'Orsay')).toBe(true);
});

test('prepares a school search with the institution, retaining the separately specified campus', () => {
  expect(workdaySchoolSearch(michigan, 'Ann Arbor')).toMatchObject({ query: michigan, label: annArbor });
  expect(workdaySchoolSearch(annArbor, 'Ann Arbor')).toMatchObject({ query: michigan, label: annArbor });
  expect(workdaySchoolSearch(annArbor, 'Dearborn')).toBeUndefined();
});

test('matches the exact verified campus first and never substitutes a competing campus', () => {
  const search = workdaySchoolSearch(michigan, 'Ann Arbor')!;
  const [base, preferred, other] = schoolSelect(michigan, 'University of Michigan (Ann Arbor)', dearborn).choices;
  expect(workdaySchoolChoice(search, [base, preferred, other])).toBe(preferred);
  expect(workdaySchoolChoice(search, [base, other])).toBeUndefined();
  expect(workdaySchoolChoice(search, [base])).toBe(base);
  expect(workdaySchoolChoice(search, [other])).toBeUndefined();
});

test('requires a unique school label and never supplies an unspecified campus', () => {
  const search = workdaySchoolSearch(michigan)!;
  const [base, duplicate, campus] = schoolSelect(michigan, 'UNIVERSITY OF MICHIGAN', annArbor).choices;
  expect(workdaySchoolChoice(search, [base, campus])).toBe(base);
  expect(workdaySchoolChoice(search, [base, duplicate])).toBeUndefined();
  expect(workdaySchoolChoice(search, [campus])).toBeUndefined();
});

test('ranks canonical Michigan campus captions before unambiguous Workday abbreviation variants', () => {
  const search = workdaySchoolSearch(michigan, 'Ann Arbor')!;
  const [broad, other, department, alias, punctuated, exact] = schoolSelect(michigan, dearborn,
    'University of Michigan Ann Arbor School of Engineering', 'U of Michigan Ann Arbor',
    'The University of Michigan, Ann Arbor', annArbor).choices;
  expect(selectWorkdaySchool(search, [broad, other, department, alias, punctuated, exact])).toBe(exact);
  expect(selectWorkdaySchool(search, [alias, punctuated])).toBe(punctuated);
  expect(selectWorkdaySchool(search, [department, other, alias])).toBe(alias);
  expect(selectWorkdaySchool(search, [broad, other, department])).toBeUndefined();
});

test('uses verified catalog order for equivalent Workday school captions within the same specific identity', () => {
  const search = workdaySchoolSearch(michigan, 'Ann Arbor')!;
  const [first, duplicate] = schoolSelect('U of Michigan Ann Arbor', 'U of Michigan Ann Arbor').choices;
  expect(selectWorkdaySchool(search, [first, duplicate])).toBe(first);
});

test('uses an explicitly qualified Michigan school even when the campus is stored in the same string', () => {
  const search = workdaySchoolSearch(`${michigan} - Ann Arbor`)!;
  expect(search).toMatchObject({ query: michigan, campusQuery: 'Ann Arbor', label: annArbor });
  const [campusVariant, broad] = schoolSelect('The University of Michigan, Ann Arbor', michigan).choices;
  expect(selectWorkdaySchool(search, [broad, campusVariant])).toBe(campusVariant);
  expect(sameWorkdaySchoolIdentity(campusVariant.label, annArbor)).toBe(true);
  expect(sameWorkdaySchoolIdentity(dearborn, annArbor)).toBe(false);
});

test('chooses a single verified Workday identity across expanded names and equivalent abbreviations', () => {
  const school = 'University of Toronto';
  const search = workdaySchoolSearch(school, 'Scarborough')!;
  const [abbreviation, expanded, exact, different] = schoolSelect(
    'U of Toronto Scarborough', 'THE UNIV. OF TORONTO (SCARBOROUGH)', 'University of Toronto - Scarborough',
    'University of Toronto - Mississauga',
  ).choices;
  expect(selectWorkdaySchool(search, [abbreviation, expanded, different, exact])).toBe(exact);
  expect(selectWorkdaySchool(search, [expanded, { ...expanded, value: 'different-opaque-id' }])).toBe(expanded);
  expect(sameWorkdaySchoolIdentity(abbreviation.label, school, 'Scarborough')).toBe(true);
  expect(sameWorkdaySchoolIdentity(different.label, school, 'Scarborough')).toBe(false);
  expect(formatSchoolName(schoolSelect(abbreviation.label), school, 'Scarborough')).toBeUndefined();
});

test('does not conflate a Workday school with another campus, a department, or a geographic suffix', () => {
  const school = 'Queensland University';
  const search = workdaySchoolSearch(school)!;
  const [variant, campus, department, country] = schoolSelect(
    'THE QUEENSLAND UNIV.', 'Queensland University Gardens Point', 'Queensland University School of Design', 'Queensland University Australia',
  ).choices;
  expect(selectWorkdaySchool(search, [campus, department, country])).toBeUndefined();
  expect(selectWorkdaySchool(search, [variant, campus, department, country])).toBe(variant);
  const qualified = workdaySchoolSearch(school, 'Gardens Point')!;
  expect(selectWorkdaySchool(qualified, [variant, department, country])).toBeUndefined();
  expect(selectWorkdaySchool(qualified, [variant, campus, department, country])).toBe(campus);
  expect(sameWorkdaySchoolIdentity(country.label, school)).toBe(false);
});
