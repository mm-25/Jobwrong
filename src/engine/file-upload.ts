import { accessibleText, visible, writable, type Field } from './discovery';
import { workdayResumeInput, workdayResumeWrapper } from './workday-structure';

export type UploadGroup =
  | { kind: 'greenhouse'; element: HTMLElement; form: Element; captionId: string | null }
  | { kind: 'workday'; element: HTMLElement; scope: Node; page: Element };

export function associatedUploadGroup(field: Field): UploadGroup | undefined {
  if (field.kind !== 'file') return undefined;
  const workday = workdayResumeInput(field.element);
  if (workday && (workday.section.closest('form') ?? workday.section.getRootNode()) === field.scope) {
    return { kind: 'workday', element: workday.section, scope: field.scope, page: workday.page };
  }
  const element = field.element.closest<HTMLElement>('.file-upload');
  const form = element?.closest('form#application-form.application--form, form#application_form, form.gh-apply-form');
  if (!element || !form || form !== field.scope) return undefined;
  const inputs = element.querySelectorAll('input[type="file"]');
  if (inputs.length !== 1 || inputs[0] !== field.element) return undefined;
  return { kind: 'greenhouse', element, form, captionId: element.getAttribute('aria-labelledby') };
}

function stillAssociated(group: UploadGroup): boolean {
  if (group.kind === 'workday') {
    const { element, page, scope } = group;
    return element.isConnected && visible(element) && element.closest('[data-automation-id="applyFlowMyExpPage"]') === page
      && (element.closest('form') ?? element.getRootNode()) === scope && !!workdayResumeWrapper(element);
  }
  const { element, form, captionId } = group;
  return element.isConnected && element.matches('.file-upload') && element.closest('form') === form
    && element.getAttribute('aria-labelledby') === captionId;
}

function workdayUploadBusy(wrapper: HTMLElement): boolean {
  return !!wrapper.closest('[aria-busy="true"]')
    || [...wrapper.querySelectorAll('[aria-busy="true"], [role="progressbar"], progress')]
      .some(visible);
}

function workdayRemoveButtons(wrapper: HTMLElement): HTMLButtonElement[] {
  return [...wrapper.querySelectorAll<HTMLButtonElement>('button')].filter(button => visible(button)
    && /^(?:remove|delete)(?:\s|$)/i.test(accessibleText(button) || button.title || button.textContent?.trim() || ''));
}

function workdayFilenames(wrapper: HTMLElement): string[] {
  if (workdayUploadBusy(wrapper)) return [];
  const filenames = new Set<string>();
  const win = wrapper.ownerDocument.defaultView!;
  for (const remove of workdayRemoveButtons(wrapper).filter(writable)) {
    for (let item = remove.parentElement; item && item !== wrapper; item = item.parentElement) {
      const walker = wrapper.ownerDocument.createTreeWalker(item, win.NodeFilter.SHOW_TEXT);
      const names = new Set<string>();
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const parent = text.parentElement;
        const name = text.nodeValue?.trim();
        if (name && /^[^<>\\/:|?*\u0000-\u001f]+\.[a-z0-9]{1,12}$/i.test(name)
          && parent && !parent.closest('button, label, [role="alert"]') && visible(parent)) names.add(name);
      }
      if (!names.size) continue;
      if (names.size === 1) filenames.add(names.values().next().value!);
      break;
    }
  }
  return [...filenames];
}

export function uploadMayStart(group: UploadGroup): boolean {
  if (group.kind === 'greenhouse') return true;
  const wrapper = stillAssociated(group) && workdayResumeWrapper(group.element);
  return !!wrapper && !workdayUploadBusy(wrapper) && !workdayRemoveButtons(wrapper).length;
}

function attachmentFilenames(group: UploadGroup): string[] {
  if (!stillAssociated(group)) return [];
  if (group.kind === 'workday') return workdayFilenames(workdayResumeWrapper(group.element)!);
  const { element } = group;
  const inGroup = (node: Element) => node.closest('.file-upload') === element && !node.closest('[aria-busy="true"]');
  const filenames = [...element.querySelectorAll('.file-upload__filename')].filter(node => inGroup(node) && visible(node));
  const removeControls = [...element.querySelectorAll('button')].filter(button => inGroup(button) && writable(button)
    && /\b(?:remove|delete)\b/i.test([button.getAttribute('aria-label'), button.title, button.textContent].join(' ')));
  const filename = filenames.length === 1 && removeControls.length === 1 && filenames[0].textContent?.trim();
  return filename ? [filename] : [];
}

export function attachmentFilename(group: UploadGroup): string | undefined {
  return attachmentFilenames(group)[0];
}

export function hasAttachmentReceipt(group: UploadGroup, expected: string): boolean {
  return attachmentFilenames(group).includes(expected);
}

export async function waitForAttachment(group: UploadGroup, expected: string): Promise<boolean> {
  const win = group.element.ownerDocument.defaultView;
  if (!win || !group.element.isConnected) return false;
  return new Promise(resolve => {
    const observer = new win.MutationObserver(check);
    const timeout = win.setTimeout(() => finish(false), group.kind === 'workday' ? 8000 : 2000);
    function finish(found: boolean) {
      observer.disconnect();
      win!.clearTimeout(timeout);
      resolve(found);
    }
    function check() {
      if (group.kind === 'workday') {
        if (!group.element.isConnected || group.element.closest('[data-automation-id="applyFlowMyExpPage"]') !== group.page) return finish(false);
        // The uploader can remount, and another attachment can finish first.
        if (hasAttachmentReceipt(group, expected)) finish(true);
        return;
      }
      if (!stillAssociated(group)) return finish(false);
      const filename = attachmentFilename(group);
      if (filename) finish(filename === expected);
    }
    observer.observe(group.kind === 'workday' ? group.page : group.element,
      { childList: true, subtree: true, characterData: true, attributes: true });
    check();
  });
}
