import { JOB_CHANNEL, type FieldFocusTarget, type JobCommand, type JobReply, type JobState } from '../shared/jobs';
import { extensionAPI } from '../services/extension-api';

const changedApplication = 'The application changed. Click Autofill again on the current application.';

const widgetHost = 'div[data-jobright-local-ui="true"]';
const widgetOwner = 'data-jobright-local-ui-owner';
const widgetRetired = 'data-jobright-local-ui-retired';

function retireOtherWidgets(body: HTMLElement, host: HTMLElement) {
  for (const previous of body.querySelectorAll<HTMLElement>(`:scope > ${widgetHost}:not([${widgetRetired}])`)) {
    if (previous === host) continue;
    const shadow = previous.shadowRoot;
    const panel = shadow?.querySelector('section#panel[role="region"][aria-label="JobRight Local autofill"]');
    const launcher = shadow?.querySelector('button#launcher[type="button"][aria-label="Open JobRight Local"]');
    if (!shadow || panel?.parentNode !== shadow || launcher?.parentNode !== shadow || !panel.querySelector('button#autofill[type="button"]')
      || !panel.querySelector('button#undo[type="button"]')) continue;
    // Older extension contexts may still reconnect their own host after page hydration.
    // Keep that node mounted so their observers have no reason to add it back.
    previous.setAttribute(widgetRetired, '');
    previous.setAttribute('inert', '');
    previous.setAttribute('aria-hidden', 'true');
    previous.style.setProperty('display', 'none', 'important');
  }
}

export function createInPagePanel(doc: Document): { show(): void; offer(): void } {
  let host: HTMLElement | undefined;
  const owner = [...(doc.defaultView?.crypto ?? globalThis.crypto).getRandomValues(new Uint32Array(4))].join('-');
  const retired = () => {
    const activeOwner = doc.documentElement?.getAttribute(widgetOwner);
    return !!host && (host.hasAttribute(widgetRetired) || (!!activeOwner && activeOwner !== owner));
  };
  let root: ShadowRoot;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reattachTimer: ReturnType<typeof setTimeout> | undefined;
  let mountPoints: { documentRoot: HTMLElement | null; body: HTMLElement | null } | undefined;
  let pending = false;
  let requesting = false;
  let activeCommand: JobCommand | undefined;
  let queued: { command: JobCommand; focus?: FieldFocusTarget; url: string } | undefined;
  let displayedStates: JobState[] = [];
  let displayedUrl = doc.URL;
  let displayedFrameWarning: string | undefined;
  const api = extensionAPI();
  const current = (): JobState[] => globalThis.__jobrightPage ? [globalThis.__jobrightPage.status()] : [];
  function render(applicationStates: JobState[], statusMessage?: string, url = doc.URL, frameWarning?: string) {
    if (!host || retired()) return;
    const top = applicationStates.find(state => state.frameId === 0 || state.frameId === undefined);
    const states = top && top.url !== url ? [] : applicationStates;
    displayedStates = states;
    displayedUrl = url;
    displayedFrameWarning = frameWarning;
    const running = pending || states.some(state => state.running);
    const locating = activeCommand === 'focus' || queued?.command === 'focus';
    const unavailable = running || locating;
    const started = states.some(state => state.started);
    const filled = states.reduce((sum, state) => sum + state.filled, 0);
    const failed = states.reduce((sum, state) => sum + state.failed, 0);
    const aiFilled = states.reduce((sum, state) => sum + (state.aiFilled ?? 0), 0);
    const vaultFilled = states.reduce((sum, state) => sum + (state.vaultFilled ?? 0), 0);
    const remaining = states.flatMap(state => state.remaining.map(field => ({ field, state })));
    root.querySelector<HTMLButtonElement>('#autofill')!.disabled = unavailable;
    root.querySelector<HTMLButtonElement>('#autofill')!.textContent = running ? 'Filling…' : 'Autofill';
    root.querySelector<HTMLButtonElement>('#undo')!.disabled = unavailable || !states.some(state => state.undoAvailable);
    root.querySelector<HTMLButtonElement>('#profile')!.disabled = locating;
    const status = root.querySelector('#status')!;
    const matching = states.some(state => state.running && state.message.startsWith('Matching unfamiliar'));
    status.textContent = statusMessage ?? (running ? matching ? 'Matching unfamiliar questions… You can switch tabs.' : 'Filling your application… You can switch tabs.' : locating ? 'Locating field…' : started
      ? `${filled} filled · ${remaining.length} need attention${aiFilled ? ` · ${aiFilled} matched with AI` : ''}${vaultFilled ? ` · ${vaultFilled} from Obsidian` : ''}${failed ? ` · ${failed} could not be filled` : ''}` : 'Fill with your profile and saved defaults.');
    const frameNotice = root.querySelector<HTMLElement>('#frame-notice')!;
    frameNotice.textContent = frameWarning ?? '';
    frameNotice.hidden = !frameWarning;
    const aiNotice = root.querySelector<HTMLElement>('#ai-notice')!;
    aiNotice.textContent = [...new Set(states.flatMap(state => [state.aiMessage, state.vaultMessage, state.experienceMessage].filter((message): message is string => !!message)))].join(' ')
      + (vaultFilled ? ' View references with “View Obsidian sources” in the extension toolbar.' : '');
    aiNotice.hidden = !aiNotice.textContent || running;
    // Undo/error messages carry more information than the aggregate fill totals.
    const messages = states.filter(state => /restored|could not|cannot|changed|reload/i.test(state.message)).map(state => state.message);
    if (!unavailable && !statusMessage && messages.length) status.textContent = [...new Set(messages)].join(' ');
    const list = root.querySelector('#remaining')!;
    list.replaceChildren();
    for (const { field, state } of remaining) {
      const item = doc.createElement('li');
      const canFocus = !!field.id && state.frameId !== undefined;
      const title = doc.createElement(canFocus ? 'button' : 'strong');
      title.textContent = `${field.label}${field.required ? ' · Required' : ''}`;
      if (title instanceof HTMLButtonElement) {
        title.type = 'button';
        title.className = 'field-jump';
        title.disabled = unavailable;
        title.setAttribute('aria-label', `Show field: ${field.label}`);
        title.title = 'Scroll to this field on the application';
        const target: FieldFocusTarget = { fieldId: field.id!, frameId: state.frameId!, frameUrl: state.url,
          ...(state.documentId ? { documentId: state.documentId } : {}) };
        title.addEventListener('click', event => {
          if (event.isTrusted) void request('focus', target, url);
        });
      }
      const reason = doc.createElement('span');
      reason.textContent = field.status === 'ready' ? 'Ready now. Click Autofill to fill this newly available field.' : field.reason ?? 'Add an answer in your profile or complete this field.';
      item.append(title, reason); list.append(item);
    }
    root.querySelector<HTMLDetailsElement>('#details')!.hidden = !remaining.length;
    if (timer) clearTimeout(timer);
    if (running) timer = setTimeout(() => { void request('status'); }, 700);
  }
  async function request(command: JobCommand, focus?: FieldFocusTarget, url = doc.URL) {
    if (retired()) return;
    if (doc.URL !== url) {
      render(current(), changedApplication);
      return;
    }
    const displayed = () => displayedUrl === url ? displayedStates : current();
    const displayedWarning = () => displayedUrl === url ? displayedFrameWarning : undefined;
    const renderPending = () => render(displayed(), undefined, url, displayedWarning());
    if (requesting) {
      if (command === 'status') timer = setTimeout(() => { void request('status'); }, 700);
      else if (activeCommand === 'status' && !queued) {
        // A background status probe can still be pending when the user clicks.
        // Keep one explicit action, bound to the application they clicked on.
        queued = { command, focus, url };
        pending = command === 'start' || command === 'undo';
        renderPending();
      }
      return;
    }
    requesting = true;
    activeCommand = command;
    pending = command === 'start' || command === 'undo';
    if (pending || command === 'focus') renderPending();
    let reply: JobReply | undefined;
    let statusMessage: string | undefined;
    try {
      if (!api.runtime.sendMessage) throw new Error('Reload this page after updating the extension.');
      reply = await api.runtime.sendMessage<JobReply>({ channel: JOB_CHANNEL, command, url, ...(focus ? { focus } : {}) });
      if (reply.error) throw new Error(reply.error);
      if (command === 'focus') statusMessage = reply.focus?.focused ? 'Field highlighted on the application.'
        : reply.focus?.reason ?? 'This field is no longer available. Refresh the application fields.';
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : 'Reload this page after updating the extension.';
    } finally {
      pending = false;
      requesting = false;
      activeCommand = undefined;
      const next = queued;
      queued = undefined;
      if (doc.URL !== url) render(current(), changedApplication);
      else render(reply?.states ?? displayed(), statusMessage, url, reply?.states ? reply.warning : reply?.warning ?? displayedWarning());
      if (next) await request(next.command, next.focus, next.url);
    }
  }
  const mountObserver = new MutationObserver(() => {
    const body = doc.body;
    if (retired()) {
      mountObserver.disconnect();
      clearTimeout(timer);
      return;
    }
    if (host?.parentNode === body && mountPoints?.body === body
      && mountPoints?.documentRoot === doc.documentElement) {
      if (body && host) retireOtherWidgets(body, host);
      return;
    }
    if (reattachTimer !== undefined) return;
    // Yield to the site's current render before moving the host back.
    reattachTimer = setTimeout(() => {
      reattachTimer = undefined;
      attachHost();
    }, 100);
  });
  function attachHost() {
    const documentRoot = doc.documentElement;
    const body = doc.body;
    if (mountPoints?.documentRoot !== documentRoot || mountPoints?.body !== body) {
      mountPoints = { documentRoot, body };
      mountObserver.disconnect();
      // Watch the host and its possible replacement ancestors, not form contents.
      mountObserver.observe(doc, { childList: true });
      if (documentRoot) mountObserver.observe(documentRoot, { childList: true });
      if (body) mountObserver.observe(body, { childList: true });
    }
    if (host && body && !retired()) {
      documentRoot?.setAttribute(widgetOwner, owner);
      retireOtherWidgets(body, host);
      if (host.parentNode !== body) body.append(host);
    }
  }
  function createHost() {
    host = doc.createElement('div');
    host.dataset.jobrightLocalUi = 'true';
    host.style.cssText = 'all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483646;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { color-scheme:light; } * { box-sizing:border-box; } [hidden]{display:none!important}
        button,section { font:14px/1.45 system-ui,sans-serif; color:#172a29; } button { cursor:pointer; }
        button:focus-visible,summary:focus-visible{outline:3px solid #21786c;outline-offset:3px}
        #launcher { border:1px solid #abc9bf;border-radius:28px;padding:12px 18px;background:#163f36;color:white;box-shadow:0 4px 20px #102b2926;font-weight:650; }
        section { width:min(340px,calc(100vw - 40px));max-height:min(580px,calc(100vh - 40px));overflow:auto;background:#fff;border:1px solid #d5e4df;border-radius:16px;box-shadow:0 12px 40px #102b2933; }
        header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #edf1ee;} header strong{font-size:15px}
        #minimize{border:0;background:none;padding:4px 8px;font-size:20px;line-height:1}
        .body{padding:16px 18px;} p{margin:0 0 14px} #status{font-size:13px;min-height:38px;color:#50635f}
        #autofill{width:100%;border:0;background:#194f40;color:white;border-radius:9px;padding:12px;font-weight:650;font-size:15px}
        button:disabled{cursor:default;opacity:.5} footer{display:flex;gap:12px;justify-content:space-between;padding:12px 18px;border-top:1px solid #edf1ee}
        footer button{border:0;background:none;padding:4px;color:#275c4d;font-size:12px} details{margin-top:16px;font-size:12px} summary{cursor:pointer;font-weight:600}
        ul{padding:0;list-style:none;margin:10px 0 0} li{padding:10px 0;border-top:1px solid #edf1ee} li strong,li span{display:block} li span{margin-top:4px;color:#61716c}
        .field-jump{display:block;border:0;background:none;color:#275c4d;padding:0;text-align:left;font:inherit;font-weight:650;text-decoration:underline;text-underline-offset:3px}
        .field-jump:hover{color:#123c32}
        .hint{font-size:11px;color:#61716c;margin:10px 0 0}
      </style>
      <button id="launcher" type="button" aria-label="Open JobRight Local">✦ JobRight Local</button>
      <section id="panel" role="region" aria-label="JobRight Local autofill" hidden>
        <header><strong>JobRight Local</strong><button id="minimize" type="button" aria-label="Minimize autofill">−</button></header>
        <div class="body"><p id="status" role="status" aria-live="polite"></p><button id="autofill" type="button">Autofill</button>
          <p class="hint">Keeps existing answers. Review the completed form before submitting.</p><p id="frame-notice" class="hint" aria-live="polite" hidden></p><p id="ai-notice" class="hint" hidden></p>
          <details id="details" hidden><summary>Fields that need attention</summary><ul id="remaining"></ul></details>
        </div><footer><button id="undo" type="button" disabled>Undo last fill</button><button id="profile" type="button">Profile &amp; Claude</button></footer>
      </section>`;
    const on = (id: string, action: () => void) => root.querySelector(id)!.addEventListener('click', event => {
      // Page-created clicks cannot initiate access to the stored profile.
      if (event.isTrusted) action();
    });
    on('#launcher', () => { show(); void request('status'); });
    on('#minimize', () => {
      root.querySelector<HTMLElement>('#panel')!.hidden = true;
      root.querySelector<HTMLElement>('#launcher')!.hidden = false;
    });
    on('#autofill', () => { void request('start'); });
    on('#undo', () => { void request('undo', undefined, displayedUrl); });
    on('#profile', () => { void request('options'); });
    render(current());
  }
  function mount() {
    if (!host) {
      doc.documentElement?.setAttribute(widgetOwner, owner);
      createHost();
    }
    if (!retired()) attachHost();
  }
  function show() {
    if (doc.defaultView !== doc.defaultView?.top) return;
    mount();
    if (retired()) return;
    root.querySelector<HTMLElement>('#panel')!.hidden = false;
    root.querySelector<HTMLElement>('#launcher')!.hidden = true;
    render(current(), undefined, doc.URL, displayedUrl === doc.URL ? displayedFrameWarning : undefined);
  }
  return { show, offer: mount };
}
