import { explicitCountryKey } from './answer-formats';
import { labelText, normalize, visible } from './discovery';

interface JobBinding {
  url: string; origin: string; site: string; slug: string; endpoint: string;
  page: Element; heading: Element; title: string;
  step?: Element; stepTitle: string; forms: Element[];
}
interface Receipt { binding: JobBinding; country?: string; at: number }
const receipts = new WeakMap<Document, Receipt>();
const pending = new WeakMap<Document, { binding: JobBinding; promise: Promise<void> }>();
const pageSelector = '[data-automation-id="applyFlowPage"]';

function jobPath(url: URL, applying: boolean): { site: string; location: string; slug: string } | undefined {
  const pattern = applying
    ? /^\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job\/([^/]+)\/([^/]+)\/apply\/?$/
    : /^\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job\/([^/]+)\/([^/]+)\/?$/;
  const parts = pattern.exec(url.pathname)?.slice(1).map(part => decodeURIComponent(part));
  if (!parts || parts.some(part => !part || part.length > 240 || /[\/\\\x00-\x1f]/.test(part))
    || !/^[a-z0-9_-]+$/i.test(parts[0])) return undefined;
  return { site: parts[0], location: parts[1], slug: parts[2] };
}

function binding(doc: Document): JobBinding | undefined {
  try {
    const url = new URL(doc.URL), tenant = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i.exec(url.hostname)?.[1];
    if (!tenant || url.protocol !== 'https:' || url.username || url.password) return undefined;
    const path = jobPath(url, true);
    const pages = [...doc.querySelectorAll(pageSelector)].filter(visible);
    if (!path || pages.length !== 1) return undefined;
    const headings = [...pages[0].querySelectorAll('[data-automation-id="jobTitleHeading"]')].filter(visible);
    const title = headings.length === 1 && labelText(headings[0]);
    if (!title || title.length > 500 || headings[0].querySelector('input, textarea, select, button, [contenteditable]')) return undefined;
    const steps = [...pages[0].querySelectorAll('h3')].filter(visible);
    if (steps.length > 1) return undefined;
    const step = steps[0], stepTitle = step ? labelText(step) : '';
    const forms = [...pages[0].querySelectorAll('form')].filter(visible);
    const endpoint = `${url.origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(path.site)}/job/${encodeURIComponent(path.location)}/${encodeURIComponent(path.slug)}`;
    return { url: doc.URL, origin: url.origin, site: path.site, slug: path.slug, endpoint, page: pages[0], heading: headings[0], title,
      step, stepTitle, forms };
  } catch { return undefined; }
}

function same(a: JobBinding, b?: JobBinding): boolean {
  return !!b && a.url === b.url && a.page === b.page && a.heading === b.heading && a.title === b.title
    && a.step === b.step && a.stepTitle === b.stepTitle
    && a.forms.length === b.forms.length && a.forms.every((form, i) => form === b.forms[i]);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function countryFromResponse(data: unknown, source: JobBinding): string | undefined {
  const info = record(record(data)?.jobPostingInfo), location = record(info?.jobRequisitionLocation);
  const primary = record(info?.country), country = record(location?.country);
  if (!info || typeof info.title !== 'string' || normalize(info.title) !== normalize(source.title)
    || typeof info.externalUrl !== 'string' || typeof info.jobReqId !== 'string' || !/^[a-z0-9_.-]{1,80}$/i.test(info.jobReqId)
    || typeof info.location !== 'string' || info.location !== location?.descriptor
    || typeof country?.alpha2Code !== 'string' || !/^[A-Z]{2}$/.test(country.alpha2Code)
    || typeof primary?.descriptor !== 'string' || typeof country.descriptor !== 'string'
    || typeof primary.id !== 'string' || !primary.id || primary.id !== country.id) return undefined;
  const code = country.alpha2Code;
  if (explicitCountryKey(primary.descriptor) !== code || explicitCountryKey(country.descriptor) !== code) return undefined;
  // A primary location is insufficient when the posting also lists alternatives.
  for (const name of ['additionalLocations', 'additionalJobRequisitionLocations', 'locations']) {
    if (info[name] != null && (!Array.isArray(info[name]) || (info[name] as unknown[]).length)) return undefined;
  }
  const external = new URL(info.externalUrl), canonical = jobPath(external, false);
  const req = info.jobReqId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (external.origin !== source.origin || external.username || external.password || !canonical
    || canonical.site !== source.site || canonical.slug !== source.slug || !new RegExp(`_${req}(?:-\\d+)?$`).test(source.slug)) return undefined;
  return code;
}

/** Public job metadata only: no profile, cookies, form values or API keys. */
export function loadWorkdayJobCountry(doc: Document): Promise<void> | undefined {
  const source = binding(doc);
  if (!source) return undefined;
  const receipt = receipts.get(doc);
  if (receipt && same(receipt.binding, source) && Date.now() - receipt.at < (receipt.country ? 300_000 : 30_000)) return undefined;
  const running = pending.get(doc);
  if (running && same(running.binding, source)) return running.promise;
  const promise = (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3_000);
    let country: string | undefined;
    try {
      const response = await fetch(source.endpoint, { method: 'GET', credentials: 'omit', redirect: 'error',
        referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok || response.redirected || response.url !== source.endpoint
        || !response.headers.get('content-type')?.includes('application/json')) return;
      const raw = await response.text();
      if (raw.length > 512_000) return;
      country = countryFromResponse(JSON.parse(raw), source);
    } catch { /* Unavailable or unverified metadata leaves the question unanswered. */ }
    finally {
      clearTimeout(timer);
      if (!same(source, binding(doc))) throw new Error('The application changed while job information was loading. Click Autofill on the current page.');
      receipts.set(doc, { binding: source, country, at: Date.now() });
    }
  })();
  pending.set(doc, { binding: source, promise });
  const cleanup = () => { if (pending.get(doc)?.promise === promise) pending.delete(doc); };
  void promise.then(cleanup, cleanup);
  return promise;
}

export function workdayJobCountry(element: Element): string | undefined {
  const receipt = receipts.get(element.ownerDocument);
  return receipt?.country && Date.now() - receipt.at < 300_000 && receipt.binding.page.contains(element)
    && same(receipt.binding, binding(element.ownerDocument)) ? receipt.country : undefined;
}
