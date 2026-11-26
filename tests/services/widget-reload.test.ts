import { afterEach, expect, test, vi } from 'vitest';
import { createInPagePanel } from '../../src/ui/inpage';

const widget = '[data-jobright-local-ui="true"]';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function initialize() {
  vi.stubGlobal('chrome', { runtime: { id: 'synthetic-extension' } });
  document.body.innerHTML = `<div id="site" data-jobright-local-ui="true"><form>
    <label>Cover letter<textarea>Applicant’s saved draft</textarea></label>
  </form></div>`;
  const original = createInPagePanel(document);
  original.show();
  const previous = document.querySelector<HTMLElement>(`${widget}:not(#site)`)!;
  const current = createInPagePanel(document);
  return { original, previous, current };
}

test('retires a previous widget when an independent panel mounts and keeps the page draft intact', () => {
  const { original, previous, current } = initialize();
  current.show();
  const next = document.querySelector<HTMLElement>(`${widget}:not(#site):not([inert])`)!;
  expect(next).not.toBe(previous);
  expect(next.shadowRoot!.querySelector('section')!.hidden).toBe(false);
  expect(previous.getAttribute('aria-hidden')).toBe('true');
  expect(previous.hasAttribute('inert')).toBe(true);
  expect(previous.style.display).toBe('none');
  expect(previous.isConnected).toBe(true);
  expect(document.querySelector('#site')!.hasAttribute('inert')).toBe(false);
  expect(document.querySelector('textarea')!.value).toBe('Applicant’s saved draft');

  original.show();
  original.offer();
  expect(document.querySelectorAll(`${widget}:not(#site):not([inert])`)).toHaveLength(1);
  expect(next.shadowRoot!.querySelector<HTMLButtonElement>('#autofill')!.disabled).toBe(false);
});

test('retires a legacy host that rejoins the body after the new panel mounts', async () => {
  const { previous, current } = initialize();
  previous.remove();
  current.show();
  document.body.append(previous);
  await vi.waitFor(() => expect(previous.hasAttribute('inert')).toBe(true));
  expect(document.querySelectorAll(`${widget}:not(#site):not([inert])`)).toHaveLength(1);
  expect(previous.style.display).toBe('none');
});
