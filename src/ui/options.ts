import { emptyProfile, exportProfile, MAX_RESUME_BYTES, parseProfile } from '../shared/profile';
import { withRequestedDefaults } from '../shared/requested-defaults';
import type { AIProvider, AISettings, ApplicationDefaults, Education, Employment, PersonalDetails, Profile, ResumeAttachment, SavedAnswer, WorkAuthorization } from '../shared/types';
import { requestAIPermission } from '../services/ai';
import { extensionAPI } from '../services/extension-api';
import { pingVault } from '../services/vault';
import { clearLocalData, DEFAULT_AI_MODELS, loadAISettings, loadProfile, saveAISettings, saveProfile } from '../services/storage';
import { byId, element, errorMessage, showNotice } from './dom';

type FieldSpec<T> = {
  key: keyof T;
  label: string;
  type?: 'email' | 'tel' | 'url' | 'multiline' | 'line-list' | 'checkbox' | 'yes-no';
  placeholder?: string;
  autocomplete?: AutoFill;
  wide?: boolean;
  required?: boolean;
};

const personalFields: FieldSpec<PersonalDetails>[] = [
  { key: 'firstName', label: 'First name', autocomplete: 'given-name' },
  { key: 'lastName', label: 'Last name', autocomplete: 'family-name' },
  { key: 'middleName', label: 'Middle name', autocomplete: 'additional-name' },
  { key: 'preferredFirstName', label: 'Preferred first name' },
  { key: 'preferredMiddleName', label: 'Preferred middle name' },
  { key: 'preferredLastName', label: 'Preferred last name' },
  { key: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel', autocomplete: 'tel' },
  { key: 'phoneCountryCode', label: 'Phone country code', autocomplete: 'tel-country-code', placeholder: '+1' },
  { key: 'phoneType', label: 'Phone type', placeholder: 'Mobile' },
  { key: 'address', label: 'Street address', autocomplete: 'address-line1', wide: true },
  { key: 'address2', label: 'Address line 2', autocomplete: 'address-line2', wide: true },
  { key: 'city', label: 'City', autocomplete: 'address-level2' },
  { key: 'county', label: 'County' },
  { key: 'state', label: 'State or region', autocomplete: 'address-level1' },
  { key: 'postalCode', label: 'Postal code', autocomplete: 'postal-code' },
  { key: 'country', label: 'Country', autocomplete: 'country-name' },
  { key: 'linkedin', label: 'LinkedIn', type: 'url' },
  { key: 'website', label: 'Personal website', type: 'url' },
  { key: 'github', label: 'GitHub', type: 'url' },
];

const employmentFields: FieldSpec<Employment>[] = [
  { key: 'company', label: 'Company' },
  { key: 'title', label: 'Job title' },
  { key: 'location', label: 'Location', wide: true },
  { key: 'startDate', label: 'Start date', placeholder: 'YYYY-MM' },
  { key: 'endDate', label: 'End date', placeholder: 'YYYY-MM' },
  { key: 'current', label: 'I work here now', type: 'checkbox', wide: true },
  { key: 'description', label: 'Description', type: 'multiline', wide: true },
];

const educationFields: FieldSpec<Education>[] = [
  { key: 'school', label: 'School', wide: true },
  { key: 'campus', label: 'Campus', placeholder: 'Ann Arbor' },
  { key: 'degree', label: 'Degree' },
  { key: 'degreeAlternatives', label: 'Accepted degree alternatives (one per line, in preference order)', type: 'line-list', wide: true },
  { key: 'fieldOfStudy', label: 'Field of study' },
  { key: 'fieldOfStudyAlternatives', label: 'Field of study alternatives (one per line, in preference order)', type: 'line-list', wide: true },
  { key: 'startDate', label: 'Start date', placeholder: 'YYYY-MM' },
  { key: 'endDate', label: 'End date', placeholder: 'YYYY-MM' },
  { key: 'gpa', label: 'GPA' },
  { key: 'current', label: 'Currently studying', type: 'yes-no' },
];

const workAuthorizationFields: FieldSpec<WorkAuthorization>[] = [
  { key: 'country', label: 'Country', wide: true, required: true },
  { key: 'authorized', label: 'Authorized to work', type: 'yes-no' },
  { key: 'fullTimeAuthorized', label: 'Authorized for full-time work', type: 'yes-no' },
  { key: 'sponsorshipRequired', label: 'Requires sponsorship', type: 'yes-no' },
];

const answerFields: FieldSpec<SavedAnswer>[] = [
  { key: 'question', label: 'Question', wide: true, required: true },
  { key: 'answer', label: 'Answer', type: 'multiline', wide: true, required: true },
];

const profileForm = byId<HTMLFormElement>('profile-form');
const profileFieldset = byId<HTMLFieldSetElement>('profile-fields');
const saveProfileButton = byId<HTMLButtonElement>('save-profile');
const profileStatus = byId('profile-status');
const aiForm = byId<HTMLFormElement>('ai-form');
const aiFieldset = byId<HTMLFieldSetElement>('ai-fields');
const aiStatus = byId('ai-status');
const aiEnabled = byId<HTMLInputElement>('ai-enabled');
const aiInterpretQuestions = byId<HTMLInputElement>('ai-interpret-questions');
const aiUseVault = byId<HTMLInputElement>('ai-use-vault');
const vaultTest = byId<HTMLButtonElement>('vault-test');
const vaultStatus = byId('vault-status');
byId('extension-id').textContent = extensionAPI().runtime.id ?? 'Unavailable outside the installed extension';
const aiProvider = byId<HTMLSelectElement>('ai-provider');
const claudeKeyHint = byId('claude-key-hint');
const aiKey = byId<HTMLInputElement>('ai-key');
const aiModel = byId<HTMLInputElement>('ai-model');
const personalList = byId('personal-fields');
const employmentList = byId('employment-list');
const educationList = byId('education-list');
const skillsInput = byId<HTMLTextAreaElement>('skills');
const workAuthorizationList = byId('work-authorization-list');
const defaultsControls: Record<keyof ApplicationDefaults, HTMLSelectElement> = {
  visaSponsorship: byId('default-visa-sponsorship'),
  gender: byId('default-gender'),
  disability: byId('default-disability'),
  veteran: byId('default-veteran'),
  hispanicLatino: byId('default-hispanic-latino'),
  acceptApplicationPrivacy: byId('default-privacy'),
  relocation: byId('default-relocation'),
  onsiteWork: byId('default-onsite-work'),
  raceEthnicity: byId('default-race-ethnicity'),
  referralSource: byId('default-referral-source'),
};
const defaultsKeys = Object.keys(defaultsControls) as (keyof ApplicationDefaults)[];
const answerList = byId('answer-list');
const addEmployment = byId<HTMLButtonElement>('add-employment');
const addEducation = byId<HTMLButtonElement>('add-education');
const addWorkAuthorization = byId<HTMLButtonElement>('add-work-authorization');
const addAnswer = byId<HTMLButtonElement>('add-answer');
const resumeInput = byId<HTMLInputElement>('resume-file');
const resumeStatus = byId('resume-status');
const resumeCurrent = byId('resume-current');
const resumeName = byId('resume-name');
const removeResume = byId<HTMLButtonElement>('remove-resume');
const importInput = byId<HTMLInputElement>('profile-import');
const importButton = byId<HTMLButtonElement>('import-profile');
const exportButton = byId<HTMLButtonElement>('export-profile');
const clearButton = byId<HTMLButtonElement>('clear-data');
const dataStatus = byId('data-status');

const resumeTypes = new Map([
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
]);

let profile: Profile;
let profileLoaded = false;
let aiLoaded = false;
let initialized = false;
let profileBusy = false;
let aiBusy = false;
let dirty = false;

function updateControls(): void {
  profileFieldset.disabled = saveProfileButton.disabled = !profileLoaded || profileBusy;
  importButton.disabled = exportButton.disabled = !profileLoaded || profileBusy;
  aiFieldset.disabled = !aiLoaded || aiBusy;
  clearButton.disabled = !initialized || profileBusy || aiBusy;
}

function markDirty(): void {
  dirty = true;
  if (profileStatus.textContent !== 'Unsaved changes.') showNotice(profileStatus, 'Unsaved changes.');
}

function renderFields<T extends object>(record: T, specs: FieldSpec<T>[], container: HTMLElement): void {
  container.replaceChildren();
  for (const spec of specs) {
    const value = record[spec.key];
    const label = element('label', spec.type === 'checkbox' ? 'check-line' : 'field');
    if (spec.wide) label.classList.add('wide');
    const caption = element('span', 'field-label', spec.label);

    if (spec.type === 'checkbox') {
      const input = element('input');
      input.type = 'checkbox';
      input.checked = Boolean(value);
      input.addEventListener('change', () => {
        Object.assign(record, { [spec.key]: input.checked });
        markDirty();
      });
      label.append(input, caption);
    } else if (spec.type === 'yes-no') {
      const input = element('select');
      input.add(new Option('Unanswered', ''));
      input.add(new Option('Yes', 'yes'));
      input.add(new Option('No', 'no'));
      if (value === true) input.value = 'yes';
      if (value === false) input.value = 'no';
      input.addEventListener('change', () => {
        Object.assign(record, { [spec.key]: input.value ? input.value === 'yes' : undefined });
        markDirty();
      });
      label.append(caption, input);
    } else {
      const list = spec.type === 'line-list';
      const input = spec.type === 'multiline' || list ? element('textarea') : element('input');
      if (input instanceof HTMLInputElement) {
        if (spec.type === 'url') input.inputMode = 'url';
        else if (spec.type && spec.type !== 'multiline' && !list) input.type = spec.type;
        if (spec.autocomplete) input.autocomplete = spec.autocomplete;
      }
      input.placeholder = spec.placeholder ?? '';
      input.value = Array.isArray(value) ? value.join('\n') : String(value ?? '');
      input.required = spec.required ?? false;
      input.addEventListener('input', () => {
        Object.assign(record, { [spec.key]: list ? input.value.split('\n') : input.value });
        markDirty();
      });
      label.append(caption, input);
    }
    container.append(label);
  }
}

function renderRecords<T extends object>(
  records: T[],
  specs: FieldSpec<T>[],
  title: string,
  list: HTMLElement,
  addButton: HTMLButtonElement,
  emptyMessage: string,
  heading: 'h3' | 'h4',
): void {
  list.replaceChildren();
  if (!records.length) {
    list.append(element('p', 'record-empty', emptyMessage));
    return;
  }

  records.forEach((record, index) => {
    const name = `${title} ${index + 1}`;
    const card = element('div', 'record');
    const header = element('div', 'record-head');
    const remove = element('button', 'button quiet', 'Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${name.toLowerCase()}`);
    remove.addEventListener('click', () => {
      records.splice(index, 1);
      renderRecords(records, specs, title, list, addButton, emptyMessage, heading);
      markDirty();
      addButton.focus();
    });
    const fields = element('div', 'field-grid');
    renderFields(record, specs, fields);
    header.append(element(heading, undefined, name), remove);
    card.append(header, fields);
    list.append(card);
  });
}

function renderEmployment(): void {
  renderRecords(
    profile.employment, employmentFields, 'Role', employmentList, addEmployment, 'No employment added.', 'h4',
  );
}

function renderEducation(): void {
  renderRecords(
    profile.education, educationFields, 'Education', educationList, addEducation, 'No education added.', 'h4',
  );
}

function renderWorkAuthorizations(): void {
  renderRecords(
    profile.workAuthorizations ?? [], workAuthorizationFields, 'Country', workAuthorizationList,
    addWorkAuthorization, 'No work authorization details added.', 'h3',
  );
}

function renderApplicationDefaults(): void {
  for (const key of defaultsKeys) {
    const value = profile.applicationDefaults?.[key];
    defaultsControls[key].value = typeof value === 'boolean' ? (value ? 'yes' : 'no') : (value ?? '');
  }
}

function renderAnswers(): void {
  renderRecords(
    profile.answers, answerFields, 'Answer', answerList, addAnswer, 'No answers saved.', 'h3',
  );
}

function renderResume(): void {
  resumeCurrent.hidden = !profile.resume;
  resumeName.textContent = profile.resume?.name ?? '';
  resumeStatus.textContent = profile.resume ? '' : 'No resume attached.';
}

function renderProfile(): void {
  renderFields(profile.personal, personalFields, personalList);
  renderEmployment();
  renderEducation();
  skillsInput.value = profile.skills?.join('\n') ?? '';
  renderWorkAuthorizations();
  renderApplicationDefaults();
  renderAnswers();
  renderResume();
}

function focusNewRecord(list: HTMLElement): void {
  markDirty();
  list.lastElementChild?.querySelector('input')?.focus();
}

addEmployment.addEventListener('click', () => {
  profile.employment.push({ company: '', title: '', location: '', startDate: '', endDate: '', current: false, description: '' });
  renderEmployment();
  focusNewRecord(employmentList);
});

addEducation.addEventListener('click', () => {
  profile.education.push({ school: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '', gpa: '' });
  renderEducation();
  focusNewRecord(educationList);
});

skillsInput.addEventListener('input', () => {
  profile.skills = skillsInput.value.split('\n');
  markDirty();
});

addWorkAuthorization.addEventListener('click', () => {
  (profile.workAuthorizations ??= []).push({ country: '' });
  renderWorkAuthorizations();
  focusNewRecord(workAuthorizationList);
});

for (const key of defaultsKeys) {
  const input = defaultsControls[key];
  input.addEventListener('change', () => {
    const defaults = profile.applicationDefaults ??= {};
    if (!input.value) delete defaults[key];
    else Object.assign(defaults, { [key]: key === 'acceptApplicationPrivacy' ? input.value === 'yes' : input.value });
    markDirty();
  });
}

addAnswer.addEventListener('click', () => {
  profile.answers.push({ question: '', answer: '' });
  renderAnswers();
  focusNewRecord(answerList);
});

function readResume(file: File): Promise<ResumeAttachment> {
  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  const type = extension ? resumeTypes.get(extension) : undefined;
  if (!type || !file.size) return Promise.reject(new Error('Choose a PDF, DOC, or DOCX resume.'));
  if (file.size > MAX_RESUME_BYTES) return Promise.reject(new Error('Choose a resume that is 2 MiB or smaller.'));

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read this resume.'));
        return;
      }
      resolve({ name: file.name, type, dataUrl: reader.result, lastModified: file.lastModified });
    });
    reader.addEventListener('error', () => reject(new Error('Could not read this resume.')));
    reader.readAsDataURL(new Blob([file], { type }));
  });
}

resumeInput.addEventListener('change', async () => {
  const file = resumeInput.files?.[0];
  resumeInput.value = '';
  if (!file) return;

  profileBusy = true;
  updateControls();
  try {
    const resume = await readResume(file);
    profile.resume = resume;
    renderResume();
    markDirty();
    resumeStatus.textContent = 'Resume added. Save the profile to keep it.';
  } catch (error) {
    resumeStatus.textContent = errorMessage(error, 'Could not attach this resume.');
  } finally {
    profileBusy = false;
    updateControls();
  }
});

removeResume.addEventListener('click', () => {
  delete profile.resume;
  renderResume();
  markDirty();
  resumeInput.focus();
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!profileLoaded || profileBusy) return;
  profileBusy = true;
  updateControls();
  showNotice(profileStatus, 'Saving profile…');
  try {
    await saveProfile(profile);
    dirty = false;
    showNotice(profileStatus, 'Profile saved.', 'success');
  } catch (error) {
    showNotice(profileStatus, errorMessage(error, 'Could not save the profile.'), 'error');
  } finally {
    profileBusy = false;
    updateControls();
    saveProfileButton.focus();
  }
});

function selectedProvider(): AIProvider {
  return aiProvider.value === 'openai' ? 'openai' : 'anthropic';
}

function updateProviderFields(provider: AIProvider): void {
  aiModel.placeholder = DEFAULT_AI_MODELS[provider];
  claudeKeyHint.hidden = provider !== 'anthropic';
  aiUseVault.disabled = provider !== 'anthropic';
  if (claudeKeyHint.hidden) aiKey.removeAttribute('aria-describedby');
  else aiKey.setAttribute('aria-describedby', claudeKeyHint.id);
}

function renderAISettings(settings: AISettings & { provider: AIProvider }): void {
  aiProvider.value = settings.provider;
  aiEnabled.checked = settings.enabled;
  aiInterpretQuestions.checked = settings.interpretQuestions !== false;
  aiUseVault.checked = settings.useVault === true;
  aiKey.value = settings.apiKey;
  aiModel.value = settings.model;
  updateProviderFields(settings.provider);
}

aiProvider.addEventListener('change', () => {
  const provider = selectedProvider();
  aiKey.value = '';
  aiModel.value = DEFAULT_AI_MODELS[provider];
  updateProviderFields(provider);
  showNotice(aiStatus, '');
});

aiForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!aiLoaded || aiBusy) return;
  const apiKey = aiKey.value.trim();
  const provider = selectedProvider();
  const enabled = aiEnabled.checked;
  const interpretQuestions = aiInterpretQuestions.checked;
  const useVault = provider === 'anthropic' && aiUseVault.checked;
  const model = aiModel.value.trim() || DEFAULT_AI_MODELS[provider];
  if (enabled && !apiKey) {
    showNotice(aiStatus, 'Enter your API key to enable suggestions.', 'error');
    aiKey.focus();
    return;
  }

  aiBusy = true;
  updateControls();
  try {
    if (enabled && !await requestAIPermission(provider, useVault)) {
      showNotice(aiStatus, 'Allow access to your AI provider to enable suggestions.', 'error');
      return;
    }
    await saveAISettings({ provider, enabled, apiKey, model, interpretQuestions, useVault });
    aiModel.value = model;
    showNotice(aiStatus, 'AI settings saved.', 'success');
  } catch (error) {
    showNotice(aiStatus, errorMessage(error, 'Could not save AI settings.'), 'error');
  } finally {
    aiBusy = false;
    updateControls();
  }
});

aiForm.addEventListener('input', () => showNotice(aiStatus, ''));
vaultTest.addEventListener('click', async event => {
  if (!event.isTrusted || aiBusy || !aiLoaded) return;
  aiBusy = true; updateControls();
  try {
    const allowed = await extensionAPI().permissions.request({ permissions: ['nativeMessaging'] });
    if (!allowed) { showNotice(vaultStatus, 'Allow the local connection to use Obsidian notes.', 'error'); return; }
    const reply = await pingVault();
    showNotice(vaultStatus, reply.ok ? `Connected to ${reply.rootLabel || 'your notes'}.` : reply.error || 'The Obsidian helper is unavailable.', reply.ok ? 'success' : 'error');
  } catch { showNotice(vaultStatus, 'The Obsidian helper is unavailable. Check its installation, then try again.', 'error'); }
  finally { aiBusy = false; updateControls(); }
});
importButton.addEventListener('click', () => importInput.click());

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  importInput.value = '';
  if (!file || profileBusy) return;

  profileBusy = true;
  updateControls();
  try {
    const imported = parseProfile(JSON.parse(await file.text()));
    if (dirty && !window.confirm('Replace the unsaved profile edits with this imported profile?')) return;
    profile = withRequestedDefaults(imported);
    renderProfile();
    markDirty();
    showNotice(profileStatus, 'Profile imported. Save to keep these changes.');
    showNotice(dataStatus, 'Profile imported into the editor. Select Save profile to keep the changes.', 'success');
  } catch (error) {
    const message = error instanceof SyntaxError
      ? 'This file contains invalid JSON. Choose a JobRight Local profile export.'
      : errorMessage(error, 'Could not import this file.');
    showNotice(dataStatus, message, 'error');
  } finally {
    profileBusy = false;
    updateControls();
  }
});

exportButton.addEventListener('click', () => {
  try {
    const blob = new Blob([exportProfile(profile)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const download = element('a');
    download.href = url;
    download.download = 'jobright-local-profile.json';
    document.body.append(download);
    download.click();
    download.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    showNotice(dataStatus, 'Profile exported.', 'success');
  } catch (error) {
    showNotice(dataStatus, errorMessage(error, 'Could not export the profile.'), 'error');
  }
});

clearButton.addEventListener('click', async () => {
  if (profileBusy || aiBusy) return;
  if (!window.confirm('Clear the profile, resume, saved answers, and AI settings from this browser?')) return;
  profileBusy = aiBusy = true;
  updateControls();
  try {
    await clearLocalData();
    profile = withRequestedDefaults(emptyProfile());
    profileLoaded = aiLoaded = true;
    renderProfile();
    renderAISettings({ provider: 'anthropic', enabled: false, apiKey: '', model: DEFAULT_AI_MODELS.anthropic });
    dirty = false;
    showNotice(profileStatus, '');
    showNotice(aiStatus, '');
    showNotice(dataStatus, 'Local data cleared.', 'success');
  } catch (error) {
    showNotice(dataStatus, errorMessage(error, 'Could not clear local data.'), 'error');
  } finally {
    profileBusy = aiBusy = false;
    updateControls();
  }
});

async function initialize(): Promise<void> {
  const profileLoad = loadProfile().then((saved) => {
    profile = saved;
    profileLoaded = true;
    renderProfile();
  }).catch((error: unknown) => {
    showNotice(profileStatus, errorMessage(error, 'Could not load your profile.'), 'error');
  });

  const aiLoad = loadAISettings().then((settings) => {
    renderAISettings(settings);
    aiLoaded = true;
  }).catch((error: unknown) => {
    showNotice(aiStatus, errorMessage(error, 'Could not load AI settings.'), 'error');
  });

  await Promise.all([profileLoad, aiLoad]);
  initialized = true;
  updateControls();
}

void initialize();
