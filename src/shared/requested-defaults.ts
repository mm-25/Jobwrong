import type { Profile } from './types';

// Public installations start without personal facts or consent preferences.
// Preserve explicit saved/imported choices, including deliberately blank answers.
export function withRequestedDefaults(profile: Profile): Profile {
  if (profile.applicationDefaults !== undefined) return profile;
  return { ...profile, applicationDefaults: {} };
}

// Keep the migration API compatible with existing local storage revisions.
// No revision may infer demographic, authorization, or education facts.
export function migrateRequestedDefaults(profile: Profile, _previousRevision = 0): Profile {
  return withRequestedDefaults(profile);
}
