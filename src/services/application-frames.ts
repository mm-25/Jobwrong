import type { EmbeddedApplicationBinding } from '../shared/jobs';
import { applicationFrameTarget, type ExtensionAPI, type InjectionTarget, type MessageSender } from './extension-api';

const formSelector = 'form#application-form';
const iframeSelector = '#grnhse_app > iframe#grnhse_iframe[title="Greenhouse Job Board"]:not([sandbox]):not([hidden])';
const greenhouseOrigin = 'https://job-boards.greenhouse.io';
const jobIdPattern = /^[1-9]\d{0,19}$/;

function uniqueParam(url: URL, name: string): string | undefined {
  const params = url.searchParams.getAll(name);
  return params.length === 1 ? params[0] : undefined;
}

function greenhouseJobId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== greenhouseOrigin || url.pathname !== '/embed/job_app' || url.username || url.password || url.hash) return;
    const board = uniqueParam(url, 'for');
    const job = uniqueParam(url, 'token');
    if (!board || !/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(board) || !job || !jobIdPattern.test(job)) return;
    if (url.searchParams.has('gh_jid') && uniqueParam(url, 'gh_jid') !== job) return;
    return job;
  } catch { return; }
}

function postingJobId(value: string): string | undefined {
  try {
    const url = new URL(value);
    const job = uniqueParam(url, 'gh_jid');
    if (url.protocol === 'https:' && url.origin !== greenhouseOrigin && job && jobIdPattern.test(job)) return job;
  } catch { return; }
}

export function isGreenhouseEmbedUrl(url: string): boolean {
  return !!greenhouseJobId(url);
}

export function isGreenhousePostingUrl(url: string): boolean {
  return !!postingJobId(url);
}

function matchesPosting(topUrl: string, frameUrl: string): boolean {
  const job = postingJobId(topUrl);
  return !!job && greenhouseJobId(frameUrl) === job;
}

export function hasGreenhouseEmbed(doc: Document): boolean {
  const frames = doc.querySelectorAll<HTMLIFrameElement>(iframeSelector);
  const frame = frames[0];
  if (frames.length !== 1 || !matchesPosting(doc.URL, frame.src)) return false;
  const { width, height } = frame.getBoundingClientRect();
  const visibility = doc.defaultView?.getComputedStyle(frame).visibility;
  return width > 0 && height > 0 && visibility !== 'hidden' && visibility !== 'collapse'
    && frame.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
}

export function findGreenhouseApplicationForm(doc: Document): HTMLFormElement | null {
  const forms = doc.querySelectorAll<HTMLFormElement>(formSelector);
  if (forms.length !== 1) return null;
  const form = forms[0];
  try {
    if (new URL(form.getAttribute('action') || doc.URL, doc.baseURI).origin !== doc.location?.origin) return null;
  } catch { return null; }
  const coreFields = [
    'input#first_name[autocomplete="given-name"]',
    'input#last_name[autocomplete="family-name"]',
    'input#email[autocomplete="email"]',
    'input#phone[type="tel"]',
  ];
  if (!coreFields.every(selector => form.querySelector<HTMLInputElement>(selector)?.form === form)) return null;
  const resumeInput = form.querySelector<HTMLInputElement>('input#resume[type="file"]');
  if (resumeInput) return resumeInput.form === form ? form : null;

  // Greenhouse keeps the résumé group while replacing its file input with progress or a receipt.
  const uploads = form.querySelectorAll('.file-upload[role="group"][aria-labelledby="upload-label-resume"]');
  const label = doc.getElementById('upload-label-resume');
  return uploads.length === 1 && label?.parentElement === uploads[0]
    && /^\s*resume\s*\/\s*cv\s*\*?\s*$/i.test(label.textContent ?? '') ? form : null;
}

interface TopProbe { frameUrl: string; iframeKey: string; iframeIndex: number; timeOrigin: number }
interface ChildProbe { formKey: string; timeOrigin: number }

declare global {
  var __jobrightGreenhouseForm: (() => HTMLFormElement | null) | undefined;
  var __jobrightEmbeddedBinding: EmbeddedApplicationBinding | undefined;
  var __jobrightMatchesEmbeddedFrame: ((binding: EmbeddedApplicationBinding) => boolean) | undefined;
  var __jobrightGreenhouseFrameKeys: WeakMap<HTMLIFrameElement, string> | undefined;
  var __jobrightGreenhouseFormKeys: WeakMap<HTMLFormElement, string> | undefined;
}

// These two functions run in isolated extension worlds through scripting.executeScript.
// The browser serializes them, so they cannot capture imports or other functions from this module.
function probePosting(expectedUrl: string, selector: string): TopProbe | null {
  if (window !== window.top || document.URL !== expectedUrl) return null;
  const frames = document.querySelectorAll<HTMLIFrameElement>(selector);
  if (frames.length !== 1) return null;
  const frame = frames[0];
  const contentWindow = frame.contentWindow;
  if (!contentWindow) return null;
  const iframeIndex = Array.from({ length: window.length }, (_, index) => window.frames[index]).indexOf(contentWindow);
  if (iframeIndex < 0) return null;
  const { width, height } = frame.getBoundingClientRect();
  const visibility = getComputedStyle(frame).visibility;
  if (!width || !height || visibility === 'hidden' || visibility === 'collapse'
    || frame.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return null;
  const frameKeys = globalThis.__jobrightGreenhouseFrameKeys ??= new WeakMap();
  let iframeKey = frameKeys.get(frame);
  if (!iframeKey) {
    iframeKey = crypto.randomUUID();
    frameKeys.set(frame, iframeKey);
  }
  return { frameUrl: frame.src, iframeKey, iframeIndex, timeOrigin: performance.timeOrigin };
}

function probeGreenhouseFrame(expectedFrameUrl: string, expectedTopOrigin: string, iframeIndex: number): ChildProbe | null {
  const matchesTree = () => {
    try {
      return window !== window.top && window.parent === window.top && window.parent.frames[iframeIndex] === window
        && document.URL === expectedFrameUrl && (!location.ancestorOrigins?.length || location.ancestorOrigins[0] === expectedTopOrigin);
    } catch { return false; }
  };
  if (!matchesTree()) return null;
  const form = globalThis.__jobrightGreenhouseForm?.();
  if (!form) return null;
  const formKeys = globalThis.__jobrightGreenhouseFormKeys ??= new WeakMap();
  let formKey = formKeys.get(form);
  if (!formKey) {
    formKey = crypto.randomUUID();
    formKeys.set(form, formKey);
  }
  globalThis.__jobrightMatchesEmbeddedFrame = binding => {
    const liveForm = globalThis.__jobrightGreenhouseForm?.();
    return matchesTree() && binding.iframeIndex === iframeIndex && binding.frameUrl === document.URL && binding.frameTimeOrigin === performance.timeOrigin
      && !!liveForm && formKeys.get(liveForm) === binding.formKey;
  };
  return { formKey, timeOrigin: performance.timeOrigin };
}

function checkTop(api: ExtensionAPI, target: InjectionTarget, topUrl: string) {
  return api.scripting.executeScript<TopProbe | null>({
    target, func: probePosting, args: [topUrl, iframeSelector],
  }).then(results => results.find(result => result.frameId === 0 && result.result && matchesPosting(topUrl, result.result.frameUrl)),
    () => undefined);
}

function checkChild(api: ExtensionAPI, target: InjectionTarget, topUrl: string, frameUrl: string, iframeIndex: number) {
  return api.scripting.executeScript<ChildProbe | null>({
    target, func: probeGreenhouseFrame, args: [frameUrl, new URL(topUrl).origin, iframeIndex],
  }).catch(() => []);
}

export async function readEmbeddedApplication(
  api: ExtensionAPI, tabId: number, topUrl: string, topDocumentId?: string,
): Promise<EmbeddedApplicationBinding | undefined> {
  if (!postingJobId(topUrl)) return;
  const top = await checkTop(api, applicationFrameTarget(tabId, 0, topDocumentId), topUrl);
  if (!top?.result || (topDocumentId && top.documentId !== topDocumentId)) return;
  const frameUrl = top.result.frameUrl;
  const children = (await checkChild(api, { tabId, allFrames: true }, topUrl, frameUrl, top.result.iframeIndex))
    .filter(child => child.frameId > 0 && child.result);
  if (children.length !== 1) return;
  const [child] = children;
  if (!child.result) return;
  const binding: EmbeddedApplicationBinding = {
    tabId, topUrl, frameUrl, frameId: child.frameId, topTimeOrigin: top.result.timeOrigin, frameTimeOrigin: child.result.timeOrigin,
    iframeKey: top.result.iframeKey, iframeIndex: top.result.iframeIndex, formKey: child.result.formKey,
    ...(top.documentId ? { topDocumentId: top.documentId } : {}),
    ...(child.documentId ? { documentId: child.documentId } : {}),
  };
  if (await isCurrentEmbeddedApplication(api, binding)) return binding;
}

export function sameEmbeddedApplication(a?: EmbeddedApplicationBinding, b?: EmbeddedApplicationBinding): boolean {
  if (!a || !b) return a === b;
  return a.tabId === b.tabId && a.topUrl === b.topUrl && a.topDocumentId === b.topDocumentId
    && a.topTimeOrigin === b.topTimeOrigin && a.iframeKey === b.iframeKey && a.iframeIndex === b.iframeIndex && a.frameId === b.frameId
    && a.frameUrl === b.frameUrl && a.documentId === b.documentId && a.frameTimeOrigin === b.frameTimeOrigin
    && a.formKey === b.formKey;
}

function validBinding(binding: EmbeddedApplicationBinding | undefined): binding is EmbeddedApplicationBinding {
  const key = (value: unknown) => typeof value === 'string' && !!value && value.length <= 160;
  return !!binding && Number.isSafeInteger(binding.tabId) && binding.tabId >= 0
    && Number.isSafeInteger(binding.frameId) && binding.frameId > 0
    && Number.isSafeInteger(binding.iframeIndex) && binding.iframeIndex >= 0
    && typeof binding.topUrl === 'string' && binding.topUrl.length <= 16_000
    && typeof binding.frameUrl === 'string' && binding.frameUrl.length <= 16_000
    && matchesPosting(binding.topUrl, binding.frameUrl)
    && (binding.topDocumentId === undefined || key(binding.topDocumentId))
    && (binding.documentId === undefined || key(binding.documentId))
    && Number.isFinite(binding.topTimeOrigin) && binding.topTimeOrigin > 0
    && Number.isFinite(binding.frameTimeOrigin) && binding.frameTimeOrigin > 0
    && key(binding.iframeKey) && key(binding.formKey);
}

export function senderMatchesEmbeddedApplication(binding: EmbeddedApplicationBinding | undefined, sender: MessageSender): binding is EmbeddedApplicationBinding {
  return validBinding(binding) && sender.tab?.id === binding.tabId && sender.frameId === binding.frameId
    && sender.documentId === binding.documentId && sender.url === binding.frameUrl;
}

export async function isCurrentEmbeddedApplication(api: ExtensionAPI, binding: EmbeddedApplicationBinding): Promise<boolean> {
  if (!validBinding(binding) || !api.tabs.get) return false;
  const topTarget = applicationFrameTarget(binding.tabId, 0, binding.topDocumentId);
  const childTarget = applicationFrameTarget(binding.tabId, binding.frameId, binding.documentId);
  const [top, children] = await Promise.all([
    checkTop(api, topTarget, binding.topUrl),
    checkChild(api, childTarget, binding.topUrl, binding.frameUrl, binding.iframeIndex),
  ]);
  if (top?.documentId !== binding.topDocumentId || top?.result?.iframeKey !== binding.iframeKey
    || top.result.timeOrigin !== binding.topTimeOrigin || top.result.frameUrl !== binding.frameUrl
    || top.result.iframeIndex !== binding.iframeIndex) return false;
  if (!children.some(child => child.frameId === binding.frameId && child.documentId === binding.documentId
    && child.result?.timeOrigin === binding.frameTimeOrigin && child.result.formKey === binding.formKey)) return false;
  return (await api.tabs.get(binding.tabId).catch(() => undefined))?.url === binding.topUrl;
}
