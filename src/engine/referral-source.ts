import type { ApplicationDefaults } from '../shared/types';
import { fitKnownChoice } from './answer-formats';
import { words, type Field } from './discovery';

const sourceQuestion = /^(?:(?:how|where) did you (?:hear|learn) about (?:us|(?:this|the|our) (?:job|role|position|opportunity|company))|(?:how|where) did you find (?:us|(?:this|the|our) (?:job|role|position|opportunity))|(?:please )?tell us how you heard about (?:us|(?:this|the|our) (?:job|role|position|opportunity|company))|referral source|application source|source of (?:your )?application)$/;

export function isReferralQuestion(field: Field): boolean {
  return field.trustedLabel && !field.blocked && sourceQuestion.test(words(field.label));
}

export function referralAnswer(field: Field, defaults?: ApplicationDefaults): string | undefined {
  if (!isReferralQuestion(field) || defaults?.referralSource !== 'linkedin'
    || field.kind === 'file' || (field.kind === 'checkbox' && !field.multiple)) return undefined;
  return fitKnownChoice(field, 'LinkedIn', value => /^(?:linked ?in|linkedin jobs|linkedin com)$/.test(words(value)) ? 'linkedin' : undefined);
}
