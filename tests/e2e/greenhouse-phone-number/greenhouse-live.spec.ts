import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { emptyProfile } from '../../../src/shared/profile';

const url = 'https://job-boards.greenhouse.io/example-studio/jobs/5004000';
const layouts = [
  { initialInline: true, switchLayout: false },
  { initialInline: false, switchLayout: false },
  { initialInline: true, switchLayout: true },
  { initialInline: false, switchLayout: true },
];

for (const { initialInline, switchLayout } of layouts) {
  test(`Greenhouse phone formatting retains the exact number and Undo with ${initialInline ? 'inline' : 'non-inline'} layout${switchLayout ? ' changes' : ''}`, async ({ page, browserName }) => {
    await page.route('**/*', route => route.request().url() === url ? route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><form id="application-form"><fieldset class="phone-input"><legend>Phone</legend>
        <div class="phone-input__country"><label id="country-label" for="country">Country</label>
          <div class="select-shell"><div><div class="select__control">
            <div class="select__value-container"><div class="select__single-value"><div class="iti__flag iti__us"></div><span>+1</span></div>
              <input id="country" type="text" role="combobox" class="select__input" aria-autocomplete="list"
                aria-haspopup="true" aria-labelledby="country-label" aria-expanded="false"></div>
            <div class="select__indicators"><button type="button" aria-label="Toggle flyout"></button></div>
          </div></div></div>
        </div>
        <div class="phone-input__phone"><div class="text-input-wrapper"><div class="input-wrapper"><label for="phone">Phone</label>
          <div class="iti iti--allow-dropdown iti--show-flags${initialInline ? ' iti--inline-dropdown' : ''}">
            <input id="phone" type="tel" autocomplete="off" class="input input__single-line iti__tel-input">
          </div>
        </div></div></div>
      </fieldset><button type="submit">Submit application</button></form>
      <script>
        const phone = document.getElementById('phone');
        phone.addEventListener('input', () => {
          if (phone.value === '+13135550100') {
            phone.value = '(313) 555-0100';
            if (${switchLayout}) phone.parentElement.classList.toggle('iti--inline-dropdown');
          }
        });
        document.querySelector('button[type="submit"]').addEventListener('click', () => { document.body.dataset.submitClick = 'yes'; });
        document.addEventListener('submit', event => { event.preventDefault(); document.body.dataset.submitted = 'yes'; });
      </script>`,
    }) : route.abort());
    await page.goto(url);
    await page.addScriptTag({ path: resolve(process.env.JOBRIGHT_E2E_DIST ?? 'dist', browserName, 'content.js') });

    const profile = emptyProfile();
    profile.personal.country = 'United States';
    profile.personal.phone = '+13135550100';
    const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), profile);
    const field = plan.fields.find(item => item.label === 'Phone')!;
    expect(field).toMatchObject({ status: 'ready', value: '+13135550100' });
    const fill = await page.evaluate(({ scanId, fieldId }) => window.__jobrightLocal!.fill(scanId, [fieldId]), { scanId: plan.scanId, fieldId: field.id });
    expect(fill).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
    await expect(page.locator('#phone')).toHaveValue('(313) 555-0100');
    await expect(page.locator('.select__single-value')).toHaveText('+1');

    const wrapper = page.locator('.phone-input__phone .iti');
    expect(await wrapper.evaluate(element => element.classList.contains('iti--inline-dropdown')))
      .toBe(switchLayout ? !initialInline : initialInline);
    if (switchLayout) {
      expect(await wrapper.evaluate(element => element.classList.toggle('iti--inline-dropdown'))).toBe(initialInline);
    }
    expect(await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), plan.scanId)).toEqual({ restored: 1, skipped: 0 });
    await expect(page.locator('#phone')).toHaveValue('');
    await expect(page.locator('body')).not.toHaveAttribute('data-submit-click');
    await expect(page.locator('body')).not.toHaveAttribute('data-submitted');
  });
}
