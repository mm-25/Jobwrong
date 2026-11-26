import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '../../src/shared/profile';
import type { FrameScan } from '../../src/shared/types';
let tab = { id: 7, url: 'https://jobs.example.test/apply' };
let calls: any[] = [];
const scan = { scanId:'doc-plan', platform:'Lever', frameUrl:'https://jobs.example.test/apply', fields:[], warnings:[] };
beforeEach(() => { tab={id:7,url:scan.frameUrl}; calls=[]; vi.resetModules();
  vi.stubGlobal('browser', { runtime:{}, tabs:{query:async()=>[tab]}, scripting:{ executeScript:async (details:any)=>{
    calls.push(details);
    return [{frameId:0,result:details.files?undefined:structuredClone(scan)}];
  } } });
});
afterEach(()=>vi.unstubAllGlobals());
describe('extension tab binding',()=>{
  it('rejects restricted pages before injecting profile data',async()=>{
    tab.url='about:config'; const {scanActiveTab}=await import('../../src/services/browser');
    await expect(scanActiveTab(emptyProfile())).rejects.toThrow(/web tab/);
    expect(calls).toHaveLength(0);
  });
  it('binds a preview to its tab and rejects filling another tab',async()=>{
    const {scanActiveTab,fillActiveTab}=await import('../../src/services/browser');
    const preview=await scanActiveTab(emptyProfile());
    expect(preview[0].tabId).toBe(7);
    tab.id=8; calls=[];
    await expect(fillActiveTab(preview)).rejects.toThrow(/tab changed/);
    expect(calls).toHaveLength(0);
  });
  it('rejects accepted AI suggestions after tab navigation',async()=>{
    const {scanActiveTab}=await import('../../src/services/browser');
    await scanActiveTab(emptyProfile()); tab.url='https://jobs.example.test/other'; calls=[];
    await expect(scanActiveTab(emptyProfile(),{}, {0:{field:'answer'}})).rejects.toThrow(/tab changed/);
    expect(calls).toHaveLength(0);
  });
  it('retains earlier reviewed suggestions when the applicant approves another question',async()=>{
    const acceptedArguments:Record<string,string>[]=[];
    vi.stubGlobal('browser',{runtime:{},tabs:{query:async()=>[tab]},scripting:{executeScript:async(details:any)=>{
      if(details.files)return [{frameId:0}];
      const accepted=details.args[1].reviewedAnswers??{};
      acceptedArguments.push(accepted);
      return [{frameId:0,result:{...scan,fields:['a','b'].map(id=>({id,label:'Describe your work '+id,kind:'text',status:accepted[id]?'ready':'unanswered',aiEligible:!accepted[id]}))}}];
    }}});
    const {scanActiveTab}=await import('../../src/services/browser');
    await scanActiveTab(emptyProfile());
    await scanActiveTab(emptyProfile(),{},{0:{a:'First approved answer'}});
    await scanActiveTab(emptyProfile(),{},{0:{a:'First approved answer',b:'Second approved answer'}});
    expect(acceptedArguments.at(-1)).toEqual({a:'First approved answer',b:'Second approved answer'});
  });
  it('strips unknown secrets from injected profiles and keeps arguments JSON serializable',async()=>{
    const {scanActiveTab}=await import('../../src/services/browser');
    await scanActiveTab({...emptyProfile(),apiKey:'secret'} as any);
    const args=calls.find(c=>c.args).args;
    expect(JSON.stringify(args)).not.toContain('secret');
    expect(args.some((arg:unknown)=>arg===undefined)).toBe(false);
  });
  it('does not treat an explicit empty selection as select all',async()=>{
    const {fillActiveTab}=await import('../../src/services/browser');
    const frames: FrameScan[]=[{tabId:7,frameId:0,result:scan}];
    expect(await fillActiveTab(frames,{})).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it('records only the selected frames for undo and retains that batch after popup module reload',async()=>{
    const embedded = { ...scan, scanId: 'frame-plan' };
    const undoCalls: number[] = [];
    const worlds = new Map([0, 2].map(frameId => [frameId, {
      __jobrightLocal: {
        scan: async () => frameId === 0 ? scan : embedded,
        fill: async () => ({ entries: [], filled: 1, skipped: 0, failed: 0, needsRescan: true }),
        undo: async () => { undoCalls.push(frameId); return { restored: 1, skipped: 0 }; },
      },
    }]));
    vi.stubGlobal('browser', { runtime: {}, tabs: { query: async () => [tab] }, scripting: {
      executeScript: async ({ target, files, func, args = [] }: {
        target: { frameIds: number[] }; files?: string[]; func: (...args: unknown[]) => unknown; args?: unknown[];
      }) => {
        if (files) return [{ frameId: 0 }, { frameId: 2 }];
        const [frameId] = target.frameIds;
        const invoke = new Function('globalThis', 'location', 'document', 'args', `return (${func})(...args);`);
        return [{ frameId, result: await invoke(worlds.get(frameId), { href: tab.url }, { querySelectorAll: () => [] }, args) }];
      },
    } });
    const { fillActiveTab, scanActiveTab } = await import('../../src/services/browser');
    await fillActiveTab(await scanActiveTab(emptyProfile()), { 0: ['selected-field'] });
    vi.resetModules();
    const {undoActiveTab}=await import('../../src/services/browser');
    expect(await undoActiveTab()).toEqual([{restored:1,skipped:0}]);
    expect(undoCalls).toEqual([0]);
  });
  it('continues undoing the batch when one frame disappears and reports the missing frame',async()=>{
    const batch={url:tab.url,frames:[{frameId:2,scanId:'gone',frameUrl:tab.url},{frameId:0,scanId:'still-here',frameUrl:tab.url}]};
    vi.stubGlobal('browser',{runtime:{},tabs:{query:async()=>[tab]},scripting:{executeScript:async(details:any)=>{
      if(!details.args)return [{frameId:0,result:batch}];
      if(details.target.frameIds[0]===2)throw new Error('No frame');
      return [{frameId:0,result:{restored:2,skipped:0}}];
    }}});
    const {undoActiveTab}=await import('../../src/services/browser');
    const results=await undoActiveTab();
    expect(results).toContainEqual({restored:2,skipped:0});
    expect(results.some(result=>result.warning?.includes('frame'))).toBe(true);
  });
});
