import { INTERPRETATION_FACTS, type InterpretationFact, type QuestionMeaning } from '../shared/interpretation';
import type { Profile } from '../shared/types';
import { countryKey, explicitCountryKey, fitKnownChoice } from './answer-formats';
import { labelText, visible, words, type Field } from './discovery';
import { applicationAnswer, semanticQuestion, type SemanticQuestion } from './semantic-options';
import { asksFirstAndLastName, asksPreferredName } from './answers';

const cues: Record<InterpretationFact, RegExp> = {
  visaSponsorship: /\b(?:sponsor(?:ship|ed|ing)?|(?:work visa|immigration) (?:support|assistance|petition))\b/,
  workAuthorization: /\b(?:work authori[sz]ation|(?:authori[sz]ed|eligible|entitled|permitted) (?:to work|for employment)|(?:right|permission) to (?:legally )?work|(?:legally|lawfully) (?:work|(?:take up|accept|start) employment)|(?:take up|accept) employment|employment (?:eligibility|authori[sz]ation|permission))\b/,
  gender: /\bgender\b/,
  disability: /\b(?:disabilit(?:y|ies)|disabled)\b/,
  veteran: /\b(?:veteran|former (?:service member|member of the (?:armed forces|military)))\b/,
  hispanicLatino: /\b(?:hispanic|latino|latina|latinx)\b/,
  raceEthnicity: /\b(?:ethnic(?:ity| background| heritage| identity| group)|racial|race)\b/,
  onsiteWork: /\b(?:on ?site|in person|(?:from|at|in) (?:the |our |an? )?offices?|office (?:work|attendance|presence|schedule)|hybrid(?: work| schedule)?)\b/,
  relocation: /\b(?:relocat(?:e|ing|ion)|mov(?:e|ing) (?:for (?:this|the) (?:role|position|job)|to\b))\b/,
  firstName: /\b(?:first|given) name\b/,
  lastName: /\b(?:(?:last|family) name|surname)\b/,
  fullName: /\b(?:(?:full|legal|complete|applicant|candidate) (?:legal )?name|name in full)\b/,
  email: /\be ?mail\b/,
  phone: /\b(?:phone|telephone|mobile|cell)\b/,
  address: /\b(?:street|mailing|residential|home) address\b|\baddress line (?:1|one)\b/,
  city: /\b(?:city|town)\b/,
  state: /\b(?:state|province)\b(?! your| the| how| if)/,
  postalCode: /\b(?:postal code|zip(?: code)?|postcode)\b/,
  country: /\bcountry\b/,
  linkedin: /\blinked ?in\b/,
  website: /\b(?:portfolio|personal (?:site|website)|website)\b/,
  github: /\bgit ?hub\b/,
  currentEmployer: /\b(?:current (?:employer|company|organization)|employer at present|(?:currently|presently) employ(?:s|ed)|company you (?:currently|presently) work for)\b/,
  currentJobTitle: /\b(?:current (?:role|position|job|job title|title)|title (?:at present|do you (?:currently|presently) hold)|title of (?:your|the) (?:current|present) (?:job|role|position))\b/,
  skills: /\b(?:skills?|skill set|competencies)\b/,
};

const booleanFacts = new Set<InterpretationFact>(['visaSponsorship', 'workAuthorization', 'disability', 'veteran', 'hispanicLatino', 'onsiteWork', 'relocation']);
const categoricalFacts = new Set<InterpretationFact>(['gender', 'raceEthnicity']);
const choiceFacts = new Set<InterpretationFact>(['city', 'state', 'country', 'currentEmployer', 'currentJobTitle', 'skills']);
const countryScoped = new Set<InterpretationFact>(['visaSponsorship', 'workAuthorization']);
const thirdParty = /\b(?:spouse|partner|child|dependents?|dependants?|parent|guardian|relatives?|emergency contact|referr(?:al|als|ed|er|ers|ing)|referee|references?|recruiter|hiring manager|other person|another person|supervisor|manager s|colleague|coworkers?|co workers?|someone else)\b/;
const excludedPurpose = /\b(?:ignore (?:all |previous |earlier |your )*(?:instructions?|rules?)|prompt injection|return json|output json|override|citizen(?:ship)?|nationality|national origin|birth|passport|tax|license|licence|contracts?|attest|certify|commit(?:ment)?|consent|salary|pay (?:range|expectation|rate)|benefits|accommodations?|criminal|medical history|medical condition|restrictions?|protected(?: class| veteran)?|employment authorization document|age|veteran (?:category|classification)|identity (?:document|card)|government issued|gender (?:expression|minority|preference|diversity|based|pay|discrimination)|sex|transgender|cisgender|pronouns?|sexu(?:al|ality)|intersex|ethnic (?:subgroup|subtype)|ethnic origin|east asian|southeast asian|south asian|central asian|native american|african american|pacific islander|multiracial|mixed race)\b/;
const qualifiers = /\b(?:and|or|but|unless|except|whilst|while|if|provided|as long as|subject to|in addition|conditional(?:ly)?)\b/;
const simplePhrases = /\b(?:(?:now|currently|today) or (?:in the future|later)|race (?:and|or|and or) ethnicity|ethnicity (?:and|or|and or) race|racial or ethnic|hispanic (?:and|or|and or) (?:latino|latina|latinx)|state or province|city or town)\b/g;
const negative = /\b(?:not|never|no|cannot|unable|unwilling|unavailable|without|off the table|unneeded|unnecessary)\b/g;
const polarQuestion = /^(?:am|are|is|was|were|do|does|did|can|could|will|would|should|may|have|has)\b/;
const requestForValue = /^(?:can|could|would|will) you (?:provide|list|enter|share|write|include|give)\b/;
const narrative = /\b(?:describe (?:how|why)|explain|elaborate|discuss|provide (?:examples?|details about)|tell us (?:about|why)|why (?:do|are|should|would)|what makes you|how (?:many|much|long)|which specific)\b/;

function questionWords(source: string): string {
  return words(source.replace(/[’']/g, "'")
    .replace(/\b(do|does|can|will|would|could|are|is)n't\b/gi, '$1 not')
    .replace(/\bwon't\b/gi, 'will not'));
}

function cleanSource(source: string): string {
  return source.trim().replace(/\s+/g, ' ');
}

function isGenericCaption(question: string): boolean {
  return /^(?:status|identification|self identification|(?:please )?(?:select|choose)(?: (?:one|an option))?|which (?:option|of the following) applies to you)$/.test(question);
}

interface Candidate {
  fact: InterpretationFact;
  source: string;
  question: string;
  country: string | null;
}

function candidate(field: Field, contextSource = ''): Candidate | undefined {
  if (!field.trustedLabel || field.blocked || field.unsupportedReason || field.section || field.kind === 'file'
    || field.resumeAlternative || asksFirstAndLastName(field) || asksPreferredName(field) || semanticQuestion(field)) return undefined;
  const label = questionWords(field.label);
  const context = questionWords(contextSource);
  const surrounding = questionWords(field.context);
  const useContext = isGenericCaption(label);
  const source = useContext ? contextSource : field.label;
  const question = useContext ? context : label;
  if (!question || question.length > 500 || narrative.test(question) || qualifiers.test(question.replace(simplePhrases, ''))
    || thirdParty.test([label, surrounding, ...field.metadata.map(words)].join(' '))
    || excludedPurpose.test(label) || excludedPurpose.test(surrounding)) return undefined;

  const matches = INTERPRETATION_FACTS.filter(fact => cues[fact].test(question));
  // An employment question with sponsorship wording is not a work authorization assertion.
  if (matches.length !== 1) return undefined;
  const [fact] = matches;
  if (field.multiple && !(field.kind === 'select' && fact === 'skills')) return undefined;
  if (field.kind === 'checkbox' && !booleanFacts.has(fact)) return undefined;
  if (field.kind === 'radio' && !booleanFacts.has(fact) && !categoricalFacts.has(fact)) return undefined;
  if ((field.kind === 'select' || field.kind === 'combobox') && !booleanFacts.has(fact) && !categoricalFacts.has(fact) && !choiceFacts.has(fact)) return undefined;
  if (!supportedWording(fact, question)) return undefined;
  const country = countryScoped.has(fact) ? jurisdiction(source, question) : null;
  if (country === undefined || (fact === 'workAuthorization' && country === null)) return undefined;

  return { fact, source, question, country };
}

function supportedWording(fact: InterpretationFact, question: string): boolean {
  if (booleanFacts.has(fact)) {
    if (/^(?:what|which|who|when|where|why|how)\b/.test(question)
      || /\b(?:like|want|choose|prefer) to (?:disclose|report|share|identify)\b/.test(question)) return false;
  } else if (polarQuestion.test(question) && !requestForValue.test(question)) return false;

  switch (fact) {
    case 'visaSponsorship':
      return /\b(?:need|require|seek|necessary|unnecessary|unneeded|required|needed)\b/.test(question)
        && !/\b(?:obtain|secure|transfer|currently sponsored|who is|sponsorship (?:type|status|duration))\b/.test(question);
    case 'workAuthorization':
      return !/\b(?:sponsor(?:ship|ed|ing)?|work permit (?:type|number|expiry)|future approval|in the future|indefinitely|full time|part time|hours? (?:a|per) week|with this employer|for this employer)\b/.test(question)
        && (!/\b(?:take up|accept) employment\b/.test(question) || /\b(?:legally|lawfully|permission|authori[sz]ation|eligible|eligibility)\b/.test(question));
    case 'onsiteWork':
    case 'relocation':
      return !/\b(?:require|needs?|requirement|assistance|reimbursement|travel|overtime|weekends?|holidays?|shifts?|expense|costs?|unreimbursed|overnight|immediately|start (?:on|next|this|by)|by (?:next|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|remote(?:ly)?|work from home|schedule (?:your|a)|how (?:often|soon)|when|where)\b/.test(question);
    case 'raceEthnicity':
      return /\b(?:racial|ethnic(?:ity)?|race (?:category|identity|background|group)|(?:your|applicant) race)\b/.test(question);
    case 'country':
      return /\b(?:resid(?:e|ence|ential)|live|living|locat(?:ed|ion)|mailing|address|currently based)\b/.test(question);
    case 'city':
    case 'state':
      return !/\b(?:previous|former|prior|born|grew up|attended|desired|preferred)\b/.test(question);
    case 'currentEmployer':
    case 'currentJobTitle':
      return !/\b(?:desired|preferred|ideal|apply(?:ing)?|application|seeking|interested in|leave|quit|previous|past|last job)\b/.test(question);
    case 'disability':
      return !/\b(?:type of|needs?|require|support|adjustments?|assistance|specific|severe|severity|duration|details|documentation)\b/.test(question);
    case 'veteran':
      return !/\b(?:army|navy|air force|marine corps|coast guard|space force|combat|medal|reserve|national guard|discharge|domestic service|recently separated|wartime|military campaign|active duty)\b/.test(question);
    case 'phone':
      return !/\b(?:extension|country code|dialing code|dialling code|area code|phone type|text messages)\b/.test(question);
    case 'address':
      return !/\b(?:previous|business|employer|second|2|two|apartment|unit)\b/.test(question);
    case 'email':
      return !/\b(?:work email|business email|company email|alternate|alternative|secondary|confirm|verify|notification preference)\b/.test(question);
    case 'skills':
      return /^(?:(?:please )?(?:list|enter|provide|share)\b|(?:your )?(?:current |professional |technical )?(?:skills|skill set|competencies)(?: summary| list)?$|what (?:are )?(?:your|skills do you have)\b)/.test(question)
        && !/\b(?:for this role|required|relevant|specific|strongest|top|only)\b/.test(question);
    default:
      return true;
  }
}

const dynamicContext = 'input, textarea, select, button, output, [contenteditable], [aria-live], [role="status"], [role="option"], [role="combobox"]';
const apparentPrivateText = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:current|selected|entered|previous) value\s*:/i;

function staticCaption(element: Element | null): string {
  return element && visible(element) && !element.matches(dynamicContext) && !element.querySelector(dynamicContext) ? labelText(element) : '';
}

function references(element: Element, attribute: string): string[] {
  const root = element.getRootNode() as Document | ShadowRoot;
  return (element.getAttribute(attribute) ?? '').trim().split(/\s+/).filter(Boolean)
    .map(id => staticCaption(root.getElementById(id)));
}

function containsPrivateText(text: string, currentValues: Set<string>): boolean {
  if (apparentPrivateText.test(text)) return true;
  const caption = ' ' + words(text) + ' ';
  return [...currentValues].some(value => caption.includes(' ' + value + ' '));
}

/** Only associated static text can be used as provider context. */
export function interpretationContext(field: Field, currentValues: Set<string>): string | undefined {
  const contexts = references(field.element, 'aria-describedby');
  for (let parent = field.element.parentElement; parent && !parent.matches('form, main, body'); parent = parent.parentElement) {
    if (!parent.matches('fieldset, [role="group"], [role="radiogroup"], section, [role="region"]') || !visible(parent)) continue;
    contexts.push(...references(parent, 'aria-labelledby'), parent.getAttribute('aria-label') ?? '',
      staticCaption(parent.querySelector(':scope > :is(legend, h1, h2, h3, h4, h5, h6, [role="heading"], .application-label)')));
  }
  const safe = [...new Set(contexts.map(cleanSource))].filter(context => context && context !== field.label
    && !containsPrivateText(context, currentValues)).join(' ');
  return safe && safe.length <= 600 ? safe : undefined;
}

export function eligibleForInterpretation(field: Field, currentValues: Set<string>, context?: string): boolean {
  if (!candidate(field, context) || containsPrivateText(field.label, currentValues)) return false;
  return !field.choices.some(choice => containsPrivateText(choice.label, currentValues));
}

function containsCountry(source: string): boolean {
  const tokens = words(source).split(' ');
  for (let start = 0; start < tokens.length; start++) {
    for (let length = 1; length <= 8 && start + length <= tokens.length; length++) {
      const text = tokens.slice(start, start + length).join(' ');
      if (explicitCountryKey(text) && (text !== 'us' || /\bUS\b/.test(source))) return true;
    }
  }
  return false;
}

/** A country elsewhere in the label or in help text does not establish the question's jurisdiction. */
function jurisdiction(source: string, question: string): string | null | undefined {
  const employerPronoun = /\bfor us(?: (?:now|today|at present))?[.?*!\s]*$/.test(source);
  const phrasing = employerPronoun ? question.replace(/\bfor us\b/, '') : question;
  const unqualified = phrasing
    .replace(/\b(?:in the future|in this (?:role|job|position)|for (?:this|the) (?:role|job|position)|for (?:you|me|employment|(?:an? )?(?:work )?visa(?: status)?|immigration|work authori[sz]ation)|without additional permission)\b/g, '')
    .replace(/\b(?:now or later|currently|at present|today|now)$/, '').trim();
  const scope = /\b(in|within|across|outside|throughout|for|from) (.+)$/.exec(unqualified);
  if (scope) {
    if (/^(?:the )?us$/.test(scope[2]) && !/\bUS\b/.test(source)) return undefined;
    return /^(?:in|within|for)$/.test(scope[1]) ? explicitCountryKey(scope[2]) : undefined;
  }
  return /\b(?:another country|abroad|here|overseas)\b/.test(unqualified) || containsCountry(source) ? undefined : null;
}

function validPolarity(fact: InterpretationFact, question: string, inverse: boolean): boolean {
  if (typeof inverse !== 'boolean') return false;
  // Possessing authority without additional permission is an affirmative authorization question.
  const wording = fact === 'workAuthorization' ? question.replace(/\bwithout additional permission\b/, '') : question;
  const negations = [...wording.matchAll(negative)].map(match => match[0]);
  if (!booleanFacts.has(fact)) return !inverse && !negations.length;
  if (negations.includes('without')) return false;
  return negations.length < 2 && inverse === (negations.length === 1);
}

interface GroundedAnswer {
  answer: string | boolean;
  semantic: SemanticQuestion | 'visible';
}

export function groundInterpretation(field: Field, profile: Profile, meaning: QuestionMeaning, context?: string): GroundedAnswer | undefined {
  const match = candidate(field, context);
  if (!match || !meaning || match.fact !== meaning.fact || meaning.confidence !== 'high' || typeof meaning.evidence !== 'string') return undefined;
  const { fact, source, question, country } = match;
  const caption = cleanSource(source);
  const evidence = cleanSource(meaning.evidence);
  if (!evidence || !cues[fact].test(questionWords(evidence)) || !caption.includes(evidence)
    || !validPolarity(fact, question, meaning.inverse)) return undefined;
  const reportedCountry = meaning.country;
  if (country === null ? reportedCountry !== null
    : typeof reportedCountry !== 'string' || explicitCountryKey(reportedCountry) !== country || !caption.includes(reportedCountry)
      || (/^(?:the )?us$/i.test(reportedCountry) && !/\bUS\b/.test(reportedCountry))) return undefined;

  if ((fact === 'visaSponsorship' || fact === 'workAuthorization') && country && reportedCountry) {
    const key = fact === 'workAuthorization' ? 'authorized' : 'sponsorshipRequired';
    const values = new Set((profile.workAuthorizations ?? []).filter(fact => countryKey(fact.country) === country)
      .map(fact => fact[key]).filter((value): value is boolean => typeof value === 'boolean'));
    if (values.size > 1) return undefined;
    const value = values.values().next().value;
    if (value !== undefined) {
      return { answer: value !== meaning.inverse, semantic: { topic: fact, inverse: meaning.inverse, location: reportedCountry, proposition: true } };
    }
  }
  if (fact === 'workAuthorization') return undefined;

  switch (fact) {
    case 'visaSponsorship': case 'gender': case 'disability': case 'veteran': case 'hispanicLatino':
    case 'raceEthnicity': case 'onsiteWork': case 'relocation': {
      if (!profile.applicationDefaults) return undefined;
      const semantic: SemanticQuestion = {
        topic: fact, inverse: meaning.inverse, location: meaning.country ?? undefined, proposition: booleanFacts.has(fact),
      };
      const answer = applicationAnswer(field, profile.applicationDefaults, semantic);
      return answer === undefined ? undefined : { answer, semantic };
    }
    default: {
      const answer = personalFact(field, profile, fact);
      return answer?.trim() ? { answer, semantic: 'visible' } : undefined;
    }
  }
}

type PersonalFact = Exclude<InterpretationFact, keyof NonNullable<Profile['applicationDefaults']> | 'workAuthorization'>;

function personalFact(field: Field, profile: Profile, fact: PersonalFact): string | undefined {
  const { personal } = profile;
  switch (fact) {
    case 'fullName':
      if (!personal.firstName.trim() || !personal.lastName.trim()) return undefined;
      return [personal.firstName, personal.middleName, personal.lastName].filter(Boolean).join(' ');
    case 'country':
      return fitKnownChoice(field, personal.country, countryKey);
    case 'currentEmployer': case 'currentJobTitle': {
      const current = profile.employment.filter(job => job.current);
      return current.length === 1 ? current[0][fact === 'currentEmployer' ? 'company' : 'title'] : undefined;
    }
    case 'skills':
      return profile.skills?.join(field.element.matches('input') && !field.multiple ? ', ' : '\n');
    default:
      return personal[fact];
  }
}
