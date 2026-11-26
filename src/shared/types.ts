export interface PersonalDetails {
  firstName: string; lastName: string; email: string; phone: string;
  address: string; city: string; state: string; postalCode: string; country: string;
  linkedin: string; website: string; github: string;
  middleName?: string; preferredFirstName?: string; preferredMiddleName?: string; preferredLastName?: string;
  address2?: string; county?: string; phoneCountryCode?: string; phoneType?: string;
}
export interface Employment {
  company: string; title: string; location: string; startDate: string; endDate: string;
  current: boolean; description: string;
}
export interface Education {
  school: string; degree: string; fieldOfStudy: string; startDate: string; endDate: string; gpa: string;
  degreeAlternatives?: string[];
  fieldOfStudyAlternatives?: string[];
  campus?: string;
  current?: boolean;
}
export interface WorkAuthorization {
  country: string;
  authorized?: boolean;
  fullTimeAuthorized?: boolean;
  sponsorshipRequired?: boolean;
}
export interface ApplicationDefaults {
  visaSponsorship?: 'yes' | 'no';
  gender?: 'male' | 'female' | 'nonbinary' | 'decline';
  disability?: 'yes' | 'no' | 'decline';
  veteran?: 'yes' | 'no' | 'decline';
  hispanicLatino?: 'yes' | 'no' | 'decline';
  acceptApplicationPrivacy?: boolean;
  relocation?: 'yes' | 'no';
  onsiteWork?: 'yes' | 'no';
  raceEthnicity?: 'south_asian' | 'asian' | 'decline';
  referralSource?: 'linkedin';
}
export interface SavedAnswer { question: string; answer: string }
export interface ResumeAttachment { name: string; type: string; dataUrl: string; lastModified: number }
export interface Profile {
  schemaVersion: 1; personal: PersonalDetails; employment: Employment[];
  education: Education[]; answers: SavedAnswer[]; resume?: ResumeAttachment;
  workAuthorizations?: WorkAuthorization[];
  applicationDefaults?: ApplicationDefaults;
  skills?: string[];
}
export type AIProvider = 'anthropic' | 'openai';
export interface AISettings { provider?: AIProvider; enabled: boolean; apiKey: string; model: string; interpretQuestions?: boolean; useVault?: boolean }
export type FieldKind = 'text' | 'select' | 'radio' | 'checkbox' | 'combobox' | 'file';
export type FieldStatus = 'ready' | 'preserved' | 'unanswered' | 'unsupported';
export interface FieldPlan {
  id: string; label: string; kind: FieldKind; status: FieldStatus;
  value?: string | string[] | boolean; currentValue?: string; reason?: string;
  section?: string; options?: string[]; sensitive?: boolean; aiEligible?: boolean; required?: boolean;
  /** Opaque document-local form identity for bounded follow-up fills. */
  scopeId?: string; scopeType?: 'form' | 'document';
  /** Original Workday work-history group; authorizes only bounded added rows. */
  workdayExperienceGroupId?: string;
  workdayRepeatGroupId?: string;
  interpretationEligible?: boolean;
  /** Bounded static question help/legend text; excludes current applicant values. */
  interpretationContext?: string;
  answerSource?: 'profile' | 'reviewed' | 'interpreted' | 'vault';
  vaultEligible?: boolean;
  vaultContext?: string;
  maxLength?: number;
}
export interface ScanOptions {
  overwriteExisting?: boolean;
  /** Restrict continuing overwrite permission to originally previewed controls. */
  overwriteFieldIds?: string[];
  reviewedAnswers?: Record<string, string>;
  vaultRun?: string;
  /** Same direct Autofill run; preserves edit-and-clear across structural rescans. */
  autofillRun?: string;
}
export interface ScanResult {
  scanId: string; platform: string; frameUrl: string; fields: FieldPlan[]; warnings: string[];
  workdayExperienceGroupId?: string;
  /** Native form enclosing the original work group, even before any rows exist. */
  workdayExperienceFormScopeId?: string;
  workdayRepeatGroups?: { id: string; kind: 'education' | 'websites'; formScopeId?: string }[];
}
export interface WorkdayExperienceExpansion { added: number; needsRescan: boolean; aborted?: boolean; message?: string }
export interface FillEntry { id: string; label: string; status: 'filled' | 'skipped' | 'failed'; reason?: string }
export interface FillResult {
  entries: FillEntry[]; filled: number; skipped: number; failed: number; needsRescan: boolean;
  /** True only when this fill created an undoable change. */
  undoAvailable?: boolean;
}
export interface UndoResult { restored: number; skipped: number; warning?: string }
export interface FieldFocusResult { focused: boolean; reason?: string }
export interface AutofillEngine {
  scan(profile: Profile, options?: ScanOptions): Promise<ScanResult>;
  fill(scanId: string, fieldIds?: string[], appendUndoTo?: string): Promise<FillResult>;
  undo(expectedScanId?: string): Promise<UndoResult>;
  focus?(fieldId: string): FieldFocusResult;
  interpret?(scanId: string, profile: Profile, meanings: import('./interpretation').QuestionMeaning[]): Promise<ScanResult | undefined>;
  stageVaultAnswers?(scanId: string, answers: import('./vault').VaultAnswer[]): Promise<ScanResult | undefined>;
  expandWorkdayExperience?(scanId: string, expectedGroupId: string): Promise<WorkdayExperienceExpansion>;
  expandWorkdayRepeat?(scanId: string, expectedGroupId: string): Promise<WorkdayExperienceExpansion>;
}
export interface FrameScan { tabId: number; frameId: number; tabUrl?: string; documentId?: string; result: ScanResult }
export interface FrameFill { frameId: number; result: FillResult }
export interface AISuggestion { fieldId: string; question: string; answer: string }
export interface SuggestionResult { suggestions: AISuggestion[]; error?: string }
export interface UndoBatch { url: string; frames: { frameId: number; scanId: string; frameUrl: string }[] }
declare global {
  var __jobrightLocal: AutofillEngine | undefined;
  var __jobrightLocalUndoBatch: UndoBatch | undefined;
}
