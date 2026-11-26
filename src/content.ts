import { createEngine } from './engine';
import { createPageController } from './page-controller';
import { createInPagePanel } from './ui/inpage';
import { extensionAPI } from './services/extension-api';
import { INTERPRETATION_CHANNEL, type InterpretationResult, type QuestionInterpreter } from './shared/interpretation';
import { VAULT_CHANNEL, type VaultDrafter, type VaultResult } from './shared/vault';
import {
  EMBEDDED_APPLICATION_CHANNEL, type EmbeddedApplicationBinding, type EmbeddedApplicationReply, type EmbeddedApplicationRequest,
} from './shared/jobs';
import { findGreenhouseApplicationForm, hasGreenhouseEmbed, isGreenhouseEmbedUrl, sameEmbeddedApplication } from './services/application-frames';

const hasRuntime = !!(globalThis as unknown as { chrome?: { runtime?: { id?: string } }; browser?: { runtime?: { id?: string } } }).chrome?.runtime?.id
  || !!(globalThis as unknown as { browser?: { runtime?: { id?: string } } }).browser?.runtime?.id;
const embeddedGreenhouse = hasRuntime && window !== window.top && isGreenhouseEmbedUrl(document.URL) && crossOriginPosting();

function crossOriginPosting(): boolean {
  try { return window.top?.location.origin !== location.origin; }
  catch { return true; }
}

function matchesEmbedded(binding: EmbeddedApplicationBinding): boolean {
  return sameEmbeddedApplication(globalThis.__jobrightEmbeddedBinding, binding)
    && !!globalThis.__jobrightMatchesEmbeddedFrame?.(binding);
}

if (embeddedGreenhouse) globalThis.__jobrightGreenhouseForm ??= () => findGreenhouseApplicationForm(document);
globalThis.__jobrightLocal ??= createEngine(document, embeddedGreenhouse ? {
  applicationForm: () => {
    const binding = globalThis.__jobrightEmbeddedBinding;
    return binding && matchesEmbedded(binding) ? findGreenhouseApplicationForm(document) : null;
  },
} : undefined);
if (!globalThis.__jobrightPage) {
  const panel = hasRuntime && window === window.top ? createInPagePanel(document) : undefined;
  const interpret: QuestionInterpreter | undefined = hasRuntime ? async (questions, run) => {
    const api = extensionAPI();
    if (!api.runtime.sendMessage) return { meanings: [], error: 'Reload the application page to enable AI matching.' };
    return api.runtime.sendMessage<InterpretationResult>({ channel: INTERPRETATION_CHANNEL, run, url: document.URL, questions });
  } : undefined;
  const draftVault: VaultDrafter | undefined = hasRuntime ? async (questions, run) => {
    const api = extensionAPI();
    if (!api.runtime.sendMessage) return { answers: [], error: 'Reload the application page to enable Obsidian answers.' };
    return api.runtime.sendMessage<VaultResult>({ channel: VAULT_CHANNEL, command: 'draft', run, url: document.URL, questions });
  } : undefined;
  globalThis.__jobrightPage = createPageController(document, globalThis.__jobrightLocal, () => panel?.show(), interpret, draftVault, embeddedGreenhouse ? {
    matchesEmbedded,
    async validateEmbedded(binding) {
      const request: EmbeddedApplicationRequest = { channel: EMBEDDED_APPLICATION_CHANNEL, binding };
      const reply = await extensionAPI().runtime.sendMessage?.<EmbeddedApplicationReply>(request);
      return reply?.valid === true;
    },
  } : undefined);
  if (panel) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offer = () => {
      // React applications can render labeled controls without a native <form>.
      // This only offers the launcher; a trusted click still starts every fill.
      const controls = document.querySelectorAll('input:not([type="hidden"]):not([type="search"]):not([type="password"]):not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea, [role="combobox"], [data-automation-id="applicationPage"], [data-automation-id^="formField-"]');
      const jobSignal = /(?:apply|application|careers|jobs|workday|greenhouse|lever\.co|ashbyhq|icims)/i.test(location.href)
        || !!document.querySelector('input[type="file"][name*="resume" i],input[type="file"][id*="resume" i],[data-automation-id="applicationPage"]')
        || Array.from(document.querySelectorAll('h1,h2,h3,form legend')).some(heading => /(?:apply for|job application|employment|work experience)/i.test(heading.textContent ?? ''));
      if ((controls.length < 3 || !jobSignal) && !hasGreenhouseEmbed(document)) return;
      observer.disconnect();
      panel.offer();
    };
    const observer = new MutationObserver(() => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        offer();
      }, 400);
    });
    observer.observe(document, { childList: true, subtree: true });
    offer();
  }
}
