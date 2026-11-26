import type { Field } from './discovery';

const signatureAction = /\b(?:signatures?|(?:e[- ]?)?sign(?:s|ed|ing)?(?!\s+(?:in|out|up)\b)|(?:applicant|candidate) initials?)\b/i;
const otherCommitment = /\b(?:certif(?:y|ies|ied|ying|ications?)|attest(?:s|ed|ing|ations?)?|accurate|arbitration|waiv(?:e|es|ed|ing|ers?)|jury trial|terms(?:\s*(?:and|&)\s*conditions| of (?:service|use|employment))|background check|drug test|sms|text message|marketing)\b/i;

/** The private build's opt-in covers application data privacy, never general contracts. */
export function isApplicationPrivacy(field: Pick<Field, 'label' | 'context' | 'kind' | 'multiple'>): boolean {
  if (field.kind !== 'checkbox' || field.multiple) return false;
  if (!/\b(accept|agree|consent|acknowledge)\b/i.test(field.label)
    || /\b(not|never|decline|withdraw|reject|disagree|without)\b|n['’]t\b/i.test(field.label)) return false;
  const text = `${field.label} ${field.context}`;
  return /\b(privacy|personal data|data processing)\b/i.test(text)
    && /\b(applicant|candidate|application|recruitment|recruiting)\b/i.test(text)
    && !signatureAction.test(text)
    && !otherCommitment.test(text);
}
