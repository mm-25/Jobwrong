// Only extension contexts import this module. The page engine has no storage/key access through our code.
export interface InjectionResult<T> { frameId: number; documentId?: string; result?: T; error?: { message?: string } }
export interface InjectionTarget { tabId: number; allFrames?: boolean; frameIds?: number[]; documentIds?: string[] }
export interface MessageSender { id?: string; url?: string; frameId?: number; documentId?: string; tab?: { id?: number; url?: string } }
export interface ExtensionAPI {
  storage: { local: {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    clear(): Promise<void>;
    setAccessLevel?: (details: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void>;
  }; session?: {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
    setAccessLevel?: (details: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void>;
  } };
  tabs: { query(query: { active: boolean; currentWindow: boolean }): Promise<{ id?: number; url?: string }[]>;
    get?(tabId: number): Promise<{ id?: number; url?: string }> };
  scripting: { executeScript<T>(details: {
    target: InjectionTarget;
    files?: string[];
    // Browser serializes function and arguments; it cannot carry lexical scope.
    func?: (...args: any[]) => any; args?: any[];
  }): Promise<InjectionResult<T>[]> };
  runtime: { id?: string; getURL?(path: string): string; openOptionsPage(): Promise<void>; getBrowserInfo?: () => Promise<unknown>;
    sendMessage?<T>(message: unknown): Promise<T>;
    sendNativeMessage?<T>(application: string, message: unknown): Promise<T>;
    onMessage?: { addListener(listener: (message: unknown, sender: MessageSender, respond: (response: unknown) => void) => boolean | void): void };
  };
  permissions: { request(details: { origins?: string[]; permissions?: string[]; data_collection?: string[] }): Promise<boolean>; contains(details: { origins?: string[]; permissions?: string[]; data_collection?: string[] }): Promise<boolean> };
}
export function extensionAPI(): ExtensionAPI {
  const globals = globalThis as unknown as { browser?: ExtensionAPI; chrome?: ExtensionAPI };
  const api = globals.browser ?? globals.chrome;
  if (!api?.runtime) throw new Error('Open this page from the installed extension.');
  return api;
}

export function senderMatchesApplicationUrl(sender: MessageSender, url: string): boolean {
  if (sender.url === url) return true;
  // Chromium can report the document's original URL after history.replaceState.
  // Only allow that mismatch when the caller can verify the live document ID.
  if (!sender.documentId || !sender.url) return false;
  try { return new URL(sender.url).origin === new URL(url).origin; }
  catch { return false; }
}

export function applicationFrameTarget(tabId: number, frameId: number, documentId?: string): InjectionTarget {
  return documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [frameId] };
}

export function readCurrentApplicationDocuments(api: ExtensionAPI, target: InjectionTarget, topUrl: string, frameUrl: string | null = null) {
  return api.scripting.executeScript<boolean>({
    target,
    func: (expectedTopUrl: string, expectedFrameUrl: string | null) => {
      try {
        return window.location.origin === new URL(expectedTopUrl).origin
          && window.top?.location.href === expectedTopUrl
          && (!expectedFrameUrl || window.location.href === expectedFrameUrl);
      } catch { return false; }
    },
    args: [topUrl, frameUrl],
  });
}
