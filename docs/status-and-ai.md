# Chromium 0.8.8: coverage and AI

This is a testing release, not a claim of complete compatibility with every employer form. It never submits applications. New public installations start with blank profiles and preferences; saved or imported values are preserved. No personal preset migrations, API keys, résumés, vault contents or live-form captures are included in the repository or release ZIP.

## What works

| Area | Behavior and evidence |
| --- | --- |
| Direct Autofill | One click fills supported fields from saved facts. Standard text, native dropdowns, radio buttons, checkboxes and recognized custom dropdowns have regression coverage. Existing answers are preserved by default. |
| Workday experience | Live testing created seven work-history rows, filled all 13 employment month/year pairs, and passed Save and Continue validation. Portfolio and GitHub rows were also added. |
| Workday education | Live testing created and completed two education records, including school, degree and study choices. Saved values persisted in a fresh draft. Configure campus, degree alternatives and study alternatives in Profile; different awards are not automatically interchangeable. |
| Lever | A Palantir draft reached 17 filled fields with zero failed writes, including authorization, referral and portfolio; 11 fields still needed attention. |
| Greenhouse | A Figma draft's city selection was verified twice with Undo between runs. Recognized Greenhouse uploads, phone-country controls and embedded forms have targeted tests; this does not establish coverage of every employer variant. |
| Navigation and Undo | Remaining-field links jump to the scanned control. Undo protects manual edits. Some controls have no safe blank/reset option, so those selections are retained and reported. Added record containers and server-owned uploads are retained. |

## New in 0.8.8, awaiting live retest

- Numbered questions are matched without the number prefix. Native selects whose leading placeholder uses a nonempty value are recognized as blank. Lawful entitlement to employment is recognized as authorization wording. These shared fixes came from Lake Trust; there is no dedicated Cornerstone adapter.
- Workday country-relative authorization can use public metadata for the exact job. The lookup sends no profile data or cookies and rejects unverified, conflicting or multiple-country context. Navigation or a replaced page/step/form cancels a pending scan; manual edits and clears remain protected.
- A saved sponsorship Yes can prove a narrowly recognized immigration-filing OR sponsorship question. Sponsorship No does not establish whether another immigration filing is required.

These changes have unit and Chromium browser tests. Their installed Brave verification remains pending. Earlier live date, education and Lever/Greenhouse results above remain separate evidence.

## What remains limited

- Unrecognized site structures, ambiguous options, unknown facts and missing profile values can still require manual entry. AI does not remove those limits.
- Signatures, credentials, general contracts and attestations remain manual. Only narrowly recognized applicant-privacy checkboxes support an explicit saved opt-in.
- Most compound legal questions, employer history, family relationships, criminal history and similar personal facts cannot be inferred from general profile details.
- Skills come from the Profile Skills list; uploading a résumé does not extract that list. File upload support is limited to recognized résumé controls.
- Automatic embedded-form handling is limited to verified Greenhouse bindings and existing same-origin support; other cross-origin applications may need to be opened directly.
- Run Autofill again on each new application step. It does not navigate or submit the whole application for you.
- Firefox/Zen development is paused. This release contains Chromium only.
- Obsidian requires a working local helper and has not been verified with a live vault for this release. Jev is not integrated.

## When and how AI runs

Local matching runs first. Exact saved answers take priority, followed by supported profile/default rules. Network or AI failure leaves these local paths available.

**Automatic question matching:** In Profile → AI settings, select Claude or OpenAI, supply a valid API key and model ID, enable AI, and enable **Match unfamiliar questions during Autofill**. On an Autofill click, eligible unresolved questions are batched to the selected provider. The request contains bounded question wording, visible options and associated static context, not applicant profile values, current form answers, résumé contents or URLs. The API key authenticates the request; it is not prompt content. The provider identifies a known fact, polarity and country where applicable. Local code validates that interpretation and uses the saved fact to fill the control. Unsupported, ambiguous or unsupported compound questions are left unanswered. AI does not control the browser or determine whether a click committed; the engine does that.

**Narrative drafting:** For questions such as why an opportunity interests you, use **Review fields**, optionally add **Notes for this application**, then **Suggest with AI**. This separate request sends eligible questions, employment/education details and those notes. Review or edit the suggestions, select them, choose **Add to preview**, then fill the selected fields. Provide your actual interests for motivation questions; the model is instructed to omit answers requiring invented motivations or qualifications. The normal Autofill button does not silently generate these narratives without the separate Obsidian opt-in.

**Optional Obsidian stage:** With Claude, an explicitly enabled vault connection and a working local helper, Autofill can retrieve relevant notes and fill supported narrative questions from them. Selected excerpts are sent to Claude. This path is separate from ordinary question matching and is currently outside the active verification scope.

Automatic matching permits up to 20 questions per request, at most four requests per run across frames and two per frame, with a 25-second request timeout. Requests stop after provider errors. These are ceilings, not average latency or token-cost claims. Costs depend on the provider/model and actual token usage. Provider handling is covered with simulated responses; this release does not establish that every account/key/model combination currently works.
