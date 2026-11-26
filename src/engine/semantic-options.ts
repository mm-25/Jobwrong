import type { ApplicationDefaults } from '../shared/types';
import { explicitCountryKey } from './answer-formats';
import { normalize, words, type Choice, type Field } from './discovery';
import { usesNestedOptions } from './nested-options';

type SemanticField = Pick<Field, 'label'> & Partial<Pick<Field, 'context' | 'element' | 'kind'>>;
type Topic = Exclude<keyof ApplicationDefaults, 'acceptApplicationPrivacy'>;
type Status = 'yes' | 'no';
type Option = Status | 'decline' | 'male' | 'female' | 'nonbinary';
type Question = {
  topic: Topic;
  inverse?: boolean;
  protectedVeteran?: boolean;
  location?: string;
  proposition?: boolean;
  unlessLocatedIn?: string;
  acknowledgment?: true;
  relocationRadius?: string;
  affirmativeOnly?: true;
};
export type SemanticQuestion = Question | { topic: 'workAuthorization'; inverse: boolean; location: string; proposition: true };
export type SemanticMatching = boolean | SemanticQuestion | 'visible';

const genderQuestion = /^(?:(?:please )?(?:select|indicate|specify) (?:your )?|what is your |your )?gender(?: identity)?(?: identification)?$/;
const genderIdentityQuestion = /^(?:what gender do you identify (?:as|with)|how (?:do|would) you (?:identify|describe) your gender(?: identity)?|(?:please )?(?:select|choose) the gender (?:that )?(?:best )?describes you)$/;
const raceLabel = '(?:race(?: (?:and|or|and or) ethnicity| ethnicity)?|ethnicity(?: (?:and|or) race)?|racial(?: (?:or|and))? ethnic (?:identity|background))';
const raceQuestion = new RegExp('^(?:(?:please )?(?:select|indicate|identify|specify|choose) (?:your )?|what is your |your )?' + raceLabel + '$');
const raceIdentityQuestion = new RegExp(
  '^(?:(?:how (?:do|would) you (?:identify|describe)|which of the following (?:best )?(?:describes|represents)) your ' + raceLabel
  + '|(?:please )?select (?:one or more|all applicable) races|if you are not hispanic or latino (?:please )?(?:select|indicate|identify) your race)$',
);
const broadAsianDefinition = /^asian (?:a person|individuals?|people|persons?) (?:having|with) origins? in (?:any of )?(?:the )?original peoples? of (?:the )?(?:far east|(?:central (?:or |and )?)?east asia) (?:and )?southeast asia (?:and|or) (?:the )?(?:indian subcontinent|south asia)(?: (?:including|for example|such as) .+)?$/;
const declineOption = /^(?:(?:i )?(?:(?:would )?prefer not|choose not|wish not|do not wish|do not want|decline) to (?:answer(?: this question)?|respond|state|say|disclose|self identify|identify)|(?:i would )?rather not say|do not disclose|decline|not disclosed)$/;
const genderOptions: Record<string, Option> = {
  male: 'male', man: 'male', m: 'male', 'male man': 'male',
  female: 'female', woman: 'female', f: 'female', 'female woman': 'female',
  nonbinary: 'nonbinary', 'non binary': 'nonbinary',
};

const hispanicLatino = '(?:hispanic(?: or latino(?: latina| latinx)?| and(?: or)? latino(?: latina| latinx)?| latino(?: latina| latinx)?)?|latin[oa]|latinx)(?: or latinx| or latina)?';
const veteran = '(?:a |an )?(protected )?(?:military |u s |us )?veteran';
const disability = '(?:a |any )?disabilit(?:y|ies)';
const sponsorship = '(?:(?:employer|employment|work visa|visa|work permit|immigration) )?sponsorship';
const interval = '(?:now or in the future|currently or in the future|now or later|at any time|in the future|ever|now)';
const visaSubject = '(?:(?:will|would|do) you(?: ' + interval + ')?|do you now or will you(?: in the future)?|i(?: will| would| currently)?)';
const sponsorshipTail = '(?:(?: for (?:employment|(?:an? )?(?:(?:work|employment) )?visa|employment visa status|work authorization)| to (?:(?:legally )?work|be employed|begin or continue (?:employment|working)))?(?:(?: in| for) (.+))?)';
const latinIdentity = new RegExp('^(not )?' + hispanicLatino + '(?: (?:origin|descent|ethnicity|status))?$');
const disabilityHistory = '(?:(?: or (?:have )?(?:had|previously had) (?:one|a disability)(?: in the past)?)|(?: and (?:have )?(?:not|never) had (?:one|a disability)(?: in the past)?))?';

const visaQuestion = new RegExp(
  '^' + visaSubject + ' '
  + '(?:(do not|will not|would not|never|not) )?(?:require|need|seek)(?: ' + interval + ')? '
  + '(?:an? )?' + sponsorship + '(?: ' + interval + ')?' + sponsorshipTail + '$',
);
const sponsoredVisaQuestion = /^(?:(?:do|will|would) you|i) (do not |not )?need (?:an|the|your|our|this) (?:employer|company) to sponsor (?:your|my|an?|the) (?:work |employment )?visa$/;
const namedEmployerVisaQuestion = new RegExp(
  '^' + visaSubject + ' (?:(do not|will not|would not|never|not) )?need (?:[\\p{L}\\p{N}]+ ){1,8}'
  + 'to sponsor (?:you|me) for (?:an? )?(?:work |employment )?visa(?: to (?:legally )?work)?(?: in (.+))?$',
  'u',
);
const inverseVisaQuestion = new RegExp(
  '^(?:(?:can|will) you|i can|are you able to) (?:(?:legally )?work|be employed)(?:(?: here)| in (.+?))? without (?:requiring |needing )?' + sponsorship
  + '(?: (?:now or in the future|now or later))?(?: in (.+))?$',
);
const directVisaQuestion = new RegExp('^' + sponsorship + '(?: (required|needed))?(?: ' + interval + ')?$');
const negativeVisaStatus = new RegExp('^(?:' + sponsorship + ' not (?:required|needed)|no ' + sponsorship + ' (?:required|needed))$');
const negativeVeteranStatus = new RegExp('^(?:not ' + veteran + '|non veteran)$');
const veteranQuestion = new RegExp('^(?:are you |i am |do you (?:self )?identify as |i (?:self )?identify as )(not )?' + veteran + '$');
const negativeVeteranIdentification = new RegExp('^(?:do you not|i do not) (?:self )?identify as ' + veteran + '$');
const hispanicQuestion = new RegExp(
  '^(?:are you |i am |do you (?:self )?identify as |i (?:self )?identify as )(not )?(?:of )?' + hispanicLatino + '(?: (?:origin|descent|ethnicity))?$',
);
const disabilityQuestion = new RegExp(
  '^(?:(?:do you|i) (do not |not )?have (?:or have you (?:ever )?had )?' + disability + disabilityHistory
  + '|(?:are you|i am) (not )?(?:disabled|a person with (?:a )?disability)|(?:do you|i) (do not |not )?identify as (?:a person with (?:a )?disability|disabled))$',
);

const visaType = '(?:H[- ]?1B|O[- ]?1|TN|E[- ]?3|F[- ]?1(?: OPT)?)';
const visaExamples = new RegExp('\\s*\\((?:e\\.?g\\.?|for example|such as)[, ]+' + visaType + '(?:\\s*[,;/]\\s*' + visaType
  + ')*(?: visa(?: status)?)?(?:\\s*,?\\s*etc\\.?)?\\)\\s*[?*]*$', 'i');

function semanticWords(text: string): string {
  return words(text.replace(/[’']/g, "'")
    .replace(/\b(does|do|did|can|could|is|are|was|were|should|would|must)n't\b/gi, '$1 not')
    .replace(/\bwon't\b/gi, 'will not')
    .replace(/\bi'm\b/gi, 'I am')
    .replace(/\byou're\b/gi, 'you are')
    .replace(visaExamples, '')
    .replace(/\s*[(\[](?:required|optional|voluntary)[)\]]\s*[?*]*$/i, ''));
}

const immigrationDisjunction = new RegExp('^(?:do|will|would) you(?: ' + interval + '| currently)? (?:require|need) (?:any )?'
  + '(?:immigration filings? or (?:(?:visa|employer) )?sponsorship|(?:(?:visa|employer) )?sponsorship or immigration filings?)'
  + '(?: to (?:maintain|obtain) (?:your )?work authori[sz]ation)?$');

function immigrationOrSponsorship(source: string): boolean {
  const parts = source.split(/\s+including\s+/i);
  if (parts.length > 2 || !immigrationDisjunction.test(semanticWords(parts[0]))) return false;
  if (parts.length === 1) return true;
  // Only nonrestrictive examples of the same immigration requirement may follow.
  // Sponsorship Yes proves A OR B; sponsorship No cannot establish the other fact.
  const examples = parts[1].split(',').map(semanticWords);
  return examples.length > 0 && examples.every(example =>
    /^(?:renewal|extension|renewal extension|renewal or extension) of (?:an? )?open work permits?$/.test(example)
    || /^(?:permanent residency|permanent residence|etc)$/.test(example)
    || (/^sponsorship(?: by [\p{L}\p{N}]+(?: [\p{L}\p{N}]+){0,9})?$/u.test(example)
      && !/\b(?:only|not|without|if|unless|but|except|must|you|require|hold|agree|citizen)\b/.test(example)));
}

const locationWillingness = /^(?:(?:are you|would you be|will you be|i am|i would be) )?(willing|not willing|unwilling|open|not open|able|not able|unable) to (.+)$/;
const directWillingness = /^(?:(?:can|could|will|would) you|i (?:can|will|would))(?: (not))? (?:consider )?(.+)$/;
const comfortableWorking = /^(?:are you|would you be|i am) (not )?comfortable (?:with )?(working .+)$/;
const workSchedule = /(?: (?:at least |up to |a minimum of )?(?:(?:[1-7]|one|two|three|four|five|six|seven) ?x|(?:[1-7]|one|two|three|four|five|six|seven) (?:days?|times?))(?: (?:a|per|each))? week| full time)$/;
const additionalRequirements = /\b(?:travel|overtime|weekends?|holidays?|shifts?|per diem|salary|relocation (?:package|benefits|assistance)|visa|sponsor(?:ship)?|authori[sz]ation|citizen(?:ship)?|without|because)\b|\b(?:and|or) (?:work|move|relocate|accept|agree|be|do)\b/;
const officeVenue = /^(?:(?:one of )?(?:our |your |the |an? ))?(?:(.+) )?(?:offices?|campus|facility|worksite|work site|site|headquarters)$/;
const locationName = /^\p{L}[\p{L}\p{N}]*(?: [\p{L}\p{N}]+){0,7}$/u;
const nonGeographicWords = /\b(?:a|an|and|or|but|if|unless|with|when|while|during|before|after|our|your|team|department|sales|retail|marketing|engineering|finance|customer service|remote|remotely|home|office hours)\b/;
const genericLocation = /^(?:here|(?:this|that|the|our) (?:city|location|area|region|metro area|job location|work location)|(?:the )?(?:listed|specified|posted|designated) (?:city|location|area))$/;
const outsideRadius = /^if you (?:(?:are not (?:currently )?(?:located|based|living)|do not (?:currently )?live) within|(?:are|live) outside(?: of)?) (?:a )?([1-9]\d{0,3}) (miles?|km|kilomet(?:er|re)s?)(?: radius)? of (?:this|the|our) (?:location|job location|work location|posted location|office|worksite) ((?:are you|would you be|will you be) (?:open|willing) to relocat(?:e|ion)\b.*)$/;
const insideRadius = /^i (?:am (?:currently )?(?:located|based|living)|(?:currently )?live) within (?:a )?([1-9]\d{0,3}) (miles?|km|kilomet(?:er|re)s?)(?: radius)?(?: of (?:this|the|our) (?:location|job location|work location|posted location|office|worksite))?$/;

function radiusKey(amount: string, unit: string): string {
  return amount + (unit.startsWith('mile') ? ' miles' : ' km');
}

function geographicLocation(place: string, source: string, requireNamedPlace = true): boolean {
  if (genericLocation.test(place)) return true;
  if (!locationName.test(place) || nonGeographicWords.test(place)) return false;
  if (!requireNamedPlace) return true;
  const first = place.split(' ')[0];
  return (source.match(/[\p{L}\p{N}]+/gu) ?? [])
    .some((word) => /^\p{Lu}/u.test(word) && semanticWords(word) === first);
}

function locationQuestion(label: string, source: string): Question | undefined {
  if (/^(?:relocation willingness|willingness to relocate)$/.test(label)) return { topic: 'relocation' };
  if (/^(?:onsite|on site|in office|in person) (?:work|availability)$/.test(label)) return { topic: 'onsiteWork' };
  const acknowledgment = /^i understand (?:that )?this is an? (?:on ?site|in person|in office) (?:role|position|job)(?: in (.+))?$/.exec(label);
  if (acknowledgment && !additionalRequirements.test(label) && !/[()[\];:]|[.!?]\s+\S/.test(source)
    && (!acknowledgment[1] || geographicLocation(acknowledgment[1], source))) {
    return { topic: 'onsiteWork', location: acknowledgment[1], proposition: true, acknowledgment: true };
  }
  if (/^(?:would working (?:from the office|on ?site|in person) be possible for you|are you available for (?:on ?site|in office|in person) work)$/.test(label)) {
    return { topic: 'onsiteWork', proposition: true };
  }
  const wording = locationWillingness.exec(label) ?? directWillingness.exec(label) ?? comfortableWorking.exec(label);
  if (!wording) return undefined;
  const inverse = /^(?:un|not)/.test(wording[1] ?? '');
  const action = wording[2]
    .replace(/(?: for (?:this|the) (?:role|job|position)| if (?:required|needed|necessary))$/, '')
    .replace(/ on a (?:hybrid|full time) basis$/, '');
  if (additionalRequirements.test(action)) return undefined;

  const relocation = action.replace(/ (?:upon hire|if hired)$/, '')
    .replace(/ for (?:this|the) (?:opportunity|role|job|position)$/, '');
  const relocating = /^(?:relocat(?:e|ing|ion)(?: to (.+)| anywhere| as needed)?|mov(?:e|ing) to (.+))$/.exec(relocation);
  if (relocating) {
    const location = relocating[1] ?? relocating[2];
    if (!location || geographicLocation(location, source, false)) {
      return { topic: 'relocation', location, inverse, proposition: true };
    }
  }

  const work = /^(?:work(?:ing)?|be(?:ing)?) (.+)$/.exec(action.replace(workSchedule, ''));
  if (!work) return undefined;
  const description = work[1];
  const explicitMode = /^(?:on ?site|in person|in (?:the )?office|from (?:the )?office|(?:a )?hybrid(?: (?:schedule|model|arrangement))?)(?: (?:at|from|in) (.+))?$/.exec(description);
  const venue = explicitMode?.[1] ?? /^(?:at|from|in|out of) (.+)$/.exec(description)?.[1];
  if (!venue) return explicitMode ? { topic: 'onsiteWork', inverse, proposition: true } : undefined;
  const office = officeVenue.exec(venue);
  if (office || geographicLocation(venue, source)) {
    return { topic: 'onsiteWork', location: office ? office[1] : venue, inverse, proposition: true };
  }
  return undefined;
}

const nonHispanicQualifier = / (?:non hispanic|not (?:of )?hispanic(?: (?:or |and )?latino)?(?: origin| descent)?)$/;

function raceChoice(text: string): { category: 'south_asian' | 'asian'; nonHispanic: boolean } | undefined {
  const label = text.replace(nonHispanicQualifier, '');
  const nonHispanic = label !== text;
  if (/^(?:south asian(?: (?:including|for example|such as|e g) (?!.*\bonly\b).+)?|asian south asian)$/.test(label)) {
    return { category: 'south_asian', nonHispanic };
  }
  if (label === 'asian' || broadAsianDefinition.test(label)) return { category: 'asian', nonHispanic };
}

function raceMatchRank(answer: string, label: string): number {
  if (declineOption.test(answer)) return Number(declineOption.test(label));
  const desired = raceChoice(answer);
  const choice = raceChoice(label);
  if (!desired || !choice || (choice.nonHispanic && !desired.nonHispanic)) return 0;
  if (choice.category === 'asian') return 1;
  return desired.category === 'south_asian' ? 2 : 0;
}

function classify(label: string, source = label): Question | undefined {
  if (!label) return undefined;
  const demographic = label.replace(/ (?:mark|select|check) all that apply$/, '');
  if (raceQuestion.test(demographic) || raceIdentityQuestion.test(demographic)) return { topic: 'raceEthnicity' };
  if (genderQuestion.test(demographic) || genderIdentityQuestion.test(demographic)) return { topic: 'gender' };

  if (immigrationOrSponsorship(source)) return { topic: 'visaSponsorship', proposition: true, affirmativeOnly: true };

  const visa = visaQuestion.exec(label) ?? namedEmployerVisaQuestion.exec(label);
  if (visa) {
    const employerPronoun = visa[2] === 'us' && /\bfor us[.?*!\s]*$/.test(source);
    return { topic: 'visaSponsorship', inverse: !!visa[1], location: employerPronoun ? undefined : visa[2], proposition: true };
  }
  const sponsoredVisa = sponsoredVisaQuestion.exec(label);
  if (sponsoredVisa) return { topic: 'visaSponsorship', inverse: !!sponsoredVisa[1], proposition: true };
  const inverseVisa = inverseVisaQuestion.exec(label);
  if (inverseVisa) return { topic: 'visaSponsorship', inverse: true, location: inverseVisa[1] ?? inverseVisa[2], proposition: true };
  const visaStatus = directVisaQuestion.exec(label);
  if (visaStatus) return { topic: 'visaSponsorship', proposition: !!visaStatus[1] };
  if (negativeVisaStatus.test(label)) return { topic: 'visaSponsorship', inverse: true, proposition: true };

  const military = veteranQuestion.exec(label);
  if (military) return { topic: 'veteran', inverse: !!military[1], protectedVeteran: !!military[2], proposition: true };
  const negativeMilitary = negativeVeteranIdentification.exec(label);
  const nonVeteran = negativeMilitary ?? negativeVeteranStatus.exec(label);
  if (nonVeteran) return { topic: 'veteran', inverse: true, protectedVeteran: !!nonVeteran[1], proposition: true };
  if (/^(?:(?:please )?(?:select|indicate|identify|specify) (?:your )?|what is your |your )?(?:protected )?(?:military )?veteran (?:status|self identification)$/.test(label)) {
    return { topic: 'veteran', protectedVeteran: /\bprotected\b/.test(label) };
  }

  const ethnicity = hispanicQuestion.exec(label);
  if (ethnicity) return { topic: 'hispanicLatino', inverse: !!ethnicity[1], proposition: true };
  const ethnicityTitle = latinIdentity.exec(label);
  if (ethnicityTitle) return { topic: 'hispanicLatino', inverse: !!ethnicityTitle[1], proposition: !!ethnicityTitle[1] };

  const disabilities = disabilityQuestion.exec(label);
  if (disabilities) return { topic: 'disability', inverse: !!(disabilities[1] || disabilities[2] || disabilities[3]), proposition: true };
  if (/^(?:no disability|not disabled|without (?:a )?disability)$/.test(label)) return { topic: 'disability', inverse: true, proposition: true };
  if (/^(?:disabled|with (?:a )?disability)$/.test(label)) return { topic: 'disability', proposition: true };
  if (/^(?:(?:please )?(?:select|indicate|identify|specify) (?:your )?|what is your |your )?(?:disability(?: status| (?:voluntary )?self identification)?|(?:voluntary )?self identification of disability)$/.test(label)) {
    return { topic: 'disability' };
  }
  return locationQuestion(label, source);
}

export function semanticQuestion(field: SemanticField): Question | undefined {
  // An employer policy sentence is context, not the applicant's own answer.
  // Strip only this bounded preface, retaining the complete applicant question.
  const stripped = field.label.replace(/^we (?:are unable to|cannot|do not|can|are able to|will not|will) (?:offer|provide) (?:visa |employment |immigration )?sponsorship(?: for (?:this|the) (?:position|role|job))?[.!]\s*/i, '');
  const requirement = semanticWords(stripped);
  const source = visaQuestion.test(requirement) || namedEmployerVisaQuestion.test(requirement) || sponsoredVisaQuestion.test(requirement) ? stripped : field.label;
  const label = semanticWords(source);
  const radius = outsideRadius.exec(label);
  if (radius) {
    const question = locationQuestion(radius[3], source);
    return question?.topic === 'relocation' ? { ...question, relocationRadius: radiusKey(radius[1], radius[2]) } : undefined;
  }
  const conditional = /^if you(?: are|['’]re) not(?: currently)? (?:located|based|living) in ([\p{L}]+(?:[ '\-][\p{L}]+){0,5}),\s*([a-z]{2}),?\s+((?:are you|would you be|will you be) (?:open|willing|able) to relocat(?:e|ion)(?: to [^?!]+)?)[?*.\s]*$/iu.exec(source);
  if (conditional && geographicLocation(words(conditional[1]), source)
    && !/\b(?:area|region|metro|county|country|state|posted|listed|specified|designated|greater|surrounding|nearby)\b/.test(words(conditional[1]))) {
    const question = classify(semanticWords(conditional[3]), source);
    return question?.topic === 'relocation' ? { ...question, unlessLocatedIn: words(conditional[1]) } : undefined;
  }
  if (/^(?:status|self identification|(?:please )?(?:select|choose)(?: (?:one|an option))?)$/.test(label)) {
    return classify(semanticWords(field.context ?? ''), field.context);
  }
  return classify(label, source);
}

function optionPolarity(text: string, question: SemanticQuestion, source = text): Option | undefined {
  if (!text) return undefined;
  if (declineOption.test(text)) return 'decline';
  if (question.topic === 'gender') return Object.hasOwn(genderOptions, text) ? genderOptions[text] : undefined;
  if (/^(?:yes|true)$/.test(text)) return 'yes';
  if (/^(?:no|false)$/.test(text)) return 'no';

  const response = /^(yes|no) (.+)$/.exec(text);
  const statement = response?.[2] ?? text;
  const described = question.topic === 'workAuthorization'
    ? authorizationOption(statement)
    : classify(statement, source);
  let actual: Status | undefined;
  if (described?.topic === question.topic && described.proposition) {
    if (described.location && !sameLocation(described.location, question.location ?? '')) return undefined;
    // An affirmative veteran response cannot settle a protected-status distinction.
    if (question.topic === 'veteran' && !described.inverse && 'protectedVeteran' in described
      && !!described.protectedVeteran !== !!question.protectedVeteran) return undefined;
    actual = !!described.inverse === !!question.inverse ? 'yes' : 'no';
  } else if (question.topic === 'veteran') {
    if (/^(?:veteran|protected veteran|i identify as one or more of the classifications of protected veterans(?: listed above)?)$/.test(statement)) {
      if (!!question.protectedVeteran !== (statement !== 'veteran')) return undefined;
      actual = question.inverse ? 'no' : 'yes';
    }
  } else if (question.topic === 'hispanicLatino') {
    const identity = latinIdentity.exec(statement);
    if (identity) actual = !!identity[1] === !!question.inverse ? 'yes' : 'no';
  }
  return response && response[1] !== actual ? undefined : actual;
}

function authorizationOption(statement: string): SemanticQuestion | undefined {
  const match = /^(?:i am )?(not )?(?:legally )?(?:authori[sz]ed|permitted|eligible|entitled) to work(?: in (.+))?$/.exec(statement);
  if (match) return { topic: 'workAuthorization', inverse: !!match[1], location: match[2] ?? '', proposition: true };
}

function sameLocation(a: string, b: string): boolean {
  const left = explicitCountryKey(a);
  const right = explicitCountryKey(b);
  return left && right ? left === right : semanticWords(a) === semanticWords(b);
}

/** Ranks supported meanings within a single question. Equal highest ranks remain ambiguous. */
export function optionMatchRank(field: SemanticField, option: Pick<Choice, 'label' | 'value'>, answer: string, meaning?: SemanticQuestion): number {
  const literal = normalize(answer);
  if (!literal) return 0;
  const question = meaning ?? semanticQuestion(field);
  if (question && 'relocationRadius' in question && question.relocationRadius
    && field.kind === 'combobox' && field.element && usesNestedOptions(field.element)) return 0;
  if (question?.topic === 'raceEthnicity') return raceMatchRank(semanticWords(answer), semanticWords(option.label || option.value));
  if (question) {
    const key = optionPolarity(semanticWords(answer), question, answer);
    if (key) {
      // The visible label takes precedence over machine values for these questions.
      const label = option.label || option.value;
      const choice = optionPolarity(semanticWords(label), question, label);
      return key === choice ? 1 : 0;
    }
  }
  return literal === normalize(option.label) || literal === normalize(option.value) ? 1 : 0;
}

export function configuredApplicationAnswer(field: Field, defaults: ApplicationDefaults): string | boolean | undefined {
  const singleCheckbox = field.kind === 'checkbox' && !field.multiple;
  const question = semanticQuestion(field);
  if (!question) {
    const group = singleCheckbox ? classify(semanticWords(field.context)) : undefined;
    if (group?.topic !== 'gender') return undefined;
    const choice = optionPolarity(semanticWords(field.label), group);
    return choice && choice === defaults.gender ? true : undefined;
  }
  return applicationAnswer(field, defaults, question);
}

function supportsRadiusWillingness(field: Field, question: Question, willingness: string): boolean {
  if (field.multiple || !['select', 'radio', 'combobox'].includes(field.kind)) return false;
  if (field.kind === 'combobox' && usesNestedOptions(field.element)) return false;
  // A lazy menu is checked again with its rendered choices before committing.
  if (!field.choices.length) return field.kind === 'combobox';
  const labels = field.choices.map(({ label }) => semanticWords(label));
  const yes = labels.filter(label => label === 'yes').length;
  const no = labels.filter(label => label === 'no').length;
  if (yes !== 1 || no !== 1) return false;
  if (labels.length === 2) return true;
  if (willingness !== 'yes' || labels.length !== 3) return false;
  const nearby = insideRadius.exec(labels.find(label => label !== 'yes' && label !== 'no') ?? '');
  return !!nearby && radiusKey(nearby[1], nearby[2]) === question.relocationRadius;
}

export function applicationAnswer(field: Field, defaults: ApplicationDefaults, question: Question): string | boolean | undefined {
  const singleCheckbox = field.kind === 'checkbox' && !field.multiple;
  if (question.topic === 'visaSponsorship' && question.location) {
    if (/^(?:the )?us$/.test(question.location) && !/\bUS\b/.test(field.label + ' ' + field.context)) return undefined;
    if (!explicitCountryKey(question.location)
      && !/^(?:this (?:role|job|position)|the (?:country|location) (?:where|in which) (?:this|the) (?:role|job|position) is (?:based|located))$/.test(question.location)) return undefined;
  }
  const value = defaults[question.topic];
  if (!value) return undefined;
  if (question.affirmativeOnly && value !== 'yes') return undefined;
  if (question.relocationRadius && !supportsRadiusWillingness(field, question, value)) return undefined;
  if (question.acknowledgment && value !== 'yes') return undefined;
  if (value === 'decline') return singleCheckbox ? undefined : 'Decline';
  if (question.topic === 'raceEthnicity') {
    if (singleCheckbox) return undefined;
    const label = value === 'south_asian' ? 'South Asian' : 'Asian';
    return field.kind === 'text' || defaults.hispanicLatino !== 'no' ? label : label + ' (Not Hispanic or Latino)';
  }
  if (question.topic === 'gender') {
    if (singleCheckbox) return undefined;
    if (value === 'male') return 'Male';
    if (value === 'female') return 'Female';
    if (value === 'nonbinary') return 'Nonbinary';
  }
  if (question.protectedVeteran && value === 'yes') return undefined;
  const affirmative = (value === 'yes') !== !!question.inverse;
  return singleCheckbox ? question.proposition ? affirmative : undefined : affirmative ? 'Yes' : 'No';
}
