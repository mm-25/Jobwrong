// The UI and its services are bundled from production. Only APIs supplied by
// the browser, the injected engine and the OpenAI transport are simulated.
export function installBrowserBoundary() {
  const applicationUrl = 'https://example.test/apply';
  const state = {
    scans: [],
    fills: [],
    focusRequests: [],
    aiRequests: [],
    nativeRequests: [],
    sourceRequests: [],
    permissionDenied: false,
    providerUnavailable: false,
    values: {
      'jobright.profile.v1': {
        schemaVersion: 1,
        personal: { firstName: 'Harper', email: 'sample@example.com' },
        employment: [{ company: 'Example Studio', title: 'Designer' }],
        // Synthetic saved answers; the application must not invent missing values.
        applicationDefaults: { visaSponsorship: 'yes', gender: 'male', disability: 'no', veteran: 'no', hispanicLatino: 'no', acceptApplicationPrivacy: true,
          onsiteWork: 'yes', relocation: 'yes', raceEthnicity: 'south_asian', referralSource: 'linkedin' },
        workAuthorizations: [{ country: 'United States', authorized: true, fullTimeAuthorized: true }],
      },
      'jobright.ai.v1': { enabled: true, apiKey: 'test-credential', model: 'gpt-4.1-mini' },
    },
  };
  globalThis.fixtureState = state;

  function makeFrame(frameId, frameUrl, platform) {
    const filled = new Map();
    return {
      frameUrl,
      globals: {
        __jobrightLocal: {
          async scan(profile, options) {
            state.scans.push({ frameId, reviewedAnswers: options.reviewedAnswers });
            const reviewed = options.reviewedAnswers?.same;
            // Deliberately reuse the same ID and question across both frames.
            const fields = [{
              id: 'same',
              label: 'What did you design?',
              kind: 'text',
              status: reviewed ? 'ready' : 'unanswered',
              value: reviewed,
              aiEligible: !reviewed,
            }];
            if (frameId === 0) {
              fields.unshift({ id: 'first', label: 'First name', kind: 'text', status: 'ready', value: profile.personal.firstName, required: true });
              fields.push({
                id: 'email',
                label: 'Email',
                kind: 'text',
                status: options.overwriteExisting ? 'ready' : 'preserved',
                currentValue: 'user@example.com',
                value: profile.personal.email,
              });
              fields.push(
                { id: 'sensitive', label: 'Visa sponsorship', kind: 'text', status: 'unanswered', sensitive: true, required: true },
                { id: 'ineligible', label: 'Reference email', kind: 'text', status: 'unanswered', aiEligible: false },
                { id: 'choice', label: 'Which design discipline is closest to your background?', kind: 'select', status: 'unanswered', options: ['Product design', 'Content design'] },
              );
            }
            return {
              scanId: `scan-${state.scans.length}`,
              platform,
              frameUrl,
              fields,
              warnings: frameId === 0 ? ['Some fields may be in another frame.'] : [],
            };
          },
          async fill(scanId, ids) {
            state.fills.push({ frameId, ids });
            filled.set(scanId, ids.length);
            return {
              filled: ids.length,
              skipped: 0,
              failed: 0,
              needsRescan: true,
              entries: ids.map(id => ({ id, label: 'What did you design?', status: 'filled' })),
            };
          },
          async undo(scanId) {
            const restored = filled.get(scanId) ?? 0;
            filled.delete(scanId);
            return { restored, skipped: 0 };
          },
        },
      },
    };
  }

  const frames = new Map([
    [0, makeFrame(0, applicationUrl, 'generic')],
    [7, makeFrame(7, 'https://example.test/embedded', 'lever')],
  ]);
  globalThis.browser = {
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, state.values[key]])); },
        async set(values) { Object.assign(state.values, values); },
        async clear() { state.values = {}; },
        async setAccessLevel() {},
      },
    },
    tabs: { query: async () => [{ id: 44, url: applicationUrl }] },
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      async openOptionsPage() { location.href = '/options.html'; },
      async sendNativeMessage(host, request) {
        state.nativeRequests.push({ host, request });
        return { v: 1, ok: true, rootLabel: 'Synthetic career notes' };
      },
      async sendMessage(request) {
        if (request.command === 'sources') {
          state.sourceRequests.push(request);
          return { receipts: [{ question: 'Describe a project you led.', sources: [
            { id: 's1', path: 'Portfolio/Research.md', heading: 'Study', lineStart: 4, lineEnd: 8 },
          ] }] };
        }
        if (request.command !== 'focus') throw new Error('Unexpected background command');
        state.focusRequests.push(request);
        return { focus: { focused: true } };
      },
    },
    permissions: {
      request: async () => !state.permissionDenied,
      contains: async () => !state.permissionDenied,
    },
    scripting: {
      async executeScript({ target, files, func, args = [] }) {
        const frameIds = target.allFrames ? [...frames.keys()] : target.frameIds;
        if (files) return frameIds.map(frameId => ({ frameId }));
        // executeScript serializes the submitted callback into the isolated
        // target world. Provide that world's globals without opening ATS pages.
        const invoke = new Function('globalThis', 'location', 'document', 'args', `return (${func})(...args);`);
        return Promise.all(frameIds.map(async frameId => {
          const frame = frames.get(frameId);
          const result = await invoke(frame.globals, { href: frame.frameUrl }, { querySelectorAll: () => [] }, args);
          return { frameId, documentId: `document-${frameId}`, result };
        }));
      },
    },
  };

  globalThis.fetch = async (url, { body }) => {
    if (url !== 'https://api.openai.com/v1/responses') throw new Error('Unexpected network request');
    const payload = JSON.parse(JSON.parse(body).input);
    state.aiRequests.push(payload);
    if (state.providerUnavailable) return new Response('', { status: 503 });

    const suggestions = [
      { fieldId: '0:same', answer: 'Designed the reporting view.' },
      { fieldId: '7:same', answer: 'Designed the setup flow.' },
      { fieldId: '0:ineligible', answer: 'Unexpected answer.' },
      { fieldId: '0:choice', answer: 'product design' },
    ];
    const content = [{ type: 'output_text', text: JSON.stringify({ suggestions }) }];
    return new Response(JSON.stringify({ status: 'completed', output: [{ content }] }), { status: 200 });
  };
}
