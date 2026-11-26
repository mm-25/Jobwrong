import { normalize, words, type Choice, type Field } from './discovery';

type OptionKey = (value: string) => string | undefined;

export function fitKnownChoice(field: Field, value: string, keyOf: OptionKey, useOptionValues = false): string | undefined {
  if (!field.choices.length) return value;
  const target = keyOf(value);
  if (!target) return value;

  const choices = field.choices.filter((choice) =>
    (keyOf(choice.label) ?? (useOptionValues ? keyOf(choice.value) : undefined)) === target);
  return uniqueChoiceToken(field, choices);
}

function uniqueChoiceToken(field: Field, matches: Choice[]): string | undefined {
  if (matches.length !== 1) return undefined;
  const [choice] = matches;
  return [choice.label, choice.value].find((token) => {
    const key = normalize(token);
    return !!key && field.choices.filter((option) => normalize(option.label) === key || normalize(option.value) === key).length === 1;
  });
}

const regionNames = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
const canonicalRegion = (code: string): string => new Intl.Locale('en-' + code).region ?? code;
const countries = new Map<string, string>();
for (const first of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  for (const last of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const code = first + last;
    const name = regionNames.of(code);
    if (name) countries.set(words(name), canonicalRegion(code));
  }
}
for (const [label, country] of [
  ['us', 'US'], ['u s', 'US'], ['usa', 'US'], ['u s a', 'US'], ['united states of america', 'US'],
  ['uk', 'GB'], ['u k', 'GB'], ['great britain', 'GB'], ['britain', 'GB'],
]) countries.set(label, country);

export function countryKey(value: string): string | undefined {
  const name = words(value).replace(/^the /, '');
  const code = name.toUpperCase();
  return countries.get(name) ?? (/^[A-Z]{2}$/.test(code) && regionNames.of(code) ? canonicalRegion(code) : undefined);
}

export function explicitCountryKey(value: string): string | undefined {
  const name = words(value).replace(/^the /, '');
  // Short codes like CA can describe a state. Georgia can describe either location.
  if (/^[a-z]{2}$/.test(name) && name !== 'us' && name !== 'uk') return undefined;
  if (name === 'georgia' || name === 'great britain' || name === 'britain') return undefined;
  const country = countryKey(name);
  return country === 'EU' || country === 'UN' || country === 'ZZ' ? undefined : country;
}

const regions = {
  US: {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
    CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii',
    ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
    MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
    NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
    OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
    SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
    UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
    WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  },
  CA: {
    AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
    NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut',
    ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan',
    YT: 'Yukon',
  },
};

export function formatRegion(field: Field, state: string, country: string): string | undefined {
  const code = countryKey(country);
  if ((code !== 'US' && code !== 'CA') || !field.choices.length) return state;
  const entries = Object.entries(regions[code]);
  return fitKnownChoice(field, state, (value) => {
    const key = words(value);
    return entries.find(([region, name]) => key === words(region) || key === words(name))?.[0];
  }, true);
}

const degrees = [
  ['ba', 'b a', 'bachelor of arts'],
  ['bs', 'b s', 'bsc', 'b sc', 'bachelor of science'],
  ['bfa', 'b f a', 'bachelor of fine arts'],
  ['beng', 'b eng', 'be', 'b e', 'bachelor of engineering'],
  ['ma', 'm a', 'master of arts'],
  ['ms', 'm s', 'msc', 'm sc', 'master of science'],
  ['mfa', 'm f a', 'master of fine arts'],
  ['mba', 'm b a', 'master of business administration'],
  ['meng', 'm eng', 'me', 'm e', 'master of engineering'],
  ['phd', 'ph d', 'doctor of philosophy'],
];

function literalDegreeKey(value: string): string | undefined {
  return degrees.find((aliases) => aliases.includes(words(value)))?.[0];
}

export function degreeKey(value: string): string | undefined {
  const literal = literalDegreeKey(value);
  if (literal) return literal;
  const annotated = /^(.+?)\s*\(([^()]+)\)$/.exec(value.trim());
  if (!annotated) return undefined;
  const fullName = literalDegreeKey(annotated[1]);
  return fullName && literalDegreeKey(annotated[2]) === fullName ? fullName : undefined;
}

const bachelorLevel = /^(?:bachelor|bachelors|bachelor s)(?: degree)?$/;
const masterLevel = /^(?:master|masters|master s)(?: degree)?$/;
const bachelorAward = /^bachelor of [\p{L}][\p{L}\p{N}'’ -]*$/iu;
const masterAward = /^master of [\p{L}][\p{L}\p{N}'’ -]*$/iu;
const bachelors = ['ba', 'bs', 'bfa', 'beng'];
const masters = ['ma', 'ms', 'mfa', 'mba', 'meng'];

function savedDegree(value: string) {
  const source = value.trim();
  const qualified = /^(.+?)\s+in\s+[^;/()]+(?:\s*\([^()/;]+\))?$/i.exec(source)
    ?? /^(.+?)\s*\([^()/;]+\)$/.exec(source);
  const stem = qualified?.[1] ?? source;
  const degree = degreeKey(stem);
  const annotation = literalDegreeKey(/\(([^()]+)\)$/.exec(source)?.[1] ?? '');
  if (annotation && annotation !== degree) return undefined;
  const award = bachelorAward.test(stem) || masterAward.test(stem);
  const level = (degree && bachelors.includes(degree)) || bachelorLevel.test(words(stem)) || bachelorAward.test(stem) ? bachelorLevel
    : (degree && masters.includes(degree)) || masterLevel.test(words(stem)) || masterAward.test(stem) ? masterLevel : undefined;
  // Only bachelor and master awards support a subject qualifier.
  return level ? { degree, stem, level, award } : { degree: degreeKey(value) };
}

export function degreeRecordCompatible(observed: string, saved: string): boolean {
  const label = normalize(observed);
  if (!label || !normalize(saved)) return false;
  if (label === normalize(saved)) return true;
  const current = savedDegree(observed);
  const record = savedDegree(saved);
  if (!current || !record) return false;
  if (current.degree && current.degree === record.degree) return true;
  if (!current.level || current.level !== record.level) return false;
  if (current.award && record.award && normalize(current.stem!) === normalize(record.stem!)) return true;
  return (!current.degree && !current.award) || (!record.degree && !record.award);
}

export function formatDegree(field: Field, value: string): string | undefined {
  if (!field.choices.length) return value;

  const literal = field.choices.filter(({ label }) => normalize(label) === normalize(value));
  if (literal.length) return uniqueChoiceToken(field, literal);

  const saved = savedDegree(value);
  if (!saved) return undefined;
  const { degree, level, award, stem } = saved;
  const specific = degree ? field.choices.filter(({ label }) => degreeKey(label) === degree)
    : award && stem ? field.choices.filter(({ label }) => normalize(label) === normalize(stem)) : [];
  if (specific.length) return uniqueChoiceToken(field, specific);

  return level ? uniqueChoiceToken(field, field.choices.filter(({ label }) => level.test(words(label)))) : degree ? undefined : value;
}

export function phoneCountryOption(value: string): { name: string; code: string } | undefined {
  const match = /^(.+?)\s*(?:\(\s*\+\s*([1-9]\d{0,3})\s*\)|\+\s*([1-9]\d{0,3}))$/.exec(value.trim());
  return match ? { name: match[1].trim(), code: match[2] ?? match[3] } : undefined;
}

export function formatPhoneCountry(field: Field, country: string, phone: string, savedCallingCode = ''): string | undefined {
  const labeledCode = phoneCountryOption(savedCallingCode);
  const countryName = labeledCode?.name ?? country;
  const countryId = countryKey(countryName);
  const savedCode = labeledCode?.code ?? /^\+?([1-9]\d{0,3})$/.exec(savedCallingCode.trim())?.[1];
  const number = phone.trim().replace(/[\s().-]/g, '');
  const international = /^(?:\+|00)/.test(number);
  const digits = /^(?:\+|00)([1-9]\d{6,14})$/.exec(number)?.[1];
  const localNumber = !international && /^\d{6,15}$/.test(number);
  if (!countryId || (!savedCode && !digits && (!localNumber || /^(?:EU|UN|ZZ)$/.test(countryId)))
    || (savedCallingCode.trim() && !savedCode)
    || (international && !digits)
    || (savedCode && digits && !digits.startsWith(savedCode))) return undefined;
  if (!field.choices.length) return savedCode || digits || field.kind === 'combobox' ? countryName : undefined;

  const options = field.choices.flatMap(choice => {
    const option = phoneCountryOption(choice.label);
    const optionCountry = option && countryKey(option.name);
    return option && optionCountry ? [{ choice, code: option.code, country: optionCountry }] : [];
  });
  // Some menus list more specific prefixes for countries that share a calling code.
  const observedCode = options.reduce((longest, option) => digits?.startsWith(option.code) && option.code.length > longest.length
    ? option.code : longest, '');
  if (savedCode && observedCode && savedCode !== observedCode) return undefined;
  const code = savedCode ?? (digits ? observedCode : undefined);
  return uniqueChoiceToken(field, options.filter(option =>
    option.country === countryId && (code === undefined || option.code === code)).map(option => option.choice));
}

export function formatDialCode(field: Field, value: string, country: string): string | undefined {
  const dial = (source: string) => source.match(/\+\s*(\d{1,4})\b|^\s*(\d{1,4})\s*$/)?.slice(1).find(Boolean);
  const code = dial(value);
  if (!code) return value;
  if (!field.choices.length) {
    if (field.element.matches('input[type="number"]')) return code;
    return /^\s*\+?\s*\d+\s*$/.test(value) ? value : '+' + code;
  }
  const countryForDialLabel = (label: string) => countryKey(label.replace(/\(?\+\s*\d{1,4}\)?/g, ''));
  const preferredCountry = countryForDialLabel(value) ?? countryKey(country);
  const matches = field.choices.filter(({ label }) => {
    if (dial(label) !== code) return false;
    const optionCountry = countryForDialLabel(label);
    return !preferredCountry || !optionCountry || optionCountry === preferredCountry;
  });
  return uniqueChoiceToken(field, matches);
}

const months = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
];

function monthKey(value: string): string | undefined {
  const numeric = normalize(value);
  if (/^\d{1,2}$/.test(numeric) && +numeric >= 1 && +numeric <= 12) return String(+numeric);
  const text = words(value);
  const index = months.findIndex((month) => text === month || text === month.slice(0, 3));
  return index >= 0 ? String(index + 1) : text === 'sept' ? '9' : undefined;
}

type DatePart = 'month' | 'year';

export function formatDate(field: Field, value: string, part?: DatePart): string | undefined {
  const type = field.element.getAttribute('type');
  if (!part && type !== 'date' && type !== 'month') return value;

  const normalized = value.trim();
  const iso = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(normalized);
  const english = /^([a-zA-Z]+)\.?\s+(\d{4})$/.exec(normalized);
  const year = iso?.[1] ?? english?.[2];
  const month = monthKey(iso?.[2] ?? english?.[1] ?? '');
  if (!year || year === '0000' || (!month && (iso?.[2] || english))) return undefined;
  if (part === 'year') return fitKnownChoice(field, year, (label) => /^\d{4}$/.test(label.trim()) ? label.trim() : undefined);
  if (!month) return undefined;
  const padded = month.padStart(2, '0');
  if (part === 'month') {
    if (!field.choices.length) return type === 'number' ? month : padded;
    const hasZeroLabel = field.choices.some(({ label }) => /^0+$/.test(label.trim()));
    return uniqueChoiceToken(field, field.choices.filter(({ label }) =>
      monthKey(label) === month && !(hasZeroLabel && /^\d+$/.test(label.trim()))));
  }
  const yearMonth = year + '-' + padded;
  return type === 'month' ? yearMonth : iso?.[3] ? yearMonth + '-' + iso[3] : undefined;
}
