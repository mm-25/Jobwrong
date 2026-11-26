import type { VaultAnswer } from '../shared/vault';
import { labelText, visible, words, type Field } from './discovery';
import { interpretationContext } from './interpretation';

const narrativeTopic = /\b(?:projects?|products?|prototypes?|challenges?|accomplishments?|achievements?|initiatives?|experience|decisions?|design|research|leadership|collaboration|teamwork|problem(?:s| solving)?|contribution|outcomes?|impact|motivation|approach|process|interests?|career goals|qualifications|strengths|learned)\b/;
const narrativePrompt = /^(?:please )?(?:(?:describe|explain|discuss|elaborate on|summari[sz]e)\b|(?:tell us|share) (?:about|why|how|what|an? example)\b|(?:provide|give|share) (?:an? )?(?:specific |concrete )?examples?\b|(?:tell us about|describe|share) a time\b)/;
const motivationPrompt = /^(?:please )?(?:why (?:do|did|would) you (?:(?:want|wish|like) (?:to\b|this\b)|(?:choose|chose|decide) to (?:apply|join|work|pursue)\b|apply\b)|why (?:are|were) you (?:interested|applying|excited|drawn|motivated)\b|why should we (?:hire|consider|choose|select) you\b|why (?:this (?:role|company|job|position|opportunity)|our (?:company|team|mission))\b|what (?:(?:is|s) (?:the )?most (?:exciting|interesting|compelling) (?:to you )?(?:about|in)|interests you|motivates you|drew you|draws you|excites you|makes you (?:a|an) (?:good|strong|great) (?:fit|candidate))\b)/;
const introductorySentence = /^(?:at [^.!?]{2,100},\s+(?:our|we)\b|our mission\b|we (?:design|build|work|believe|help)\b)[^.!?]{0,120}\.\s+(?=(?:what|which|why|how|tell|describe|explain|share)\b)/i;
const pastWorkQuestion = /^(?:what (?:is|was|s) (?:the |your |a |an )?|which )(?:most \w+|biggest|proudest|favorite|something|notable|memorable|significant)\b.+\byou (?:(?:have|ve|had|d) )?(?:worked|designed|built|led|solved|researched|created|developed|delivered|handled|encountered)\b/;
const factualOrRestricted = [
  /\b(?:salary|compensation|wages?|pay (?:range|rate|expectations?)|benefits|visa|sponsor(?:ship|ed|ing)?|citizen(?:ship)?|nationality|work (?:permit|authori[sz]ation|eligibility)|right to work|(?:legally|lawfully) (?:work|employ)|relocation|accommodations?)\b/,
  /\b(?:disabilit(?:y|ies)|disabled|medical|health (?:history|condition)|veteran|military service|gender|race|racial|ethnicity|ethnic|hispanic|latino|pronouns?|sexual(?:ity| orientation)|criminal|convictions?|background check|age|birth(?:day|date)?|passport|tax|social security)\b/,
  /\b(?:credentials?|password|passcode|signature|certify|certification|licen[cs](?:e|es|ure)|consent|attest|privacy (?:policy|notice)|agree|acknowledg(?:e|ment|ement)|terms and conditions|terms of (?:use|service)|ignore (?:all |previous |prior )*instructions|(?:return|output) json)\b/,
  /\b(?:(?:legal|full|first|last|family|middle|preferred) name|(?:name|details) of your (?:employer|references?|supervisor)|current (?:employer|job title)|languages? (?:you (?:speak|know)|fluency|proficiency)|(?:what|which) languages?|fluen(?:t|cy)|how (?:many|much|long)|number of years|years of (?:work |professional |relevant )?experience|gpa|grade point average|graduation (?:date|year)|contact (?:details|information)|phone number|email address|street address|postal code|start date|notice period|availability|work schedule)\b/,
];
const privateText = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|\b(?:current|selected|entered|previous) value\s*:/i;
const opaqueId = /^[A-Za-z0-9_-]{1,128}$/;

export function vaultMaxLength(field: Field): number {
  const element = field.element as HTMLInputElement | HTMLTextAreaElement;
  return element.hasAttribute('maxlength') && element.maxLength >= 0 ? Math.min(4000, element.maxLength) : 4000;
}

/** Require explicit prose intent and reject questions about facts or attestations. */
export function eligibleForVault(field: Field, currentValues: Set<string>): boolean {
  if (field.kind !== 'text' || !field.trustedLabel || field.blocked || field.unsupportedReason || field.section
    || field.resumeAlternative || field.choices.length || field.label.length > 2000
    || !field.element.matches('textarea, input:not([type]), input[type="text" i]') || field.element.matches('input[list]')
    || !/^(?:on|off)?$/.test(field.autocomplete) || vaultMaxLength(field) === 0) return false;
  const element = field.element as HTMLInputElement | HTMLTextAreaElement;
  const label = words(field.label);
  if (label === words(element.placeholder) && !element.labels?.length
    && !element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby')) return false;
  const evidence = [field.label, field.context, ...field.metadata].map(words).join(' ');
  if (!safeCaption(field.label, currentValues) || factualOrRestricted.some(pattern => pattern.test(evidence))) return false;

  const question = field.label.replace(introductorySentence, '');
  const prompt = words(question);
  const openingQuestion = words(question.split('?')[0]);
  return isMotivation(prompt) || ((narrativePrompt.test(prompt) || /^(?:please )?how (?:have you|did you|would you|has your)\b/.test(prompt)
    || pastWorkQuestion.test(openingQuestion)) && (narrativeTopic.test(prompt) || /\b(?:a time|examples?)\b/.test(prompt)));
}

function isMotivation(label: string): boolean {
  return label === 'cover letter' || motivationPrompt.test(label);
}

function safeCaption(text: string, currentValues: Set<string>): boolean {
  const caption = ' ' + words(text) + ' ';
  return !privateText.test(text) && ![...currentValues].some(value => caption.includes(' ' + value + ' '));
}

const postingHeading = '.posting-header h1, h1.app-title, [data-testid="job-title"]';
const dynamicText = 'input, textarea, select, button, output, [contenteditable], [aria-live], [role="status"], script, style';

function vaultPostingCaption(field: Field, currentValues: Set<string>): string | undefined {
  const form = field.element.closest('form');
  const page = field.element.closest('main, [role="main"]') ?? field.element.ownerDocument.body;
  // An outer heading can only identify the application when there is one form in the container.
  const scope = page && [...page.querySelectorAll('form')].every(node => node === form) ? page : form;
  if (!scope) return undefined;
  const candidates = [...scope.querySelectorAll('h1, ' + postingHeading)].flatMap(heading => {
    if (!visible(heading) || heading.closest(dynamicText) || heading.querySelector(dynamicText)) return [];
    const text = labelText(heading);
    if (text.length > 240 || !safeCaption(text, currentValues) || factualOrRestricted.some(pattern => pattern.test(words(text)))) return [];
    if (!heading.matches(postingHeading) && !/^apply (?:for|to) (?:the )?\S|^\S.+ application$/i.test(text)) return [];
    return text ? [text] : [];
  });
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : undefined;
}

export function vaultContext(field: Field, currentValues: Set<string>): string | undefined {
  const question = interpretationContext(field, currentValues);
  const posting = isMotivation(words(field.label.replace(introductorySentence, ''))) ? vaultPostingCaption(field, currentValues) : undefined;
  const context = [...new Set([posting, question])].filter((text): text is string => !!text && safeCaption(text, currentValues));
  const combined = context.join(' ');
  return combined.length <= 600 ? combined || undefined : posting;
}

export function validatedVaultAnswer(candidate: VaultAnswer, maxLength: number): string | undefined {
  if (typeof candidate.answer !== 'string' || candidate.answer.length > 4000 || !Array.isArray(candidate.sourceIds)
    || candidate.sourceIds.length < 1 || candidate.sourceIds.length > 3
    || new Set(candidate.sourceIds).size !== candidate.sourceIds.length
    || !candidate.sourceIds.every(id => typeof id === 'string' && opaqueId.test(id))) return undefined;
  const answer = candidate.answer.trim();
  return answer && answer.length <= maxLength ? answer : undefined;
}
