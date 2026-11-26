import { emptyProfile, parseProfile } from '../shared/profile';
import { migrateRequestedDefaults, withRequestedDefaults } from '../shared/requested-defaults';
import type { AIProvider, AISettings, Profile } from '../shared/types';
import { extensionAPI } from './extension-api';

const PROFILE = 'jobright.profile.v1', AI = 'jobright.ai.v1';
const DEFAULTS_REVISION = 'jobright.application-defaults.revision';
const CURRENT_DEFAULTS_REVISION = 6;
export const DEFAULT_AI_MODELS: Readonly<Record<AIProvider, string>> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4.1-mini',
};
async function protectStorage() {
  const storage = extensionAPI().storage.local;
  if (storage.setAccessLevel) await storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return storage;
}
let pendingWrite: Promise<unknown> = Promise.resolve();

async function writeStorage<T>(write: () => Promise<T>): Promise<T> {
  // Extension pages and the worker share storage. Avoid saving a stale migration over a manual edit.
  const locks = globalThis.navigator?.locks;
  if (locks) return locks.request('jobright.local-storage', write);
  const next = pendingWrite.then(write);
  pendingWrite = next.catch(() => {});
  return next;
}

async function readProfile(): Promise<{ profile?: Profile; defaultsCurrent: boolean; revision: number }> {
  const data = await extensionAPI().storage.local.get([PROFILE, DEFAULTS_REVISION]);
  const revision = data[DEFAULTS_REVISION];
  return {
    profile: data[PROFILE] === undefined ? undefined : parseProfile(data[PROFILE]),
    defaultsCurrent: typeof revision === 'number' && revision >= CURRENT_DEFAULTS_REVISION,
    revision: typeof revision === 'number' ? revision : 0,
  };
}

async function writeProfile(profile: Profile): Promise<void> {
  await (await protectStorage()).set({ [PROFILE]: profile, [DEFAULTS_REVISION]: CURRENT_DEFAULTS_REVISION });
}

export async function loadProfile(): Promise<Profile> {
  const snapshot = await readProfile();
  if (!snapshot.profile) return withRequestedDefaults(emptyProfile());
  if (snapshot.defaultsCurrent) return snapshot.profile;

  return writeStorage(async () => {
    const latest = await readProfile();
    if (!latest.profile) return withRequestedDefaults(emptyProfile());
    if (latest.defaultsCurrent) return latest.profile;
    const migrated = migrateRequestedDefaults(latest.profile, latest.revision);
    await writeProfile(migrated);
    return migrated;
  });
}

export async function saveProfile(profile: Profile): Promise<void> {
  const clean = withRequestedDefaults(parseProfile(profile));
  await writeStorage(() => writeProfile(clean));
}

function parseSettings(input: unknown): AISettings & { provider: AIProvider } {
  const data = input && typeof input === 'object' ? input as Partial<AISettings> : {};
  const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
  if (apiKey.length > 1024 || /[\r\n]/.test(apiKey)) throw new Error('API key is invalid.');
  if (data.provider !== undefined && data.provider !== 'anthropic' && data.provider !== 'openai') {
    throw new Error('Choose a valid AI provider.');
  }
  // Earlier versions only stored OpenAI keys. Keep those bound to OpenAI.
  const provider = data.provider ?? (apiKey ? 'openai' : 'anthropic');
  const savedModel = (data.provider || apiKey) && typeof data.model === 'string' ? data.model.trim() : '';
  const model = savedModel || DEFAULT_AI_MODELS[provider];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model)) throw new Error('Enter a valid model ID.');
  return { provider, enabled: data.enabled === true, apiKey, model, interpretQuestions: data.interpretQuestions !== false,
    ...(data.useVault !== undefined ? { useVault: data.useVault === true } : {}) };
}
export async function loadAISettings(): Promise<AISettings & { provider: AIProvider }> {
  return parseSettings((await extensionAPI().storage.local.get(AI))[AI]);
}
export async function saveAISettings(settings: AISettings): Promise<void> {
  const clean = parseSettings(settings);
  await writeStorage(async () => (await protectStorage()).set({ [AI]: clean }));
}
export async function clearLocalData(): Promise<void> { await writeStorage(() => extensionAPI().storage.local.clear()); }
