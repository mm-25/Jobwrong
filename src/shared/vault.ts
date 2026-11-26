import type { InterpretationRun } from './interpretation';

export const VAULT_CHANNEL = 'jobright-local-vault-v1';
export const VAULT_HOST = 'com.jobright_local.obsidian';
export interface VaultQuestion { id: string; label: string; kind: 'text'; context?: string; maxLength?: number }
export type VaultRun = InterpretationRun;
export interface VaultAnswer { fieldId: string; answer: string; sourceIds: string[] }
export interface VaultResult { answers: VaultAnswer[]; error?: string }
export type VaultDrafter = (questions: VaultQuestion[], run: VaultRun) => Promise<VaultResult>;
export interface VaultRequest { channel: typeof VAULT_CHANNEL; command: 'draft'; run: VaultRun; url: string; questions: VaultQuestion[] }
export interface VaultSource { id: string; path: string; heading: string; lineStart: number; lineEnd: number }
export interface VaultReceipt { question: string; sources: VaultSource[] }
export interface VaultSourcesRequest { channel: typeof VAULT_CHANNEL; command: 'sources'; tabId: number; url: string }
export interface VaultSourcesResult { receipts: VaultReceipt[]; error?: string }
export interface VaultHit extends VaultSource { questionId: string; text: string }
export interface NativeVaultRequest { v: 1; op: 'ping' | 'search'; questions?: { id: string; query: string }[] }
export interface NativeVaultReply { v: 1; ok: boolean; error?: string; rootLabel?: string; files?: number; revision?: string; hits?: VaultHit[] }
