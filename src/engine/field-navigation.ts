import type { FieldFocusResult } from '../shared/types';
import { inspectField, writable, type Field } from './discovery';

export function changedField(): FieldFocusResult {
  return { focused: false, reason: 'This field changed. Refresh the application fields and try again.' };
}

function questionIdentity(field: Field): string {
  // Values, checked states, and live combobox menus can change after a scan.
  return JSON.stringify([
    field.label, field.context, field.kind, field.metadata, field.autocomplete,
    field.required, field.section, field.rowIndex, field.pressedChoice,
  ]);
}

function presented(element: HTMLElement): boolean {
  if (!writable(element) || element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return true;
  const tiny = parseFloat(style.width) <= 1 && parseFloat(style.height) <= 1;
  const clipped = /^rect\(\s*0(?:px)?(?:[\s,]+0(?:px)?){3}\s*\)$/.test(style.clip) || style.clipPath === 'inset(50%)';
  return !tiny && !clipped && style.opacity !== '0';
}

function associatedLabel(control: HTMLElement): HTMLLabelElement | undefined {
  const input = control as HTMLInputElement;
  const labels = Array.from(input.labels ?? []).filter(label => label.control === input
    && label.closest('form') === input.form && !label.closest('a[href]') && presented(label));
  return labels.length === 1 ? labels[0] : undefined;
}

function focusTarget(field: Field): HTMLElement | undefined {
  const { element, kind, peers } = field;
  if (kind === 'radio' || kind === 'checkbox') {
    const controls = peers.length ? peers : [element];
    return controls.find(presented) ?? controls.map(associatedLabel).find(Boolean);
  }
  if (presented(element)) return element;
  if (kind !== 'file') return undefined;
  const label = associatedLabel(element);
  if (label) return label;
  const wrapper = element.closest<HTMLElement>('.file-upload, .field, .form-field, fieldset, [role="group"]');
  return wrapper && presented(wrapper) && wrapper.querySelectorAll('input[type="file"]').length === 1 ? wrapper : undefined;
}

function focusElement(target: HTMLElement): boolean {
  const scope = target.getRootNode() as Document | ShadowRoot;
  target.focus({ preventScroll: true });
  if (scope.activeElement === target) return true;
  if (target.tabIndex >= 0 || target.hasAttribute('tabindex')) return false;

  // An associated file label may need a temporary programmatic focus target.
  target.setAttribute('tabindex', '-1');
  const restoreTabIndex = () => {
    if (target.getAttribute('tabindex') === '-1') target.removeAttribute('tabindex');
  };
  target.focus({ preventScroll: true });
  if (scope.activeElement !== target) {
    restoreTabIndex();
    return false;
  }
  target.addEventListener('blur', restoreTabIndex, { once: true });
  return true;
}

export function focusScannedField(doc: Document, scanned: Field): FieldFocusResult {
  const { element } = scanned;
  if (!element.isConnected || element.ownerDocument !== doc) return changedField();
  const current = inspectField(element);
  if (!current || current.scope !== scanned.scope || current.row !== scanned.row
    || current.peers.length !== scanned.peers.length || current.peers.some((peer, index) => peer !== scanned.peers[index])
    || questionIdentity(current) !== questionIdentity(scanned)) return changedField();

  const target = focusTarget(current);
  if (!target) return changedField();
  target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' });
  if (!focusElement(target)) return changedField();
  // A stationary outline respects reduced motion and leaves authored styles intact.
  const outline = { outlineColor: 'Highlight', outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '3px' };
  target.animate?.([outline, outline], { duration: 2000, fill: 'none' });
  return { focused: true };
}
