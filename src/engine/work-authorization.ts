import type { WorkAuthorization } from '../shared/types';
import { countryKey, explicitCountryKey, isPostalRegion } from './answer-formats';
import { labelText, visible, words } from './discovery';
import { workdayJobCountry } from './workday-job-context';

type AuthorizationFact = 'authorized' | 'fullTimeAuthorized';
type AuthorizationRecord = WorkAuthorization & { fullTimeAuthorized?: boolean };

interface AuthorizationAnswer {
  fact: AuthorizationFact;
  country?: string;
  answer?: boolean;
  conflict?: true;
}

const authorizationVerb = /^(?:are you (?:currently )?(?:(?:legally|lawfully) )?(?:authorized|authorised|eligible|entitled|permitted|allowed) to (?:work|be employed)|do you (?:currently )?have (?:the )?(?:legal )?right to work) (?:(full time|on a full time basis) )?(?:in|within) (.+)$/;
const authorizationNoun = /^do you (?:currently )?have (?:the )?(?:legal )?(?:work authori[sz]ation|authori[sz]ation to work) (?:in|within|for) (.+)$/;
const fullTimeSuffix = /^(.+) (?:on a full time basis|for full time employment|full time)$/;
const applyingCountry = /^(?:this country|the country (?:for which you (?:(?:are|re) applying|applied)|you (?:are|re) applying (?:to|for|in)|where this (?:role|job|position) is (?:located|based)))$/;

function namedCountry(value: string, source = value): string | undefined {
  // Lowercase "us" can refer to the employer, while the abbreviation names the country.
  if (/^(?:the )?us$/.test(words(value)) && !/\bUS\b/.test(source)) return undefined;
  return explicitCountryKey(value);
}

function countryFromLocation(location: string): string | undefined {
  const country = namedCountry(location);
  if (country) return country;

  const parts = location.split(',').map(part => part.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !words(part))) return undefined;
  const [city, region] = parts.map(words);
  const destination = namedCountry(parts.at(-1)!);
  if (city === 'washington' && /^(?:dc|d c|district of columbia)$/.test(region)) {
    return parts.length === 2 || destination === 'US' ? 'US' : undefined;
  }

  // A postal region such as NY or ON can establish the country when the code
  // is not also a country code. CA/DE/MA and other ambiguous codes need more evidence.
  if (parts.length === 2 && /^[\p{L}\p{M} .’'-]+$/u.test(parts[0])
    && /^[A-Z]{2}$/.test(parts[1]) && !namedCountry(parts[0]) && !/\b(?:and|or)\b/.test(city)
    && !countryKey(parts[1])) {
    const countries = ['US', 'CA'].filter(country => isPostalRegion(parts[1], country));
    if (countries.length === 1) return countries[0];
  }

  if (!destination || parts.slice(0, -1).some(part => namedCountry(part) || /\b(?:and|or)\b/.test(words(part)))) return undefined;
  return destination;
}

function postingCountry(location: string): string | undefined {
  if (!location || location.length > 160 || /[;\/|\r\n]/.test(location)) return undefined;
  const entries = location.split('•').map(entry => entry.trim());
  if (entries.length === 1) return countryFromLocation(entries[0]);

  // A country label can qualify city/region entries in the same posting header.
  const countryLabel = namedCountry(entries.at(-1)!);
  const country = countryLabel ?? countryFromLocation(entries[0]);
  if (!country) return undefined;
  const matches = entries.every(entry => {
    const explicit = countryFromLocation(entry);
    if (explicit) return explicit === country;
    if (!countryLabel) return false;
    const cityRegion = /^([\p{L}\p{M} .’'-]+),\s*([A-Z]{2})$/u.exec(entry);
    return !!cityRegion && !!words(cityRegion[1]) && !namedCountry(cityRegion[1])
      && !/\b(?:and|or)\b/.test(words(cityRegion[1])) && isPostalRegion(cityRegion[2], country);
  });
  return matches ? country : undefined;
}

function staticPostingLocation(locations: NodeListOf<Element>): string | undefined {
  if (locations.length !== 1) return undefined;
  const location = locations[0];
  const dynamic = 'input, textarea, select, button, [contenteditable]';
  if (!visible(location) || location.matches(dynamic) || location.querySelector(dynamic)) return undefined;
  if ([...location.querySelectorAll('*')].some(element => !visible(element) && labelText(element))) return undefined;
  return labelText(location) || undefined;
}

/** Read the location from the known static Lever posting header. */
export function leverPostingLocation(element: Element): string | undefined {
  const doc = element.ownerDocument;
  if (doc.location?.hostname !== 'jobs.lever.co' || !element.closest('form#application-form')) return undefined;
  return staticPostingLocation(doc.querySelectorAll('.posting-header > .posting-categories > .location'));
}

/** Scope the location to the posting container that owns the application form. */
export function applicationPostingLocation(element: Element): string | undefined {
  const doc = element.ownerDocument;
  const workday = workdayJobCountry(element);
  if (workday) return workday;
  if (doc.location?.hostname === 'jobs.lever.co') return leverPostingLocation(element);
  if (doc.location?.origin !== 'https://job-boards.greenhouse.io'
    || !/^\/[^/]+\/jobs\/\d+\/?$/.test(doc.location.pathname)) return undefined;
  const form = element.closest('form');
  if (!form?.matches('form#application-form.application--form')) return undefined;
  const posting = form.closest('main.job-post > .job-post-container');
  if (!posting || posting.querySelectorAll('form#application-form').length !== 1) return undefined;
  return staticPostingLocation(posting.querySelectorAll('.job__header > .job__title > .job__location'));
}

/** `jobLocation` must come from the posting's own location field. */
export function answerWorkAuthorization(
  label: string, records: readonly AuthorizationRecord[] = [], jobLocation?: string,
): AuthorizationAnswer | undefined {
  const question = words(label);
  const verb = authorizationVerb.exec(question);
  const scope = verb?.[2] ?? authorizationNoun.exec(question)?.[1];
  if (!scope) return undefined;
  const suffix = fullTimeSuffix.exec(scope);
  const jurisdiction = suffix?.[1] ?? scope;
  const fact = verb?.[1] || suffix ? 'fullTimeAuthorized' : 'authorized';
  const relative = applyingCountry.test(jurisdiction);
  const country = relative ? postingCountry(jobLocation ?? '') : namedCountry(jurisdiction, label);
  if (!country) return relative ? { fact } : undefined;

  const authorized = new Set<boolean>();
  const fullTime = new Set<boolean>();
  for (const record of records) {
    if (countryKey(record.country) !== country) continue;
    if (typeof record.authorized === 'boolean') authorized.add(record.authorized);
    if (typeof record.fullTimeAuthorized === 'boolean') fullTime.add(record.fullTimeAuthorized);
  }
  if (authorized.size > 1 || fullTime.size > 1 || (authorized.has(false) && fullTime.has(true))) {
    return { fact, country, conflict: true };
  }
  const answer = (fact === 'fullTimeAuthorized' ? fullTime : authorized).values().next().value;
  return answer === undefined ? { fact, country } : { fact, country, answer };
}
