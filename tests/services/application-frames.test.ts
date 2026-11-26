import { describe, expect, it, vi } from 'vitest';
import {
  findGreenhouseApplicationForm, isCurrentEmbeddedApplication, readEmbeddedApplication, senderMatchesEmbeddedApplication,
} from '../../src/services/application-frames';
import type { ExtensionAPI, InjectionTarget } from '../../src/services/extension-api';

const topUrl = 'https://careers.example.test/jobs/example/designer/?gh_jid=1000';
const frameUrl = 'https://job-boards.greenhouse.io/embed/job_app?for=example&token=1000&gh_jid=1000';
const tabId = 4;
const contactFields = '<input id="first_name" autocomplete="given-name"><input id="last_name" autocomplete="family-name">' +
  '<input id="email" autocomplete="email"><input id="phone" type="tel">';

function pageProof(documentIds: boolean) {
  const parent = { frameUrl, iframeIndex: 2, iframeKey: 'original-iframe', timeOrigin: 100 };
  const child = { formKey: 'original-form', timeOrigin: 200 };
  const topBinding = documentIds ? { documentId: 'top-document' } : {};
  const childBinding = documentIds ? { documentId: 'child-document' } : {};
  const tab = { id: tabId, url: topUrl };
  const probe = vi.fn(async (details: { target: InjectionTarget; args: unknown[] }) => {
    return details.args[0] === topUrl
      ? [{ frameId: 0, ...topBinding, result: parent }]
      : [{ frameId: 7, ...childBinding, result: child }];
  });
  const api = { tabs: { get: async () => tab }, scripting: { executeScript: probe } } as unknown as ExtensionAPI;
  return { api, parent, child, tab, probe, topBinding, childBinding };
}

describe('embedded application proof', () => {
  it.each([true, false])('rejects form remount and iframe replacement, with document ID support %s', async documentIds => {
    const { api, child, parent, topBinding, childBinding } = pageProof(documentIds);
    const binding = await readEmbeddedApplication(api, tabId, topUrl, topBinding.documentId);
    expect(binding).toMatchObject({ tabId, topUrl, frameUrl, frameId: 7, ...childBinding });
    expect(await isCurrentEmbeddedApplication(api, binding!)).toBe(true);
    child.formKey = 'replacement-form';
    expect(await isCurrentEmbeddedApplication(api, binding!)).toBe(false);
    child.formKey = 'original-form';
    parent.iframeKey = 'replacement-iframe';
    expect(await isCurrentEmbeddedApplication(api, binding!)).toBe(false);
    parent.iframeKey = 'original-iframe';
    child.timeOrigin++;
    expect(await isCurrentEmbeddedApplication(api, binding!)).toBe(false);
  });

  it('rejects a lookalike host, incorrect path, duplicate job parameter or mismatched job', async () => {
    const { api, parent, probe } = pageProof(true);
    for (const url of [
      frameUrl.replace('greenhouse.io', 'greenhouse.io.lookalike.test'),
      frameUrl.replace('/embed/job_app', '/embed/another_form'),
      frameUrl + '&token=1000',
      frameUrl.replaceAll('1000', '1001'),
    ]) {
      parent.frameUrl = url;
      probe.mockClear();
      expect(await readEmbeddedApplication(api, tabId, topUrl)).toBeUndefined();
      expect(probe).toHaveBeenCalledTimes(1);
    }
  });

  it('accepts validation only from the browser-reported child document', async () => {
    const { api, childBinding } = pageProof(true);
    const binding = await readEmbeddedApplication(api, tabId, topUrl);
    const sender = { tab: { id: tabId }, frameId: 7, url: frameUrl, ...childBinding };
    expect(senderMatchesEmbeddedApplication(binding, sender)).toBe(true);
    expect(senderMatchesEmbeddedApplication(binding, { ...sender, frameId: 8 })).toBe(false);
    expect(senderMatchesEmbeddedApplication(binding, { ...sender, url: topUrl })).toBe(false);
    expect(senderMatchesEmbeddedApplication(binding, { ...sender, documentId: 'replacement-document' })).toBe(false);
  });

  it('requires the real core controls to belong to the one recognized form', () => {
    const doc = document;
    doc.body.innerHTML = '<form id="alternate"></form><form id="application-form">' +
      contactFields + '<input id="resume" type="file"></form>';
    const form = doc.querySelector('form#application-form');
    expect(findGreenhouseApplicationForm(doc)).toBe(form);
    doc.querySelector('#first_name')!.setAttribute('form', 'alternate');
    expect(findGreenhouseApplicationForm(doc)).toBeNull();
    doc.querySelector('#first_name')!.removeAttribute('form');
    form?.setAttribute('action', 'https://alternate.example.test');
    expect(findGreenhouseApplicationForm(doc)).toBeNull();
    doc.body.replaceChildren();
  });

  it('recognizes the same form after the native résumé input is replaced by progress and a receipt', () => {
    const doc = document;
    doc.body.innerHTML = `<form id="application-form">${contactFields}
      <div class="file-upload" role="group" aria-labelledby="upload-label-resume">
        <div id="upload-label-resume">Resume/CV*</div>
        <div class="file-upload__wrapper"><input id="resume" type="file"></div>
      </div>
    </form>`;
    const form = doc.querySelector('form')!;
    const wrapper = form.querySelector('.file-upload__wrapper')!;
    expect(findGreenhouseApplicationForm(doc)).toBe(form);
    wrapper.innerHTML = '<progress aria-label="Uploading résumé"></progress>';
    expect(findGreenhouseApplicationForm(doc)).toBe(form);
    wrapper.innerHTML = '<div class="file-upload__filename">Synthetic.pdf <button type="button" aria-label="Remove file"></button></div>';
    expect(findGreenhouseApplicationForm(doc)).toBe(form);
    form.querySelector('#upload-label-resume')!.textContent = 'Cover Letter';
    expect(findGreenhouseApplicationForm(doc)).toBeNull();
    doc.body.replaceChildren();
  });
});
