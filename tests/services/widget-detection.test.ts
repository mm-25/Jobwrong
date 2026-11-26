import { expect, test, vi } from 'vitest';

test('offers the panel on a job application built without a native form element', async () => {
  vi.stubGlobal('chrome', { runtime: { id: 'synthetic-extension' } });
  document.body.innerHTML = `<h1>Job application</h1><section>
    <label>Name<input autocomplete="name"></label>
    <label>Email<input autocomplete="email"></label>
    <label>Phone<input type="tel"></label>
  </section>`;
  try {
    await import('../../src/content');
    expect(document.forms).toHaveLength(0);
    expect(document.querySelectorAll('[data-jobright-local-ui]')).toHaveLength(1);
    expect(globalThis.__jobrightPage!.status().started).toBe(false);
    expect([...document.querySelectorAll('input')].every(input => !input.value)).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
