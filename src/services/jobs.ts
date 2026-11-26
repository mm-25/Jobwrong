import { JOB_CHANNEL, type FieldFocusTarget, type JobCommand, type JobReply } from '../shared/jobs';
import type { FieldFocusResult } from '../shared/types';
import { extensionAPI } from './extension-api';

export async function activePageJob(command: JobCommand, overwrite = false): Promise<JobReply> {
  const api = extensionAPI();
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('Open a job application in a normal web tab.');
  if (!api.runtime.sendMessage) throw new Error('Reload the extension to enable on-page autofill.');
  const result = await api.runtime.sendMessage<JobReply>({ channel: JOB_CHANNEL, command, tabId: tab.id, url: tab.url, overwrite });
  if (result.error) throw new Error(result.error);
  return result;
}

/** Uses the reviewed tab binding instead of looking up whichever tab is active later. */
export async function focusPageField(tabId: number, url: string, focus: FieldFocusTarget): Promise<FieldFocusResult> {
  const api = extensionAPI();
  if (!api.runtime.sendMessage) throw new Error('Reload the extension to locate application fields.');
  const reply = await api.runtime.sendMessage<JobReply>({ channel: JOB_CHANNEL, command: 'focus', tabId, url, focus });
  if (reply.error) throw new Error(reply.error);
  return reply.focus ?? { focused: false, reason: 'This field is unavailable. Refresh the field review.' };
}
