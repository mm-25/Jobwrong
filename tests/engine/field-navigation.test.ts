import { expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { AutofillEngine } from '../../src/shared/types';

function fixture(markup: string) {
  document.body.innerHTML = markup;
  const engine: AutofillEngine = createEngine(document);
  expect(typeof engine.focus).toBe('function');
  return engine;
}

function trackMutations(element: Element) {
  const mutations = vi.fn();
  for (const event of ['click', 'input', 'change', 'submit']) element.addEventListener(event, mutations);
  return mutations;
}

test('focuses the scanned duplicate-label control after the applicant edits its value', async () => {
  const engine = fixture(`<form>
    <label>Location<input id="office"></label>
    <label>Location<input id="home"></label>
  </form>`);
  const scan = await engine.scan(emptyProfile());
  const office = document.querySelector<HTMLInputElement>('#office')!;
  const home = document.querySelector<HTMLInputElement>('#home')!;
  home.value = 'Applicant edit';
  home.dispatchEvent(new Event('input', { bubbles: true }));
  home.scrollIntoView = vi.fn();
  office.focus();
  const mutations = trackMutations(document.querySelector('form')!);

  expect(engine.focus!(scan.fields[1].id)).toEqual({ focused: true });
  expect(document.activeElement).toBe(home);
  expect(home.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'instant' });
  expect(home.value).toBe('Applicant edit');
  expect(office.value).toBe('');
  expect(mutations).not.toHaveBeenCalled();
});

test('focuses the first visible radio peer and the editable combobox in an open shadow root', async () => {
  const engine = fixture('<div id="shadow-host"></div>');
  const shadow = document.querySelector('#shadow-host')!.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<form><div role="radiogroup" aria-label="Preferred schedule">
    <button hidden type="button" role="radio" aria-checked="false">Morning</button>
    <button id="evening" type="button" role="radio" aria-checked="false">Evening</button>
    </div>
    <input id="city" role="combobox" aria-label="City" aria-expanded="false" tabindex="0">
    </form>`;
  const scan = await engine.scan(emptyProfile());
  const radio = scan.fields.find(field => field.label === 'Preferred schedule')!;
  const combo = scan.fields.find(field => field.label === 'City')!;
  const evening = shadow.querySelector('#evening')!;
  const city = shadow.querySelector<HTMLInputElement>('#city')!;
  // Some comboboxes add aria-controls only while their options are visible.
  city.setAttribute('aria-expanded', 'true');
  city.setAttribute('aria-controls', 'city-options');
  city.insertAdjacentHTML('afterend', '<div id="city-options" role="listbox"><div role="option">Detroit</div></div>');
  city.value = 'Detroit';
  const mutations = trackMutations(shadow.querySelector('form')!);

  expect(engine.focus!(radio.id)).toEqual({ focused: true });
  expect(shadow.activeElement).toBe(evening);
  expect(evening.getAttribute('aria-checked')).toBe('false');
  expect(engine.focus!(combo.id)).toEqual({ focused: true });
  expect(shadow.activeElement).toBe(city);
  expect(city.value).toBe('Detroit');
  expect(city.getAttribute('aria-expanded')).toBe('true');
  expect(city.getAttribute('tabindex')).toBe('0');
  expect(mutations).not.toHaveBeenCalled();
});

test.each(['hidden', 'style="position:absolute;width:1px;height:1px;clip:rect(0px,0px,0px,0px)"'])(
  'focuses the visible label of a hidden attachment without opening the chooser (%s)',
  async hideAttribute => {
    const engine = fixture(`<form>
      <label for="resume">Resume/CV</label><input id="resume" type="file" ${hideAttribute}>
      <label>City<input id="city"></label></form>`);
    const scan = await engine.scan(emptyProfile());
    const label = document.querySelector('label')!;
    const file = document.querySelector<HTMLInputElement>('#resume')!;
    const mutations = trackMutations(document.querySelector('form')!);
    label.scrollIntoView = vi.fn();
    const attachment = scan.fields.find(field => field.kind === 'file')!;

    expect(engine.focus!(attachment.id)).toEqual({ focused: true });
    expect(document.activeElement).toBe(label);
    expect(label.scrollIntoView).toHaveBeenCalledOnce();
    expect(file.files).toHaveLength(0);
    expect(mutations).not.toHaveBeenCalled();
    document.querySelector<HTMLInputElement>('#city')!.focus();
    expect(label.hasAttribute('tabindex')).toBe(false);
  },
);

test.each([
  'unknown ID', 'relabeled control', 'replaced control', 'detached control',
  'disabled control', 'hidden control', 'new form scope', 'navigation',
])(
  'rejects the stale target after %s',
  async change => {
    const url = document.URL;
    const engine = fixture(`<input id="other"><form id="first">
      <label for="original">Question</label><input id="original"></form><form id="second"></form>`);
    const scan = await engine.scan(emptyProfile());
    const other = document.querySelector<HTMLInputElement>('#other')!;
    const original = document.querySelector<HTMLInputElement>('#original')!;
    const id = scan.fields.find(field => field.label === 'Question')!.id;
    original.scrollIntoView = vi.fn();
    other.focus();
    try {
      if (change === 'relabeled control') document.querySelector('label')!.textContent = 'New question';
      if (change === 'replaced control') original.replaceWith(original.cloneNode());
      if (change === 'detached control') original.remove();
      if (change === 'disabled control') original.disabled = true;
      if (change === 'hidden control') original.hidden = true;
      if (change === 'new form scope') document.querySelector('#second')!.append(original);
      if (change === 'navigation') history.replaceState({}, '', '/different-job');
      expect(engine.focus!(change === 'unknown ID' ? 'missing-id' : id))
        .toMatchObject({ focused: false, reason: expect.stringMatching(/field changed.*refresh/i) });
      expect(document.activeElement).toBe(other);
      expect(original.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (change === 'navigation') history.replaceState({}, '', url);
    }
  },
);

test('does not navigate during an in-progress Autofill', async () => {
  const engine = fixture('<form><label>First name<input autocomplete="given-name"></label></form>');
  const profile = emptyProfile();
  profile.personal.firstName = 'Morgan';
  const scan = await engine.scan(profile);
  const filling = engine.fill(scan.scanId);
  expect(engine.focus!(scan.fields[0].id)).toMatchObject({ focused: false, reason: expect.stringMatching(/autofill.*running/i) });
  await filling;
});

test('uses a stationary outline that expires without changing the authored style', async () => {
  const engine = fixture('<form><label>City<input id="city" style="outline:1px dashed red;color:black"></label></form>');
  const scan = await engine.scan(emptyProfile());
  const city = document.querySelector<HTMLInputElement>('#city')!;
  const style = city.getAttribute('style');
  const animate = vi.fn();
  city.animate = animate;

  expect(engine.focus!(scan.fields[0].id)).toEqual({ focused: true });
  expect(animate).toHaveBeenCalledOnce();
  const [keyframes, timing] = animate.mock.calls[0];
  expect(keyframes).toHaveLength(2);
  expect(keyframes[0]).toEqual(keyframes[1]);
  expect(timing).toMatchObject({ duration: 2000, fill: 'none' });
  expect(city.getAttribute('style')).toBe(style);
});
