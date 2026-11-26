import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

test.each(['Phone country code', 'Country calling code', 'International dialing code'])(
  'uses the unique country-qualified option for %s without a separate saved prefix', async label => {
    document.body.innerHTML = `<form><label>${label}<select><option value="">Choose</option><option>Canada (+1)</option><option>United States (+1)</option></select></label></form>`;
    const p = emptyProfile();
    Object.assign(p.personal, { country: 'United States', phone: '313-555-0100' });
    const engine = createEngine(document);
    const scan = await engine.scan(p);
    expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'United States (+1)' });
    expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
    expect(document.querySelector('select')?.value).toBe('United States (+1)');
  },
);
