export function detectPlatform(doc: Document): string {
  const host = doc.location?.hostname ?? '';
  const supported = [
    { name: 'Lever', host: /(^|\.)lever\.co$/, marker: '.application-form .application-question, form[action*="lever.co"]' },
    {
      name: 'Greenhouse',
      host: /(^|\.)(?:greenhouse\.io|greenhouse\.com)$/,
      marker: '#application_form, form[action*="greenhouse.io"], form.gh-apply-form:has(input[id^="gh-"])',
    },
    { name: 'Ashby', host: /(^|\.)ashbyhq\.com$/, marker: '.ashby-application-form, .ashby-application-form-field-entry, form[data-field-path]' },
    { name: 'Workday', host: /(^|\.)(?:myworkdayjobs\.com|myworkdaysite\.com|workday\.com)$/, marker: '[data-automation-id="workExperienceSection"], [data-automation-id="myExperiencePage"], [data-automation-id="applyFlowMyExpPage"], [data-automation-id="legalNameSection"]' },
    { name: 'iCIMS', host: /(^|\.)icims\.com$/, marker: '.iCIMS_MainWrapper, .iCIMS_JobApplication, #iCIMS_MainWrapper, form[action*="icims.com"]' },
  ];
  return supported.find((entry) => entry.host.test(host))?.name
    ?? supported.find((entry) => doc.querySelector(entry.marker))?.name
    ?? 'Generic';
}
