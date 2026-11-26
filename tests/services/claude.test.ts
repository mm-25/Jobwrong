import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAIPermission, suggestAnswers } from '../../src/services/ai';
import { emptyProfile } from '../../src/shared/profile';
import type { AISettings, FieldPlan } from '../../src/shared/types';

const settings: AISettings = {
  provider: 'anthropic',
  enabled: true,
  apiKey: 'sk-ant-example',
  model: 'claude-sonnet-5-5',
};
const question: FieldPlan = {
  id: 'frame:team', label: 'Which team did you work on?', kind: 'select',
  status: 'unanswered', options: ['Design', 'Engineering'],
};

function claudeResponse(suggestions: unknown[], stopReason = 'end_turn') {
  return new Response(JSON.stringify({
    type: 'message', role: 'assistant', stop_reason: stopReason,
    content: [{ type: 'text', text: JSON.stringify({ suggestions }) }],
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Claude API suggestions', () => {
  it('requests permission for the selected provider', async () => {
    const request = vi.fn(async () => true);
    vi.stubGlobal('browser', { runtime: {}, permissions: { request } });

    await requestAIPermission('anthropic');
    await requestAIPermission('openai');

    expect(request.mock.calls).toEqual([
      [{ origins: ['https://api.anthropic.com/*'] }],
      [{ origins: ['https://api.openai.com/*'] }],
    ]);
  });

  it('uses Claude Messages with minimized profile data and a structured output schema', async () => {
    const contains = vi.fn(async () => true);
    vi.stubGlobal('browser', { runtime: {}, permissions: { contains } });
    const profile = emptyProfile();
    profile.personal.email = 'private@example.test';
    profile.applicationDefaults = { gender: 'decline' };
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      claudeResponse([{ fieldId: question.id, answer: 'Design' }]));
    vi.stubGlobal('fetch', fetcher);

    const result = await suggestAnswers(profile, [
      question,
      { ...question, id: 'never-send', label: 'Do you have a disability?' },
    ], settings);

    expect(contains).toHaveBeenCalledWith({ origins: ['https://api.anthropic.com/*'] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init).toMatchObject({
      method: 'POST', credentials: 'omit', redirect: 'error',
      headers: {
        Authorization: 'Bearer sk-ant-example',
        'Content-Type': 'application/json',
        'anthropic-version': '2026-10-21',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: settings.model, max_tokens: 2500,
      thinking: { type: 'between_tools' },
      messages: [{ role: 'user', content: expect.any(String) }],
      output_config: { format: { type: 'json_schema', schema: { required: ['suggestions'] } } },
    });
    for (const privateValue of ['sk-ant-example', 'private@example.test', 'gender', 'decline', 'never-send']) {
      expect(init.body).not.toContain(privateValue);
    }
    expect(result.suggestions).toEqual([{ fieldId: question.id, question: question.label, answer: 'Design' }]);
  });

  it('maps only distinct requested and valid choices to the exact form option', async () => {
    vi.stubGlobal('browser', { runtime: {}, permissions: { contains: async () => true } });
    const second = { ...question, id: 'frame:other' };
    vi.stubGlobal('fetch', async () => claudeResponse([
      { fieldId: second.id, answer: 'Marketing' },
      { fieldId: 'unknown', answer: 'Design' },
      { fieldId: question.id, answer: ' design ' },
      { fieldId: question.id, answer: 'Engineering' },
    ]));

    expect((await suggestAnswers(emptyProfile(), [question, second], settings)).suggestions)
      .toEqual([{ fieldId: question.id, question: question.label, answer: 'Design' }]);
  });

  it.each(['max_tokens', 'refusal'])('falls back after a Claude %s response', async stopReason => {
    vi.stubGlobal('browser', { runtime: {}, permissions: { contains: async () => true } });
    vi.stubGlobal('fetch', async () => claudeResponse([{ fieldId: question.id, answer: 'Design' }], stopReason));

    expect(await suggestAnswers(emptyProfile(), [question], settings)).toEqual({
      suggestions: [], error: expect.stringMatching(/local profile/i),
    });
  });

  it('aborts a pending request and retains local answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('browser', { runtime: {}, permissions: { contains: async () => true } });
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    const result = suggestAnswers(emptyProfile(), [question], settings);
    await vi.advanceTimersByTimeAsync(25000);
    expect(await result).toEqual({ suggestions: [], error: expect.stringMatching(/local profile/i) });
  });
});
