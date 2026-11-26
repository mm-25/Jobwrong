// @vitest-environment-options {"url":"https://example.wd5.myworkdayjobs.com/en-US/Careers/job/USA-CO-Boulder/Designer_JR-123-1/apply"}
import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const path = '/en-US/Careers/job/USA-CO-Boulder/Designer_JR-123-1/apply';
const endpoint = 'https://example.wd5.myworkdayjobs.com/wday/cxs/example/Careers/job/USA-CO-Boulder/Designer_JR-123-1';
const profile = { ...emptyProfile(), personal: { ...emptyProfile().personal, country: 'Canada' },
  workAuthorizations: [{ country: 'United States', authorized: true }, { country: 'Canada', authorized: false }] };
const body = () => ({ jobPostingInfo: {
  title: 'Designer', jobReqId: 'JR-123', externalUrl: 'https://example.wd5.myworkdayjobs.com/Careers/job/USA-CO-Boulder/Designer_JR-123-1',
  location: 'USA, CO, Boulder', country: { descriptor: 'United States of America', id: 'us-id' },
  jobRequisitionLocation: { descriptor: 'USA, CO, Boulder', country: { descriptor: 'United States of America', id: 'us-id', alpha2Code: 'US' } },
} });
function reply(data: unknown = body(), extra = {}) {
  return { ok: true, redirected: false, url: endpoint, headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(data), ...extra } as Response;
}
function application() {
  history.replaceState(null, '', path);
  document.body.innerHTML = `<main><div data-automation-id="applyFlowPage"><h2 data-automation-id="jobTitleHeading">Designer</h2>
    <h3>Application Questions 1 of 2</h3><form>
    <label>Are you authorized to work in the country where this job is located?<select>
      <option value="">Select One</option><option>Yes</option><option>No</option></select></label></form></div></main>`;
  return createEngine(document);
}
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

test('uses public metadata for the exact job, not applicant residence, and caches the receipt', async () => {
  const engine = application(), request = vi.fn(async () => reply()); vi.stubGlobal('fetch', request);
  const plan = await engine.scan(profile);
  expect(request).toHaveBeenCalledWith(endpoint, expect.objectContaining({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }));
  expect(plan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(document.querySelector('select')!.value).toBe('Yes');
  await engine.scan(profile);
  expect(request).toHaveBeenCalledTimes(1);
});

test.each(['wrong job', 'wrong title', 'different country', 'multiple locations', 'missing country', 'unverified descriptor', 'redirect'])(
  'does not ground authorization from %s', async problem => {
    const engine = application(), data = body();
    if (problem === 'wrong job') data.jobPostingInfo.externalUrl = data.jobPostingInfo.externalUrl.replace('JR-123-1', 'JR-999-1');
    if (problem === 'wrong title') data.jobPostingInfo.title = 'Different job';
    if (problem === 'different country') data.jobPostingInfo.country.descriptor = 'Canada';
    if (problem === 'multiple locations') Object.assign(data.jobPostingInfo, { additionalLocations: ['Toronto, Canada'] });
    if (problem === 'missing country') data.jobPostingInfo.jobRequisitionLocation.country.alpha2Code = '';
    if (problem === 'unverified descriptor') data.jobPostingInfo.jobRequisitionLocation.descriptor = 'Several locations';
    vi.stubGlobal('fetch', vi.fn(async () => reply(data, problem === 'redirect' ? { redirected: true } : {})));
    const plan = await engine.scan(profile);
    expect(plan.fields[0].status).not.toBe('ready');
  },
);

test('leaves the question unanswered when the public lookup is unavailable', async () => {
  const engine = application(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline'); }));
  const plan = await engine.scan(profile);
  expect(plan.fields[0].status).not.toBe('ready');
});

test('a changed job heading invalidates the planned authorization', async () => {
  const engine = application(); vi.stubGlobal('fetch', vi.fn(async () => reply()));
  const plan = await engine.scan(profile);
  expect(plan.fields[0].status).toBe('ready');
  document.querySelector('h2')!.textContent = 'A different job';
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 0, skipped: 1 });
});

test('preserves a manual answer entered while public metadata loads', async () => {
  const engine = application(); let deliver!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; })));
  const pending = engine.scan(profile);
  await Promise.resolve();
  const select = document.querySelector('select')!; select.value = 'No'; select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(deliver).toBeTypeOf('function'); deliver(reply());
  const plan = await pending;
  expect(plan.fields[0].status).not.toBe('ready');
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 0 });
  expect(select.value).toBe('No');
});

test('does not request metadata for an explicit-country question', async () => {
  const engine = application(), request = vi.fn(async () => reply()); vi.stubGlobal('fetch', request);
  document.querySelector('label')!.firstChild!.nodeValue = 'Are you authorized to work in the United States?';
  const plan = await engine.scan(profile);
  expect(plan.fields[0].status).toBe('ready');
  expect(request).not.toHaveBeenCalled();
});

test.each(['job', 'step', 'form', 'page'])('rejects a changed %s while metadata loads', async change => {
  const engine = application(); let deliver!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; })));
  const scanning = engine.scan(profile);
  const rejected = expect(scanning).rejects.toThrow(/application changed/i);
  await Promise.resolve();
  if (change === 'job') history.replaceState(null, '', path.replace('JR-123-1', 'JR-999-1'));
  if (change === 'step') document.querySelector('h3')!.textContent = 'Application Questions 2 of 2';
  if (change === 'form') document.querySelector('form')!.replaceWith(document.querySelector('form')!.cloneNode(true));
  if (change === 'page') document.querySelector('[data-automation-id="applyFlowPage"]')!.replaceWith(document.querySelector('[data-automation-id="applyFlowPage"]')!.cloneNode(true));
  deliver(reply());
  await rejected;
  expect(document.querySelector('select')!.value).toBe('');
});

test('preserves a manual clear during metadata lookup even without an Autofill run marker', async () => {
  const engine = application(); let deliver!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; })));
  const scanning = engine.scan(profile);
  await Promise.resolve();
  const select = document.querySelector('select')!;
  select.value = 'No'; select.dispatchEvent(new Event('change', { bubbles: true }));
  select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true }));
  deliver(reply());
  const plan = await scanning;
  expect(plan.fields[0]).toMatchObject({ status: 'preserved' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 0 });
  expect(select.value).toBe('');
});
