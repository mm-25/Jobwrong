# Chromium 0.8.8 release verification

Verified November 25, 2026. This report applies to the public release checkout, which preserves blank profiles and explicit saved/imported facts.

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Unit/service tests | 1,167 passed across 96 files |
| Chromium DOM tests | 101 passed |
| Installed Chromium extension tests | 14 passed |
| Popup and Profile UI checks | Both passed |
| Source comparison | Autofill engine matches the local 0.8.8 build; public preset migration remains the existing no-op |

The first installed-extension run exposed three test scenarios that depended on personal preset facts despite the public build starting blank. Their fixtures now save explicit synthetic preferences. All 14 installed-extension tests then passed. No production answer inference was added to make those tests pass.

Tests use synthetic forms/provider responses and never submit applications. Earlier live testing accepted Workday employment dates and both education records through Save and Continue, and confirmed specific Lever and Greenhouse fields. The newest 0.8.8 country/sponsorship and numbered/native-placeholder changes still await installed Brave verification. See [coverage and AI behavior](status-and-ai.md).

The downloadable Chromium ZIP is built from this source tree; its checksum is supplied with the release. Firefox artifacts are not built for this release. Personal profiles, credentials, résumé files, vault contents and live captures are excluded.
