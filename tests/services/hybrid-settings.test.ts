import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalData, loadAISettings, saveAISettings } from '../../src/services/storage';
import type { AISettings } from '../../src/shared/types';

const settingsKey = 'jobright.ai.v1';
const legacySettings: AISettings = {
  provider: 'anthropic',
  enabled: true,
  apiKey: 'sk-ant-fixture',
  model: 'claude-sonnet-5-5',
};

let data: Record<string, unknown>;

beforeEach(() => {
  data = {};
  vi.stubGlobal('browser', {
    runtime: {},
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
        set: async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)); },
        clear: async () => { data = {}; },
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('hybrid Autofill settings', () => {
  it('defaults to matching for legacy enabled AI', async () => {
    data[settingsKey] = legacySettings;

    expect(await loadAISettings()).toMatchObject({
      enabled: true,
      interpretQuestions: true,
    });
  });

  it('keeps legacy AI disabled after loading', async () => {
    data[settingsKey] = { ...legacySettings, enabled: false };

    expect((await loadAISettings()).enabled).toBe(false);
  });

  it('preserves an explicit matching opt-out after save and reload', async () => {
    await saveAISettings({ ...legacySettings, interpretQuestions: false });

    expect(await loadAISettings()).toMatchObject({
      enabled: true,
      interpretQuestions: false,
    });
  });

  it('restores default matching preferences and clears credentials when local data is cleared', async () => {
    await saveAISettings({ ...legacySettings, interpretQuestions: false });
    await clearLocalData();

    expect(await loadAISettings()).toMatchObject({
      enabled: false,
      apiKey: '',
      interpretQuestions: true,
    });
  });
});
