// @vitest-environment-options {"url":"https://job-boards.greenhouse.io/embed/job_app?for=example&token=1000"}
import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

const nationalDisplay = '(313) 555-0100';

function phoneApplication({ flag = 'us', display = nationalDisplay, wrapped = true, inlineDropdown = true, mutate, transparentFlag = false, countryCaption }: {
  flag?: 'us' | 'ca'; display?: string; wrapped?: boolean; inlineDropdown?: boolean; transparentFlag?: boolean; countryCaption?: string;
  mutate?: (phone: HTMLInputElement, flag: Element) => void;
} = {}) {
  document.body.innerHTML = `<form id="application-form"><fieldset class="phone-input"><legend>Phone</legend>
    <div class="phone-input__country"><label id="country-label" for="country">Country</label>
      <div class="select-shell"><div><div class="select__control">
        <div class="select__value-container">
          <div class="select__single-value"${countryCaption ? ` aria-label="${countryCaption}"` : ''}>
            <div class="iti__flag iti__${flag}"${transparentFlag ? ' style="opacity: 0"' : ''}></div><span>+1</span>
          </div>
          <input id="country" role="combobox" class="select__input" type="text" aria-autocomplete="list"
            aria-haspopup="true" aria-labelledby="country-label" aria-expanded="false">
        </div>
        <div class="select__indicators"><button type="button" aria-label="Toggle flyout"></button></div>
      </div></div></div>
    </div>
    <div class="phone-input__phone"><div class="text-input-wrapper"><div class="input-wrapper"><label for="phone">Phone</label>
      <div class="${wrapped ? 'iti iti--allow-dropdown iti--show-flags' + (inlineDropdown ? ' iti--inline-dropdown' : '') : 'ordinary-input'}">
        <input id="phone" type="tel" autocomplete="off" class="input input__single-line iti__tel-input">
      </div>
    </div></div></div>
  </fieldset></form>`;
  const phone = document.querySelector<HTMLInputElement>('#phone')!;
  const badge = document.querySelector('.iti__flag')!;
  phone.addEventListener('input', () => {
    if (!phone.value) return;
    phone.value = display;
    mutate?.(phone, badge);
  }, { once: true });
  const engine = createEngine(document);
  const fill = async (number: string) => {
    const profile = emptyProfile();
    profile.personal.phone = number;
    profile.personal.country = 'United States';
    const scan = await engine.scan(profile);
    const field = scan.fields.find(item => item.label === 'Phone')!;
    expect(field).toMatchObject({ status: 'ready', value: number });
    return { scanId: scan.scanId, result: await engine.fill(scan.scanId, [field.id]) };
  };
  return { engine, phone, badge, fill };
}

test.each([
  { number: '3135550100', inlineDropdown: true },
  { number: '+13135550100', inlineDropdown: true },
  { number: '+13135550100', inlineDropdown: false },
])('counts retained national formatting and undoes the exact phone write (%o)', async ({ number, inlineDropdown }) => {
  const { engine, phone, fill } = phoneApplication({ inlineDropdown });
  const { scanId, result } = await fill(number);
  expect(phone.value).toBe(nationalDisplay);
  expect(result).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  expect(await engine.undo(scanId)).toEqual({ restored: 1, skipped: 0 });
  expect(phone.value).toBe('');
});

test.each([true, false])('retains the same phone binding when the dropdown layout changes (initial inline=%s)', async inlineDropdown => {
  const { engine, phone, fill } = phoneApplication({
    inlineDropdown,
    mutate: input => { input.parentElement!.classList.toggle('iti--inline-dropdown'); },
  });
  const wrapper = phone.parentElement!;
  const { scanId, result } = await fill('+13135550100');
  expect(phone.parentElement).toBe(wrapper);
  expect(wrapper.classList.contains('iti--inline-dropdown')).toBe(!inlineDropdown);
  expect(result).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  expect(phone.value).toBe(nationalDisplay);
  wrapper.classList.toggle('iti--inline-dropdown');
  expect(await engine.undo(scanId)).toEqual({ restored: 1, skipped: 0 });
  expect(phone.value).toBe('');
});

test.each([
  { number: '+13135550100', display: '(313) 555-0101' },
  { number: '+443135550100', display: nationalDisplay },
  { number: '313-5550', display: '313 5550' },
  { number: '3135550100 ext 3', display: nationalDisplay },
  { number: '+13135550100', flag: 'ca' as const },
  { number: '+13135550100', transparentFlag: true },
  { number: '+13135550100', countryCaption: 'Canada +1' },
  { number: '+13135550100', countryCaption: 'United States +44' },
  { number: '3135550100', wrapped: false },
])('does not accept a number, country or widget mismatch (%o)', async ({ number, ...options }) => {
  const { fill } = phoneApplication(options);
  expect((await fill(number)).result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
});

test('accepts an accessible caption that agrees with the rendered flag and code', async () => {
  const { fill } = phoneApplication({ countryCaption: 'United States +1' });
  expect((await fill('+13135550100')).result).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
});

test('does not accept national formatting when the live country changes during the write', async () => {
  const { fill } = phoneApplication({ mutate: (_, badge) => { badge.className = 'iti__flag iti__ca'; } });
  expect((await fill('+13135550100')).result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
});

test('does not claim a formatted phone after a manual edit and clear during the settle window', async () => {
  const { fill } = phoneApplication({ mutate: phone => queueMicrotask(() => {
    for (const value of ['(313) 555-0102', '', nationalDisplay]) {
      phone.value = value;
      phone.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }) });
  expect((await fill('+13135550100')).result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
});

test('Undo preserves a manual edit to the rendered phone field', async () => {
  const { engine, phone, fill } = phoneApplication();
  const { scanId, result } = await fill('+13135550100');
  expect(result).toMatchObject({ filled: 1, undoAvailable: true });
  phone.value = '(313) 555-0102';
  phone.dispatchEvent(new Event('input', { bubbles: true }));
  expect(await engine.undo(scanId)).toEqual({ restored: 0, skipped: 1 });
  expect(phone.value).toBe('(313) 555-0102');
});

test('Undo does not use the saved phone binding after a same-code country change', async () => {
  const { engine, phone, badge, fill } = phoneApplication();
  const { scanId, result } = await fill('+13135550100');
  expect(result).toMatchObject({ filled: 1, undoAvailable: true });
  badge.className = 'iti__flag iti__ca';
  expect(await engine.undo(scanId)).toEqual({ restored: 0, skipped: 1 });
  expect(phone.value).toBe(nationalDisplay);
});
