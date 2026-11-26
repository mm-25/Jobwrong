import type { FieldKind } from './types';

/** Only field meaning crosses the AI boundary; applicant values stay local. */
export const INTERPRETATION_FACTS = [
  'visaSponsorship', 'workAuthorization', 'gender', 'disability', 'veteran',
  'hispanicLatino', 'raceEthnicity', 'onsiteWork', 'relocation',
  'firstName', 'lastName', 'fullName', 'email', 'phone', 'address', 'city',
  'state', 'postalCode', 'country', 'linkedin', 'website', 'github',
  'currentEmployer', 'currentJobTitle', 'skills',
] as const;
export type InterpretationFact = typeof INTERPRETATION_FACTS[number];
export interface InterpretationQuestion {
  id: string;
  label: string;
  kind: Exclude<FieldKind, 'file'>;
  context?: string;
  options?: string[];
}
export interface QuestionMeaning {
  fieldId: string;
  fact: InterpretationFact;
  inverse: boolean;
  country: string | null;
  confidence: 'high' | 'uncertain';
  /** Exact supporting phrase from the supplied question, not a generated answer. */
  evidence: string;
}
export interface InterpretationResult { meanings: QuestionMeaning[]; error?: string }
export interface InterpretationRun { token: string; topUrl: string }
export type QuestionInterpreter = (questions: InterpretationQuestion[], run: InterpretationRun) => Promise<InterpretationResult>;
export const INTERPRETATION_CHANNEL = 'jobright-local-interpretation-v1';
export interface InterpretationRequest {
  channel: typeof INTERPRETATION_CHANNEL;
  run: InterpretationRun;
  url: string;
  questions: InterpretationQuestion[];
}
