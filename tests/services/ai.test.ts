import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '../../src/shared/profile';
import { suggestAnswers } from '../../src/services/ai';
import type { FieldPlan } from '../../src/shared/types';
const settings = { enabled:true, apiKey:'sk-example-key', model:'gpt-4.1-mini' };
const question: FieldPlan = { id:'frame:field', label:'Describe your relevant experience', status:'unanswered', kind:'text' };
const response = (suggestions: unknown[]) => ({status:'completed', output:[{ type:'message', content:[{type:'output_text', text:JSON.stringify({suggestions})}]}]});
afterEach(() => vi.unstubAllGlobals());
function api() { vi.stubGlobal('browser', { runtime:{}, permissions:{ contains:async()=>true } }); }
describe('optional AI with local fallback', () => {
  it('does not contact a provider when AI is disabled or there are no eligible questions', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher);
    await suggestAnswers(emptyProfile(), [question], {...settings, enabled:false});
    await suggestAnswers(emptyProfile(), [{...question,status:'ready'}], settings);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns only requested eligible suggestions and omits keys, contact details, sensitive answers, and resume bytes from input', async () => {
    api(); const profile = emptyProfile(); profile.personal.email = 'PRIVATE@EXAMPLE.TEST';
    profile.answers = [{question:'Passport number', answer:'PRIVATE-ANSWER'}];
    profile.resume = {name:'resume.pdf',type:'application/pdf',dataUrl:'SECRET_FILE_BYTES',lastModified:0};
    let sent = '';
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      sent = init.body;
      return new Response(JSON.stringify(response([{fieldId:question.id, answer:'My experience is relevant.'},{fieldId:'invented',answer:'Wrong field'}])));
    }));
    const result = await suggestAnswers(profile,[question,{...question,id:'sensitive',sensitive:true}],settings);
    expect(result.suggestions).toEqual([{fieldId:question.id,question:question.label,answer:'My experience is relevant.'}]);
    for (const secret of ['sk-example-key','PRIVATE@EXAMPLE.TEST','PRIVATE-ANSWER','SECRET_FILE_BYTES']) expect(sent).not.toContain(secret);
    expect(JSON.parse(JSON.parse(sent).input)).not.toHaveProperty('applicationNotes');
    expect(profile.answers[0].answer).toBe('PRIVATE-ANSWER');
  });
  it('sends bounded application notes as Claude input to ground a motivation draft', async () => {
    api();
    const motivation = { ...question, label: 'What excites you about this opportunity?' };
    const answer = 'I’m excited to make the onboarding process easier to navigate.';
    const notes = 'I’m interested in designing clearer onboarding. ';
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({
      type: 'message', role: 'assistant', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ suggestions: [{ fieldId: motivation.id, answer }] }) }],
    })));
    vi.stubGlobal('fetch', fetcher);
    const result = await suggestAnswers(emptyProfile(), [motivation], { ...settings, provider: 'anthropic' }, `\n ${notes}${'x'.repeat(2100)}\t `);
    expect(result.suggestions).toEqual([{ fieldId: motivation.id, question: motivation.label, answer }]);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const payload = JSON.parse(String(init.body));
    expect(payload.system).toMatch(/motivation.*application notes/i);
    const input = JSON.parse(payload.messages[0].content);
    expect(input.applicationNotes).toBe(notes + 'x'.repeat(2000 - notes.length));
    expect(input.questions).toEqual([{ fieldId: motivation.id, question: motivation.label, options: [] }]);
    expect(payload.messages[0].content).not.toContain(settings.apiKey);

    await suggestAnswers(emptyProfile(), [motivation], { ...settings, provider: 'anthropic' }, ' \n\t ');
    const blank = JSON.parse(String(fetcher.mock.calls[1][1].body));
    expect(JSON.parse(blank.messages[0].content)).not.toHaveProperty('applicationNotes');
  });
  it('preserves local fill availability when offline, unauthorized, or rate-limited', async () => {
    api();
    for (const status of [401,429,500]) {
      vi.stubGlobal('fetch', vi.fn(async()=>new Response('',{status})));
      const result=await suggestAnswers(emptyProfile(),[question],settings);
      expect(result.suggestions).toEqual([]); expect(result.error).toMatch(/local/i);
    }
    vi.stubGlobal('fetch', vi.fn(async()=>{throw new TypeError('offline')}));
    expect((await suggestAnswers(emptyProfile(),[question],settings)).error).toMatch(/local/i);
  });
  it('rejects malformed or incomplete responses and ignores invalid option choices', async () => {
    api();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({status:'incomplete',output:[]}))));
    expect((await suggestAnswers(emptyProfile(),[question],settings)).suggestions).toEqual([]);
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(response([{fieldId:question.id,answer:'Mars'}])))));
    expect((await suggestAnswers(emptyProfile(),[{...question,kind:'select',options:['Earth','Venus']}],settings)).suggestions).toEqual([]);
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('garbage')));
    expect((await suggestAnswers(emptyProfile(),[question],settings)).error).toBeTruthy();
  });
});
