import { beforeEach, expect, test, vi } from 'vitest';
import { loadAISettings, saveAISettings } from '../../src/services/storage';
import { requestAIPermission } from '../../src/services/ai';

let data: Record<string, unknown>;
const request = vi.fn(async () => true);
beforeEach(() => {
  data = {}; request.mockClear();
  vi.stubGlobal('browser', { runtime: {}, permissions: { request }, storage: { local: {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(data, items); },
  } } });
});
test('keeps vault access off until explicitly saved and preserves later disable', async () => {
  expect((await loadAISettings()).useVault).not.toBe(true);
  const settings = { provider: 'anthropic' as const, enabled: true, apiKey: 'synthetic-key', model: 'claude-sonnet-5-5', useVault: true };
  await saveAISettings(settings);
  expect((await loadAISettings()).useVault).toBe(true);
  await saveAISettings({ ...settings, useVault: false });
  expect((await loadAISettings()).useVault).toBe(false);
});
test('requests native messaging together with Claude access only when vault use is selected', async () => {
  await requestAIPermission('anthropic', true);
  expect(request).toHaveBeenLastCalledWith({ origins: ['https://api.anthropic.com/*'], permissions: ['nativeMessaging'] });
  await requestAIPermission('anthropic');
  expect(request).toHaveBeenLastCalledWith({ origins: ['https://api.anthropic.com/*'] });
});
