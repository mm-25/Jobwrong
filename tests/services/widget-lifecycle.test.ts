import { expect, test, vi } from 'vitest';

const widgetSelector = '[data-jobright-local-ui]';

test('reattaches the same open panel after the page replaces its body', async () => {
  vi.stubGlobal('chrome', { runtime: { id: 'synthetic-extension' } });
  document.body.innerHTML = `<h1>Apply for this job</h1><form>
    <label>First name<input autocomplete="given-name"></label>
    <label>Last name<input autocomplete="family-name"></label>
    <label>Email<input autocomplete="email"></label>
  </form>`;

  try {
    await import('../../src/content');
    const controller = globalThis.__jobrightPage!;
    const widget = document.querySelector(widgetSelector)!;
    controller.show();
    const panel = widget.shadowRoot!.querySelector('section')!;
    expect(panel.hidden).toBe(false);

    const replacement = document.createElement('body');
    replacement.append(document.querySelector('form')!);
    document.body.replaceWith(replacement);
    // Some hydration paths also discard anything appended directly under html.
    document.documentElement.replaceChildren(document.head, replacement);

    await vi.waitFor(() => expect(replacement.querySelector(widgetSelector)).toBe(widget));
    expect(panel.hidden).toBe(false);

    vi.resetModules();
    await import('../../src/content');
    expect(globalThis.__jobrightPage).toBe(controller);
    expect(document.querySelectorAll(widgetSelector)).toHaveLength(1);
    expect(controller.status().started).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('');
  } finally {
    vi.unstubAllGlobals();
  }
});
