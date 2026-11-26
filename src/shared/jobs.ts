import type { FieldFocusResult, FieldPlan, FillResult, Profile } from './types';
import type { InterpretationRun } from './interpretation';

export const JOB_CHANNEL = 'jobright-local-job-v1';
export const EMBEDDED_APPLICATION_CHANNEL = 'jobright-local-embedded-application-v1';
export interface EmbeddedApplicationBinding {
  tabId: number;
  topUrl: string;
  topDocumentId?: string;
  topTimeOrigin: number;
  iframeKey: string;
  iframeIndex: number;
  frameId: number;
  frameUrl: string;
  documentId?: string;
  frameTimeOrigin: number;
  formKey: string;
}
export interface EmbeddedApplicationRequest { channel: typeof EMBEDDED_APPLICATION_CHANNEL; binding: EmbeddedApplicationBinding }
export interface EmbeddedApplicationReply { valid: boolean }
export type JobCommand = 'start' | 'status' | 'undo' | 'options' | 'show' | 'focus';
export interface FieldFocusTarget { fieldId: string; frameId: number; frameUrl: string; documentId?: string }
export interface JobRequest { channel: typeof JOB_CHANNEL; command: JobCommand; url: string; tabId?: number; overwrite?: boolean; focus?: FieldFocusTarget }
export interface JobState {
  url: string; running: boolean; started: boolean; filled: number; failed: number;
  undoAvailable: boolean; message: string;
  aiFilled?: number; aiMessage?: string;
  vaultFilled?: number; vaultMessage?: string;
  experienceMessage?: string;
  /** Added by the background using browser-supplied injection results. */
  frameId?: number; documentId?: string;
  remaining: (Pick<FieldPlan, 'label' | 'status' | 'reason' | 'required'> & { id?: string })[];
}
export interface JobReply { states?: JobState[]; warning?: string; error?: string; focus?: FieldFocusResult }
export interface PageController {
  start(profile: Profile, overwrite?: boolean, interpretationRun?: InterpretationRun, vaultRun?: import('./vault').VaultRun, binding?: EmbeddedApplicationBinding): boolean;
  status(binding?: EmbeddedApplicationBinding): JobState;
  undo(binding?: EmbeddedApplicationBinding): Promise<void>;
  noteFill(scanId: string, result: FillResult, binding?: EmbeddedApplicationBinding): void;
  focus?(fieldId: string, binding?: EmbeddedApplicationBinding): FieldFocusResult;
  show(): void;
}
declare global { var __jobrightPage: PageController | undefined }
