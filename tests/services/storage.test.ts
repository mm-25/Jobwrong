import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile, exportProfile } from '../../src/shared/profile';
import { clearLocalData, loadAISettings, loadProfile, saveAISettings, saveProfile } from '../../src/services/storage';
let data:Record<string,unknown>;
beforeEach(()=>{data={};vi.stubGlobal('browser',{runtime:{},storage:{local:{
  get: async (keys: string | string[]) => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]),
  ),
  set:async(items:Record<string,unknown>)=>{Object.assign(data,structuredClone(items));},
  clear:async()=>{data={};},
}}});});
describe('local profile persistence',()=>{
  it('keeps the saved profile intact when an import is invalid',async()=>{
    const profile=emptyProfile();profile.personal.firstName='Ada';await saveProfile(profile);
    await expect(saveProfile({schemaVersion:2} as any)).rejects.toThrow();
    expect((await loadProfile()).personal.firstName).toBe('Ada');
  });
  it('keeps credentials out of profile reads and clears both together',async()=>{
    await saveAISettings({enabled:true,apiKey:'sk-private',model:'gpt-4.1-mini'});
    await saveProfile(emptyProfile());
    expect(JSON.stringify(await loadProfile())).not.toContain('sk-private');
    expect((await loadAISettings()).apiKey).toBe('sk-private');
    await clearLocalData();
    expect((await loadAISettings()).enabled).toBe(false);
    expect((await loadAISettings()).apiKey).toBe('');
  });
  it('rejects invalid header values without replacing previous key',async()=>{
    await saveAISettings({enabled:true,apiKey:'sk-private',model:'gpt-4.1-mini'});
    await expect(saveAISettings({enabled:true,apiKey:'bad\nkey',model:'gpt-4.1-mini'})).rejects.toThrow();
    expect((await loadAISettings()).apiKey).toBe('sk-private');
  });
});

describe('AI provider settings', () => {
  it('defaults an unconfigured or empty legacy installation to Claude', async () => {
    const defaults = { provider: 'anthropic', enabled: false, apiKey: '', model: 'claude-sonnet-5-5' };
    expect(await loadAISettings()).toMatchObject(defaults);
    data['jobright.ai.v1'] = { enabled: false, apiKey: '', model: 'gpt-4.1-mini' };
    expect(await loadAISettings()).toMatchObject(defaults);
  });

  it('preserves legacy OpenAI credentials under their original provider', async () => {
    const legacy = { enabled: true, apiKey: 'sk-example', model: 'gpt-4.1-mini' };
    data['jobright.ai.v1'] = legacy;
    expect(await loadAISettings()).toMatchObject({ ...legacy, provider: 'openai' });
  });

  it('round-trips a Claude credential and uses its default model when omitted', async () => {
    await saveAISettings({ provider: 'anthropic', enabled: true, apiKey: ' sk-ant-example ', model: '' });
    expect(await loadAISettings()).toMatchObject({
      provider: 'anthropic', enabled: true, apiKey: 'sk-ant-example', model: 'claude-sonnet-5-5',
    });
  });
});

describe('public application defaults migration', () => {
  const profileKey = 'jobright.profile.v1';
  const requestedDefaults = {};

  it('starts with blank defaults on first load without writing a new profile until save', async () => {
    expect((await loadProfile()).applicationDefaults).toEqual(requestedDefaults);
    expect(data[profileKey]).toBeUndefined();
  });

  it('normalizes an existing profile once and retains saved answers and the separate API key', async () => {
    const legacy = emptyProfile();
    legacy.answers = [{ question: 'Gender', answer: 'Prefer not to answer' }];
    data[profileKey] = legacy;
    data['jobright.ai.v1'] = { enabled: false, apiKey: 'sk-test-original', model: 'gpt-4.1-mini' };

    expect(await loadProfile()).toEqual({ ...legacy, applicationDefaults: requestedDefaults });
    expect(data[profileKey]).toEqual({ ...legacy, applicationDefaults: requestedDefaults });
    expect((await loadAISettings()).apiKey).toBe('sk-test-original');
    const saved = data[profileKey];
    await loadProfile();
    expect(data[profileKey]).toBe(saved);
  });

  it('retains explicit choices without filling the unset entries', async () => {
    const profile = { ...emptyProfile(), applicationDefaults: { acceptApplicationPrivacy: false } };
    await saveProfile(profile);
    expect((await loadProfile()).applicationDefaults).toEqual({ acceptApplicationPrivacy: false });
  });

  it('retains an explicitly cleared preset through reload and profile export', async () => {
    await saveProfile({ ...emptyProfile(), applicationDefaults: {} });
    expect((await loadProfile()).applicationDefaults).toEqual({});
    expect(JSON.parse(exportProfile(await loadProfile())).applicationDefaults).toEqual({});
  });

  it('keeps an older profile blank when saved without loading it first', async () => {
    await saveProfile(emptyProfile());
    expect(data[profileKey]).toMatchObject({ applicationDefaults: requestedDefaults });
  });

  it('keeps a manual save when an older profile is loaded at the same time', async () => {
    data[profileKey] = emptyProfile();
    const profile = { ...emptyProfile(), applicationDefaults: { acceptApplicationPrivacy: false } };
    await Promise.all([loadProfile(), saveProfile(profile)]);
    expect(await loadProfile()).toEqual(profile);
  });
});
