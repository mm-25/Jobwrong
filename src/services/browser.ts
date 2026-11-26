import type { FillResult, FrameFill, FrameScan, Profile, ScanOptions, ScanResult, UndoBatch, UndoResult } from '../shared/types';
import type { EmbeddedApplicationBinding } from '../shared/jobs';
import { parseProfile } from '../shared/profile';
import { applicationFrameTarget, extensionAPI } from './extension-api';
import { isCurrentEmbeddedApplication, isGreenhousePostingUrl, readEmbeddedApplication, sameEmbeddedApplication } from './application-frames';

interface UndoCandidate extends UndoBatch {
  frames: (UndoBatch['frames'][number] & { embedded?: EmbeddedApplicationBinding })[];
  pending?: true;
  previous?: UndoCandidate;
}

let lastScan: { tabId: number; url: string; scans: FrameScan[]; reviewedAnswers: Record<number, Record<string, string>>; embedded?: EmbeddedApplicationBinding } | undefined;
async function activeTab() {
  const [tab] = await extensionAPI().tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//i.test(tab.url)) throw new Error('Open a job application in a normal web tab, then open the extension from its toolbar icon.');
  return { id: tab.id, url: tab.url };
}
async function inject(tabId: number, topOnly = false): Promise<{ frameIds: number[]; warning?: string }> {
  const api = extensionAPI();
  try {
    const target = topOnly ? { tabId, frameIds: [0] } : { tabId, allFrames: true };
    const results = await api.scripting.executeScript({ target, files: ['content.js'] });
    return { frameIds: [...new Set(results.map(result => result.frameId))] };
  } catch {
    try {
      await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content.js'] });
      return { frameIds: [0], warning: 'An embedded frame could not be accessed. Open its application form in a separate tab to fill it.' };
    } catch { throw new Error('This browser page cannot be accessed. Open the application directly and click the extension toolbar icon again.'); }
  }
}
export async function scanActiveTab(profile: Profile, options: ScanOptions = {}, reviewedAnswers?: Record<number, Record<string, string>>): Promise<FrameScan[]> {
  const tab = await activeTab();
  if (reviewedAnswers && (!lastScan || tab.id !== lastScan.tabId || tab.url !== lastScan.url)) throw new Error('The application tab changed. Scan again before accepting AI suggestions.');
  const api = extensionAPI();
  const embedded = await readEmbeddedApplication(api, tab.id, tab.url);
  if (reviewedAnswers && !sameEmbeddedApplication(embedded, lastScan?.embedded)) throw new Error('The embedded application changed. Scan again before accepting AI suggestions.');
  const clean = parseProfile(profile);
  const { frameIds, warning } = embedded
    ? { frameIds: [embedded.frameId], warning: undefined } : await inject(tab.id, isGreenhousePostingUrl(tab.url));
  const scans: FrameScan[] = [];
  const retainedAnswers: Record<number, Record<string, string>> = {};
  const failures: number[] = [];
  for (const frameId of frameIds) {
    try {
      const previous = lastScan?.scans.find(frame => frame.frameId === frameId);
      const accepted = reviewedAnswers?.[frameId];
      const safeAccepted = accepted && previous ? Object.fromEntries(Object.entries(accepted).filter(([id]) => previous.result.fields.some(field =>
        field.id === id && !field.sensitive && (
          (field.status === 'unanswered' && field.aiEligible !== false)
          || (field.status === 'ready' && Object.hasOwn(lastScan?.reviewedAnswers[frameId] ?? {}, id))
        )
      ))) : {};
      if (embedded && !await isCurrentEmbeddedApplication(api, embedded)) throw new Error('The embedded application changed.');
      const [response] = await api.scripting.executeScript<ScanResult>({
        target: applicationFrameTarget(tab.id, frameId, embedded?.documentId),
        func: async (data: Profile, settings: ScanOptions, previousUrl: string, topUrl: string, scope: EmbeddedApplicationBinding | null) => {
          if (!globalThis.__jobrightLocal) throw new Error('Autofill engine not loaded');
          const top = document.defaultView?.top;
          if (scope ? !globalThis.__jobrightMatchesEmbeddedFrame?.(scope) : top && top.location.href !== topUrl) {
            throw new Error('The application frame changed or cannot be accessed.');
          }
          if (scope) globalThis.__jobrightEmbeddedBinding = scope;
          if (previousUrl && location.href !== previousUrl) throw new Error('Frame navigated; scan again');
          const result = await globalThis.__jobrightLocal.scan(data, settings);
          const inaccessible = !scope && Array.from(document.querySelectorAll('iframe')).some(frame => {
            try { return !frame.contentDocument; } catch { return true; }
          });
          if (inaccessible) result.warnings.push('An embedded application may be on another origin. Open that form in its own tab if its fields are missing.');
          return result;
        },
        args: [clean, { overwriteExisting: options.overwriteExisting === true, ...(accepted ? { reviewedAnswers: safeAccepted } : {}) }, reviewedAnswers ? previous?.result.frameUrl ?? '' : '', tab.url, embedded ?? null],
      });
      if (response?.result && (!embedded || (response.frameId === embedded.frameId && response.documentId === embedded.documentId
        && await isCurrentEmbeddedApplication(api, embedded)))) {
        scans.push({ tabId: tab.id, frameId, tabUrl: tab.url, documentId: response.documentId, result: response.result });
        retainedAnswers[frameId] = Object.fromEntries(Object.entries(safeAccepted).filter(([id]) => response.result!.fields.some(field => field.id === id && field.status === 'ready')));
      }
      else failures.push(frameId);
    } catch { failures.push(frameId); }
  }
  if (!scans.length) throw new Error('No application frames could be scanned. Reload the page and try again.');
  if (warning) scans[0].result.warnings.push(warning);
  if (failures.length) scans[0].result.warnings.push('Some frames changed or could not be scanned. Open the application directly if fields are missing.');
  lastScan = { tabId: tab.id, url: tab.url, scans, reviewedAnswers: retainedAnswers, embedded };
  return scans;
}
async function replaceUndoBatch(tabId: number, batch: UndoBatch, replacement: UndoCandidate | 'previous' | null): Promise<void> {
  try {
    await extensionAPI().scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (url: string, scanId: string, next: UndoCandidate | 'previous' | null) => {
        const current: UndoCandidate | undefined = globalThis.__jobrightLocalUndoBatch;
        if (location.href !== url || current?.frames[0]?.scanId !== scanId) return;
        globalThis.__jobrightLocalUndoBatch = next === 'previous' ? current.previous : next ?? undefined;
      },
      args: [batch.url, batch.frames[0].scanId, replacement],
    });
  } catch {
    // The staged batch remains available if the document is still accessible.
  }
}

export async function fillActiveTab(scans: FrameScan[], selected?: Record<number, string[]>): Promise<FrameFill[]> {
  if (!scans.length) throw new Error('Scan the application before filling.');
  const tab = await activeTab();
  if (scans.some(scan => scan.tabId !== tab.id)) throw new Error('The active tab changed. Return to the scanned application or scan again.');
  const selectedScans = scans.filter(scan => !selected || (selected[scan.frameId]?.length ?? 0) > 0);
  if (!selectedScans.length) return [];
  const preview = lastScan;
  if (!preview || preview.tabId !== tab.id || preview.url !== tab.url || scans.some((scan) =>
    !preview.scans.some((frame) => frame.frameId === scan.frameId
      && frame.result.scanId === scan.result.scanId && frame.result.frameUrl === scan.result.frameUrl))) {
    throw new Error('The application or its preview changed. Scan again before filling.');
  }

  // Stage the operation in the top frame before making changes so that a popup
  // closure cannot lose its undo scope. Keep the prior batch until a write succeeds.
  const batch: UndoCandidate = { url: preview.url, frames: selectedScans.map(scan => ({
    frameId: scan.frameId, scanId: scan.result.scanId, frameUrl: scan.result.frameUrl,
    ...(preview.embedded?.frameId === scan.frameId ? { embedded: preview.embedded } : {}),
  })) };
  try {
    const [stored] = await extensionAPI().scripting.executeScript<boolean>({
      target: { tabId: tab.id, frameIds: [0] },
      func: (value: UndoBatch) => {
        if (location.href !== value.url) throw new Error('Application changed; scan again');
        const previous = globalThis.__jobrightLocalUndoBatch;
        const pending: UndoCandidate = { ...value, pending: true, previous: previous?.url === value.url ? previous : undefined };
        globalThis.__jobrightLocalUndoBatch = pending;
        return true;
      }, args: [batch],
    });
    if (!stored?.result) throw new Error('Frame unavailable');
  } catch { throw new Error('The application changed before filling. Scan again.'); }

  const outcomes: FrameFill[] = [];
  const changedFrames: UndoCandidate['frames'] = [];
  let hasUnknownOutcome = false;
  for (const [index, scan] of selectedScans.entries()) {
    const frame = batch.frames[index];
    const ids = selected?.[frame.frameId];
    let mayHaveWritten = false;
    try {
      const api = extensionAPI();
      const embedded = frame.embedded;
      if (embedded && !await isCurrentEmbeddedApplication(api, embedded)) throw new Error('The embedded application changed.');
      const target = applicationFrameTarget(tab.id, frame.frameId, embedded?.documentId);
      mayHaveWritten = true;
      const [response] = await api.scripting.executeScript<FillResult>({
        target,
        func: async (id: string, fieldIds: string[] | null, url: string, topUrl: string, scope: EmbeddedApplicationBinding | null) => {
          const topWindow = document.defaultView?.top;
          const sameApplication = () => location.href === url && (scope ? !!globalThis.__jobrightMatchesEmbeddedFrame?.(scope)
            : !topWindow || topWindow.location.href === topUrl);
          if (!globalThis.__jobrightLocal || !sameApplication()) throw new Error('Application changed; scan again');
          if (scope) globalThis.__jobrightEmbeddedBinding = scope;
          const result = await globalThis.__jobrightLocal.fill(id, fieldIds ?? undefined);
          if (!sameApplication()) throw new Error('Application changed; scan again');
          if (!scope) globalThis.__jobrightPage?.noteFill(id, result);
          return result;
        }, args: [frame.scanId, ids ?? null, frame.frameUrl, batch.url, embedded ?? null],
      });
      if (!response?.result) throw new Error('Frame unavailable');
      const result = response.result;
      if (embedded) {
        if (response.frameId !== embedded.frameId || response.documentId !== embedded.documentId
          || !await isCurrentEmbeddedApplication(api, embedded)) throw new Error('The embedded application changed.');
        await api.scripting.executeScript({
          target,
          func: (scanId: string, fill: FillResult, scope: EmbeddedApplicationBinding) => {
            if (globalThis.__jobrightMatchesEmbeddedFrame?.(scope)) globalThis.__jobrightPage?.noteFill(scanId, fill, scope);
          },
          args: [frame.scanId, result, embedded],
        }).catch(() => []);
      }
      if (result.undoAvailable ?? (result.filled > 0)) changedFrames.push(frame);
      outcomes.push({ frameId: frame.frameId, result });
    } catch {
      hasUnknownOutcome ||= mayHaveWritten;
      const entries = scan.result.fields.filter(field => field.status === 'ready' && (!ids || ids.includes(field.id))).map(field => ({
        id: field.id, label: field.label, status: 'failed' as const, reason: 'The form changed or became unavailable. Scan again.',
      }));
      outcomes.push({ frameId: frame.frameId, result: { entries, filled: 0, skipped: 0, failed: entries.length, needsRescan: true } });
    }
  }
  // A rejected frame call may have changed the page before losing its reply.
  // Keep the staged IDs in that case so undo can check those frames directly.
  if (!hasUnknownOutcome) {
    await replaceUndoBatch(tab.id, batch, changedFrames.length ? { url: batch.url, frames: changedFrames } : 'previous');
  }
  return outcomes;
}

async function undoBatch(tabId: number, batch: UndoCandidate): Promise<UndoResult[]> {
  const results: UndoResult[] = [];
  for (const frame of batch.frames) {
    try {
      const api = extensionAPI();
      const embedded = frame.embedded;
      if (embedded && !await isCurrentEmbeddedApplication(api, embedded)) throw new Error('The embedded application changed.');
      const [response] = await api.scripting.executeScript<UndoResult>({
        target: applicationFrameTarget(tabId, frame.frameId, embedded?.documentId),
        func: async (scanId: string, url: string, topUrl: string, scope: EmbeddedApplicationBinding | null) => {
          const topWindow = document.defaultView?.top;
          const sameApplication = scope ? !!globalThis.__jobrightMatchesEmbeddedFrame?.(scope) : !topWindow || topWindow.location.href === topUrl;
          if (!globalThis.__jobrightLocal || location.href !== url || !sameApplication) {
            throw new Error('Frame changed');
          }
          if (scope) globalThis.__jobrightEmbeddedBinding = scope;
          return globalThis.__jobrightLocal.undo(scanId);
        }, args: [frame.scanId, frame.frameUrl, batch.url, embedded ?? null],
      });
      if (!response?.result || (embedded && (response.frameId !== embedded.frameId || response.documentId !== embedded.documentId))) {
        throw new Error('Frame unavailable');
      }
      results.push(response.result);
    } catch { results.push({ restored: 0, skipped: 0, warning: 'An application frame changed or became unavailable, so its changes could not be undone.' }); }
  }
  return results;
}

export async function undoActiveTab(): Promise<UndoResult[]> {
  const tab = await activeTab();
  const [stored] = await extensionAPI().scripting.executeScript<UndoCandidate | null>({
    target: { tabId: tab.id, frameIds: [0] },
    func: () => globalThis.__jobrightLocalUndoBatch ?? null,
  });
  const batch = stored?.result;
  if (!batch || batch.url !== tab.url) return [];
  // An interrupted operation can fall back only if every frame confirms it had
  // no changes. Any restoration, skip, warning, or missing reply ends the search.
  for (let candidate: UndoCandidate | undefined = batch; candidate; candidate = candidate.previous) {
    const results = await undoBatch(tab.id, candidate);
    const changed = results.some((result) => result.restored || result.skipped);
    if (!candidate.pending || changed) {
      if (batch.pending) await replaceUndoBatch(tab.id, batch, { url: candidate.url, frames: candidate.frames });
      return results;
    }
    if (results.some((result) => result.warning)) return results;
  }
  await replaceUndoBatch(tab.id, batch, null);
  return [];
}
export async function openOptions(): Promise<void> { await extensionAPI().runtime.openOptionsPage(); }
