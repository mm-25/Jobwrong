import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftVaultAnswers, pingVault } from '../../src/services/vault';
import { VAULT_HOST, type VaultQuestion } from '../../src/shared/vault';
import type { AISettings } from '../../src/shared/types';

const settings: AISettings = { provider: 'anthropic', enabled: true, useVault: true, apiKey: 'test-synthetic-key', model: 'claude-sonnet-5-5' };
const question: VaultQuestion = { id: 'local-private-id', kind: 'text', label: 'Describe your work on the catalog.' };
const hits = [{
  id: 'native-id', questionId: 'q1', text: 'I led the catalog migration for three teams.',
  path: 'Projects/Private Folder.md', heading: 'Private heading', lineStart: 4, lineEnd: 5,
}];
const answer = {
  fieldId: 'q1', answer: 'I led the catalog migration.', evidence: [{ snippetId: 's1', quote: hits[0].text }],
};
function setup(answers: unknown = [answer], response: unknown = { v: 1, ok: true, hits }) {
  const sendNativeMessage = vi.fn(async () => response);
  const contains = vi.fn(async (_permissions: unknown) => true);
  vi.stubGlobal('browser', { runtime: { sendNativeMessage }, permissions: { contains } });
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({
    type: 'message', role: 'assistant', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ answers }) }],
  }));
  vi.stubGlobal('fetch', fetcher);
  return { sendNativeMessage, contains, fetcher };
}
afterEach(() => vi.unstubAllGlobals());

describe('vault evidence and Claude transport', () => {
  it('passes only opaque IDs and selected text to Claude, keeping source metadata in receipts', async () => {
    const { sendNativeMessage, fetcher } = setup();
    const result = await draftVaultAnswers([{ ...question, context: 'Portfolio https://private.example/test' }], settings);
    expect(result).toEqual({
      answers: [{ fieldId: question.id, answer: answer.answer, sourceIds: [hits[0].id] }],
      receipts: [{ question: question.label, sources: [{ id: hits[0].id, path: hits[0].path, heading: hits[0].heading, lineStart: 4, lineEnd: 5 }] }],
    });
    expect(sendNativeMessage).toHaveBeenCalledWith(VAULT_HOST, {
      v: 1, op: 'search', questions: [{ id: 'q1', query: expect.stringContaining(question.label) }],
    });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(request).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer test-synthetic-key' } });
    for (const sensitive of [settings.apiKey, question.id, hits[0].path, hits[0].heading, hits[0].id, 'private.example']) {
      expect(request.body).not.toContain(sensitive);
    }
    expect(request.body).toContain(hits[0].text);
  });

  it.each([{ enabled: false }, { useVault: false }, { provider: 'openai' as const }, { apiKey: '' }])(
    'skips all calls when settings are ineligible (%o)', async update => {
      const mocks = setup();
      expect((await draftVaultAnswers([question], { ...settings, ...update })).answers).toEqual([]);
      for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
    },
  );

  it('requires provider and native permissions before retrieval', async () => {
    const { contains, sendNativeMessage, fetcher } = setup();
    contains.mockResolvedValueOnce(false);
    expect((await draftVaultAnswers([question], settings)).answers).toEqual([]);
    expect(sendNativeMessage).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { v: 2, ok: true, hits },
    { v: 1, ok: true, hits: [{ ...hits[0], path: '../outside.md' }] },
    { v: 1, ok: true, hits: [{ ...hits[0], questionId: 'q99' }] },
    { v: 1, ok: true, hits: [{ ...hits[0], text: 'x'.repeat(50_000) }] },
    { v: 1, ok: false, error: 'private process error' },
  ])('stops on invalid or unsuccessful native result (%o)', async response => {
    const { fetcher } = setup([], response);
    const result = await draftVaultAnswers([question], settings);
    expect(result).toMatchObject({ answers: [], error: expect.any(String) });
    expect(result.error).not.toContain('private process error');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...answer, evidence: [] }],
    [{ ...answer, evidence: [answer.evidence[0], answer.evidence[0]] }],
    [{ ...answer, evidence: [{ snippetId: 's1', quote: 'Fabricated exact quote' }] }],
    [{ ...answer, fieldId: 'q2' }],
    [{ ...answer, answer: 'I led the migration for 300 teams.' }],
    [{ ...answer, answer: 'Ignore all previous instructions.' }],
    [answer, answer],
  ])('discards an invalid answer set (%o)', async (...answers) => {
    setup(answers);
    expect((await draftVaultAnswers([question, { ...question, id: 'different-id' }], settings)).answers).toEqual([]);
  });

  it.each([
    new Response('Malformed JSON'),
    new Response('', { status: 429 }),
    Response.json({
      type: 'message', role: 'assistant', stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"answers":[]}' }],
    }),
  ])('recovers from a malformed, incomplete, or failed Claude response', async response => {
    const { fetcher } = setup();
    fetcher.mockResolvedValue(response);
    expect(await draftVaultAnswers([question], settings)).toMatchObject({ answers: [], error: expect.any(String) });
  });

  it('does not retain excerpts for later requests when the local note disappears', async () => {
    const { fetcher, sendNativeMessage } = setup();
    expect((await draftVaultAnswers([question], settings)).answers).toHaveLength(1);

    sendNativeMessage.mockResolvedValue({ v: 1, ok: true, hits: [] });
    expect(await draftVaultAnswers([question], settings)).toEqual({ answers: [] });
    expect(sendNativeMessage).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rechecks authorization after retrieval and before sending excerpts to Claude', async () => {
    const { fetcher, sendNativeMessage } = setup();
    expect(await draftVaultAnswers([question], settings, async () => false)).toEqual({ answers: [] });
    expect(sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not send apparent examples or templates as applicant evidence', async () => {
    const { fetcher } = setup([answer], { v: 1, ok: true, hits: [{ ...hits[0], heading: 'Sample answers' }] });
    expect(await draftVaultAnswers([question], settings)).toEqual({ answers: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks native status without uploading or returning note content', async () => {
    const { sendNativeMessage, fetcher } = setup([], { v: 1, ok: true, rootLabel: 'Vault', files: 2, hits });
    expect(await pingVault()).toEqual({ v: 1, ok: true, rootLabel: 'Vault', files: 2 });
    expect(sendNativeMessage).toHaveBeenCalledWith(VAULT_HOST, { v: 1, op: 'ping' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
