import { words, type Field } from './discovery';

export interface GreenhousePhoneWidget {
  form: HTMLFormElement;
  group: Element;
  wrapper: Element;
  country: HTMLInputElement;
}

export function greenhousePhoneWidget(field: Field): GreenhousePhoneWidget | undefined {
  const input = field.element as HTMLInputElement;
  if (field.kind !== 'text' || !field.trustedLabel || !/^phone(?: number)?$/.test(words(field.label))
    || input.ownerDocument.location?.origin !== 'https://job-boards.greenhouse.io'
    || !input.matches('input#phone[type="tel"][autocomplete="off"].iti__tel-input')) return undefined;
  const form = input.form;
  const wrapper = input.parentElement;
  const inputWrapper = wrapper?.parentElement;
  const textWrapper = inputWrapper?.parentElement;
  const phoneColumn = textWrapper?.parentElement;
  const group = input.closest('fieldset.phone-input');
  if (!form?.matches('form#application-form') || input.closest('form') !== form || !group
    || !wrapper?.matches('.iti.iti--allow-dropdown.iti--show-flags')
    || !inputWrapper?.matches('.input-wrapper') || !textWrapper?.matches('.text-input-wrapper')
    || !phoneColumn?.matches('.phone-input__phone') || phoneColumn.parentElement !== group) return undefined;
  const phones = group.querySelectorAll('input[type="tel"]');
  const countries = group.querySelectorAll<HTMLInputElement>('.phone-input__country input#country[role="combobox"]');
  const country = countries[0];
  if (phones.length !== 1 || phones[0] !== input || countries.length !== 1 || country.form !== form) return undefined;
  return { form, group, wrapper, country };
}

export function sameGreenhousePhoneWidget(expected: GreenhousePhoneWidget, current?: GreenhousePhoneWidget): boolean {
  return !!current && expected.form === current.form && expected.group === current.group
    && expected.wrapper === current.wrapper && expected.country === current.country;
}

export function completeUSPhone(value: string): string | undefined {
  const compact = value.trim().replace(/[ .()\u00a0\t-]/g, '');
  return /^(?:\+1)?([2-9]\d{2}[2-9]\d{6})$/.exec(compact)?.[1];
}
