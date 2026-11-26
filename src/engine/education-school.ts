import { words, type Choice, type Field } from './discovery';

function schoolKey(label: string): string {
  return words(label.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US'));
}

function conflictsWithCampus(label: string, campusName: string): boolean {
  if (!campusName) return false;
  // Terminal annotations can specify a campus. An internal hyphen alone is part of the institution name.
  const text = label.trim();
  const qualifier = /\(([^()]+)\)$/.exec(text)?.[1]
    ?? /\s[-–—]\s+(.+)$/.exec(text)?.[1]
    ?? /,\s*(.+)$/.exec(text)?.[1];
  return !!qualifier && schoolKey(qualifier) !== campusName;
}

function savedSchool(school: string, campus: string) {
  const schoolLabel = school.trim();
  const campusLabel = campus.trim();
  const schoolName = schoolKey(schoolLabel);
  const campusName = schoolKey(campusLabel);
  if (!schoolName || (campusLabel && !campusName)) return undefined;

  if (conflictsWithCampus(schoolLabel, campusName)) return undefined;

  const hasCampus = !!campusName && schoolName.endsWith(' ' + campusName);
  const base = hasCampus ? schoolName.slice(0, -(campusName.length + 1)) : schoolName;
  const lastCampus = hasCampus ? [...schoolLabel.matchAll(/[^\s(,–—-]+/g)]
    .find(token => schoolKey(schoolLabel.slice(token.index)) === campusName) : undefined;
  return {
    base,
    query: lastCampus ? schoolLabel.slice(0, lastCampus.index).replace(/[\s,(–—-]+$/, '') : schoolLabel,
    campusName,
    campusQuery: campusLabel,
    qualified: campusName ? `${base} ${campusName}` : base,
    label: campusName && !hasCampus ? `${schoolLabel} - ${campusLabel}` : schoolLabel,
  };
}

export function sameSchoolIdentity(selectedLabel: string, school: string, campus = ''): boolean {
  const identity = savedSchool(school, campus);
  const selected = schoolKey(selectedLabel);
  return !!identity && (selected === identity.base || selected === identity.qualified)
    && !conflictsWithCampus(selectedLabel, identity.campusName);
}

export function formatSchoolName(field: Pick<Field, 'kind' | 'choices'>, school: string, campus = ''): string | undefined {
  const identity = savedSchool(school, campus);
  if (!identity) return undefined;
  if (!field.choices.length) {
    if (field.kind !== 'text' && field.kind !== 'combobox') return undefined;
    return identity.label;
  }
  return workdaySchoolChoice(identity, field.choices)?.label;
}

export type WorkdaySchoolSearch = NonNullable<ReturnType<typeof savedSchool>>;

export function workdaySchoolSearch(school: string, campus = ''): WorkdaySchoolSearch | undefined {
  const explicitMichiganCampus = !campus.trim() && /^university of michigan (ann arbor|dearborn|flint)$/.exec(workdaySchoolKey(school));
  if (!explicitMichiganCampus) return savedSchool(school, campus);
  const label = explicitMichiganCampus[1].replace(/\b[a-z]/g, letter => letter.toUpperCase());
  return savedSchool(school, label);
}

function schoolChoiceRank(search: WorkdaySchoolSearch, label: string): number {
  if (conflictsWithCampus(label, search.campusName)) return 0;
  const name = schoolKey(label);
  return name === search.qualified ? 2 : Number(name === search.base);
}

function isQualifiedSchoolAlternative(search: WorkdaySchoolSearch, label: string): boolean {
  return schoolKey(label).startsWith(search.base + ' ');
}

export function workdaySchoolChoice<T extends Pick<Choice, 'label'>>(search: WorkdaySchoolSearch, choices: T[]): T | undefined {
  const qualified = choices.filter(({ label }) => schoolChoiceRank(search, label) === 2);
  if (qualified.length) return qualified.length === 1 ? qualified[0] : undefined;
  if (choices.some(({ label }) => isQualifiedSchoolAlternative(search, label))) return undefined;
  const broad = choices.filter(({ label }) => schoolChoiceRank(search, label) === 1);
  return broad.length === 1 ? broad[0] : undefined;
}

function workdaySchoolKey(label: string): string {
  return schoolKey(label).replace(/^the /, '').replace(/^u of /, 'university of ').replace(/\buniv\b/g, 'university');
}

export function sameWorkdaySchoolIdentity(label: string, school: string, campus = ''): boolean {
  const search = workdaySchoolSearch(school, campus);
  if (!search) return false;
  const key = workdaySchoolKey(label);
  return key === workdaySchoolKey(search.qualified) || key === workdaySchoolKey(search.base);
}

export function selectWorkdaySchool<T extends Pick<Choice, 'label'>>(
  search: WorkdaySchoolSearch, choices: T[], qualifiedOnly = false,
): T | undefined {
  const base = workdaySchoolKey(search.base);
  const qualified = workdaySchoolKey(search.qualified);
  const alternatives = choices.map(choice => ({ choice, key: workdaySchoolKey(choice.label) }));
  const preferred = alternatives.filter(option => option.key === qualified).map(option => option.choice);
  if (preferred.length) {
    const caption = search.label.toLocaleLowerCase('en-US');
    return preferred.find(({ label }) => label.toLocaleLowerCase('en-US') === caption)
      ?? preferred.find(({ label }) => schoolKey(label).replace(/^the /, '') === qualified)
      ?? preferred[0];
  }
  if (qualifiedOnly || alternatives.some(({ key }) => key.startsWith(base + ' '))) return undefined;
  const broad = alternatives.filter(option => option.key === base).map(option => option.choice);
  return broad.find(({ label }) => schoolKey(label) === base) ?? broad[0];
}
