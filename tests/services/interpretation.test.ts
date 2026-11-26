import { afterEach, describe, expect, it, vi } from 'vitest';
import { interpretQuestions } from '../../src/services/interpretation';
import type { InterpretationQuestion } from '../../src/shared/interpretation';
import type { AISettings } from '../../src/shared/types';

const claude: AISettings = {
  provider: 'anthropic', enabled: true, apiKey: 'sk-ant-synthetic-test', model: 'claude-sonnet-5-5',
};
const openai: AISettings = { enabled: true, apiKey: 'sk-synthetic-test', model: 'gpt-4.1-mini' };
const relocation: InterpretationQuestion = {
  id: 'local:relocation', kind: 'radio', label: 'Is moving for this position off the table?',
  options: ['Yes', 'No'],
};
const authorization: InterpretationQuestion = {
  id: 'local:authorization', kind: 'radio',
  label: 'Could you take up employment in Canada without additional permission?',
  context: 'Employment eligibility', options: ['Yes', 'No'],
};
const relocationMeaning = {
  fact: 'relocation', inverse: true, country: null, confidence: 'high',
  evidence: 'moving for this position off the table',
};
const authorizationMeaning = {
  fact: 'workAuthorization', inverse: false, country: 'Canada', confidence: 'high',
  evidence: 'take up employment in Canada',
};

function grantPermission(granted = true, firefox = false) {
  const contains = vi.fn(async () => granted);
  const request = vi.fn(async () => true);
  vi.stubGlobal('browser', {
    runtime: firefox ? { getBrowserInfo: async () => ({}) } : {},
    permissions: { contains, request },
  });
  return { contains, request };
}

function claudeEnvelope(text: string, stopReason = 'end_turn') {
  return { type: 'message', role: 'assistant', stop_reason: stopReason, content: [{ type: 'text', text }] };
}

function openaiEnvelope(text: string) {
  return {
    status: 'completed', output: [{
      type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }],
    }],
  };
}

function claudeMeanings(meanings: unknown[]) {
  vi.stubGlobal('fetch', async () => Response.json(claudeEnvelope(JSON.stringify({ meanings }))));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('question interpretation', () => {
  it('sends only question data and uses the configured Claude structured output', async () => {
    const { contains, request } = grantPermission(true, true);
    const question = {
      ...relocation, url: 'https://application.example/job', currentValue: 'Previously Selected',
      profile: { email: 'private@example.test' },
      context: 'Work preferences · https://application.example/job',
    };
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json(claudeEnvelope(
      JSON.stringify({ meanings: [{ fieldId: 'q1', ...relocationMeaning }] }),
    )));
    vi.stubGlobal('fetch', fetcher);

    expect(await interpretQuestions([question], claude)).toEqual({
      meanings: [{ fieldId: 'local:relocation', ...relocationMeaning }],
    });
    expect(contains).toHaveBeenCalledWith({
      origins: ['https://api.anthropic.com/*'],
      data_collection: ['personallyIdentifyingInfo', 'websiteContent', 'authenticationInfo'],
    });
    expect(request).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init).toMatchObject({
      method: 'POST', credentials: 'omit', redirect: 'error',
      headers: {
        Authorization: 'Bearer sk-ant-synthetic-test',
        'anthropic-version': '2026-10-21',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'claude-sonnet-5-5', thinking: { type: 'between_tools' },
      output_config: { format: { type: 'json_schema', schema: { required: ['meanings'] } } },
    });
    expect(JSON.parse(body.messages[0].content)).toEqual({ questions: [{
      id: 'q1', kind: 'radio', label: 'Is moving for this position off the table?',
      options: ['Yes', 'No'], context: expect.stringContaining('Work preferences'),
    }] });
    for (const privateValue of [question.id, question.url, question.currentValue, question.profile.email, claude.apiKey]) {
      expect(init.body).not.toContain(privateValue);
    }
  });

  it('routes legacy credentials to OpenAI and keeps explicit country wording', async () => {
    const { contains } = grantPermission();
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json(openaiEnvelope(
      JSON.stringify({ meanings: [{ fieldId: 'q1', ...authorizationMeaning }] }),
    )));
    vi.stubGlobal('fetch', fetcher);

    expect(await interpretQuestions([authorization], openai)).toEqual({
      meanings: [{ fieldId: 'local:authorization', ...authorizationMeaning }],
    });
    expect(contains).toHaveBeenCalledWith({ origins: ['https://api.openai.com/*'] });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-4.1-mini', store: false,
      text: { format: { type: 'json_schema', strict: true, schema: { required: ['meanings'] } } },
    });
    expect(init.body).not.toContain(openai.apiKey);
  });

  it('removes protocol-relative URLs from every question text field', async () => {
    grantPermission();
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json(claudeEnvelope('{"meanings":[]}')));
    vi.stubGlobal('fetch', fetcher);

    await interpretQuestions([{
      ...relocation,
      label: `${relocation.label} //application.example/job?private=label`,
      context: '//candidate.example/dashboard?private=context Work preferences',
      options: ['Yes', 'No //application.example/choice?private=option'],
    }], claude);

    const payload = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(JSON.parse(payload.messages[0].content).questions).toEqual([{
      id: 'q1', kind: 'radio', label: relocation.label, context: 'Work preferences', options: ['Yes', 'No'],
    }]);
  });

  it('skips uncertain, unknown, and duplicate mappings even if the first duplicate looks valid', async () => {
    grantPermission();
    const another = { ...relocation, id: 'local:another' };
    claudeMeanings([
      { fieldId: 'q1', ...relocationMeaning },
      { fieldId: 'q1', ...relocationMeaning, confidence: 'uncertain' },
      { fieldId: 'q2', ...authorizationMeaning },
      { fieldId: 'q3', ...relocationMeaning, confidence: 'uncertain' },
      { fieldId: 'unknown', ...relocationMeaning },
    ]);

    expect(await interpretQuestions([relocation, authorization, another], claude)).toEqual({
      meanings: [{ fieldId: 'local:authorization', ...authorizationMeaning }],
    });
  });

  it.each([
    ['unknown fact', { fact: 'password' }],
    ['non-boolean inverse', { inverse: 'false' }],
    ['unsupported confidence', { confidence: 'certain' }],
    ['invented evidence', { evidence: 'take up work in Canada' }],
    ['option-only evidence', { evidence: 'Yes' }],
    ['partial-word evidence', { evidence: 'employ' }],
    ['missing country', { country: null }],
    ['country absent from the supplied text', { country: 'US' }],
    ['non-country wording', { country: 'employment' }],
    ['model-generated answer', { answer: 'Yes' }],
    ['hostile extra property', JSON.parse('{"__proto__":{"injected":true}}')],
  ])('discards a mapping with %s', async (_name, changed) => {
    grantPermission();
    claudeMeanings([{ fieldId: 'q1', ...authorizationMeaning, ...changed }]);

    expect((await interpretQuestions([authorization], claude)).meanings).toEqual([]);
  });

  it('does not send an ambiguous input field ID', async () => {
    grantPermission();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    expect((await interpretQuestions([relocation, { ...authorization, id: relocation.id }], claude)).meanings)
      .toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a sponsorship country that quotes the lowercase pronoun us', async () => {
    grantPermission();
    const question = { ...relocation, label: 'Is employer visa sponsorship something you will need to work for us?' };
    claudeMeanings([{
      fieldId: 'q1', fact: 'visaSponsorship', inverse: false, country: 'us',
      confidence: 'high', evidence: 'employer visa sponsorship',
    }]);

    expect(await interpretQuestions([question], claude)).toEqual({ meanings: [] });
  });

  it.each(['US', 'U.S.', 'United States'])('accepts literal sponsorship country wording %s', async country => {
    grantPermission();
    const question = { ...relocation, label: `Is employer visa sponsorship something you will need to work in the ${country}?` };
    const meaning = {
      fact: 'visaSponsorship', inverse: false, country, confidence: 'high', evidence: 'employer visa sponsorship',
    };
    claudeMeanings([{ fieldId: 'q1', ...meaning }]);

    expect(await interpretQuestions([question], claude)).toEqual({
      meanings: [{ fieldId: question.id, ...meaning }],
    });
  });

  it('does not reach the provider when AI or question interpretation is disabled', async () => {
    const { contains } = grantPermission();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    await interpretQuestions([relocation], { ...claude, enabled: false });
    await interpretQuestions([relocation], { ...claude, interpretQuestions: false });
    await interpretQuestions([relocation], { ...claude, apiKey: '' });
    await interpretQuestions([], claude);
    expect(contains).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back without prompting when provider access is missing', async () => {
    const { request } = grantPermission(false);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    expect(await interpretQuestions([relocation], claude)).toEqual({
      meanings: [], error: expect.stringMatching(/access.*local profile/i),
    });
    expect(request).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('limits classification to twenty questions per request', async () => {
    grantPermission();
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json(claudeEnvelope('{"meanings":[]}')));
    vi.stubGlobal('fetch', fetcher);
    const questions = Array.from({ length: 23 }, (_, index) => ({ ...relocation, id: `local:${index}` }));

    await interpretQuestions(questions, claude);

    const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(JSON.parse(body.messages[0].content).questions).toHaveLength(20);
  });

  it('does not send an oversized UTF-8 payload', async () => {
    grantPermission();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const questions = Array.from({ length: 20 }, (_, index) => ({
      ...relocation, id: `local:${index}`, options: Array.from({ length: 15 }, (_, option) => 'あ'.repeat(135) + option),
    }));

    expect(await interpretQuestions(questions, claude)).toEqual({
      meanings: [], error: expect.stringMatching(/large.*local profile/i),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never includes the configured API key if a question repeats it', async () => {
    grantPermission();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    expect((await interpretQuestions([{ ...relocation, context: claude.apiKey }], claude)).meanings).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid JSON', 'arbitrary text'],
    ['incomplete envelope', JSON.stringify(claudeEnvelope('{"meanings":[]}', 'max_tokens'))],
    ['malformed content', JSON.stringify({ ...claudeEnvelope(''), content: [null] })],
    ['unexpected top-level keys', JSON.stringify(claudeEnvelope('{"meanings":[],"answer":"Yes"}'))],
    ['missing meanings', JSON.stringify(claudeEnvelope('{"suggestions":[]}'))],
    ['oversized output', JSON.stringify(claudeEnvelope(' '.repeat(100_001) + '{"meanings":[]}'))],
  ])('falls back on %s', async (_name, raw) => {
    grantPermission();
    vi.stubGlobal('fetch', async () => new Response(raw));

    expect(await interpretQuestions([relocation], claude)).toEqual({
      meanings: [], error: expect.stringMatching(/local profile/i),
    });
  });

  it('rejects a completed OpenAI response containing a refusal', async () => {
    grantPermission();
    const envelope = openaiEnvelope(JSON.stringify({ meanings: [{ fieldId: 'q1', ...relocationMeaning }] }));
    envelope.output[0].content.push({ type: 'refusal', text: 'Refused' });
    vi.stubGlobal('fetch', async () => Response.json(envelope));

    expect(await interpretQuestions([relocation], openai)).toEqual({
      meanings: [], error: expect.stringMatching(/local profile/i),
    });
  });

  it('cancels an oversized response without reading the rest of the stream', async () => {
    grantPermission();
    const cancel = vi.fn();
    let pulls = 0;
    const chunk = new TextEncoder().encode('あ'.repeat(20_000));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++pulls <= 5) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    });
    vi.stubGlobal('fetch', async () => new Response(stream));

    expect(await interpretQuestions([relocation], claude)).toEqual({
      meanings: [], error: expect.stringMatching(/local profile/i),
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pulls).toBeLessThan(5);
  });

  it('decodes a UTF-8 evidence quote split across stream chunks', async () => {
    grantPermission();
    const question = { ...relocation, label: 'Is moving to Québec for this position off the table?' };
    const evidence = 'moving to Québec for this position off the table';
    const text = JSON.stringify(claudeEnvelope(JSON.stringify({ meanings: [{ fieldId: 'q1', ...relocationMeaning, evidence }] })));
    const bytes = new TextEncoder().encode(text);
    const split = bytes.indexOf(0xc3) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', async () => new Response(stream));

    expect(await interpretQuestions([question], claude)).toEqual({
      meanings: [{ fieldId: relocation.id, ...relocationMeaning, evidence }],
    });
  });

  it.each([401, 429, 500])('falls back after provider HTTP %i', async status => {
    grantPermission();
    vi.stubGlobal('fetch', async () => new Response('', { status }));

    expect(await interpretQuestions([relocation], claude)).toEqual({
      meanings: [], error: expect.stringMatching(/local profile/i),
    });
  });

  it('falls back when offline', async () => {
    grantPermission();
    vi.stubGlobal('fetch', async () => { throw new TypeError('Network offline'); });

    expect(await interpretQuestions([relocation], claude)).toEqual({
      meanings: [], error: expect.stringMatching(/local profile/i),
    });
  });

  it('aborts after twenty-five seconds while keeping local autofill available', async () => {
    vi.useFakeTimers();
    grantPermission();
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetcher);

    const result = interpretQuestions([relocation], claude);
    await vi.advanceTimersByTimeAsync(24_999);
    const signal = fetcher.mock.calls[0][1].signal;
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(signal?.aborted).toBe(true);
    expect(await result).toEqual({ meanings: [], error: expect.stringMatching(/time.*local profile/i) });
  });
});
