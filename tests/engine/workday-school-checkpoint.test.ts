import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

const institution = 'Example University';

function application(afterSelection?: (degree: HTMLSelectElement) => void) {
  document.body.innerHTML = `<div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Education-section"><h4 id="Education-section">Education</h4>
      <div role="group" aria-labelledby="Education-1-panel"><h5 id="Education-1-panel">Education 1</h5>
        <div data-automation-id="formField-school">
          <label for="education-5--school">School or University</label>
          <div id="school-widget" data-automation-id="multiSelectContainer">
            <div data-automation-id="multiselectInputContainer">
              <div data-automation-id="promptSelectionLabel"></div>
              <p id="school-instruction" data-automation-id="promptAriaInstruction" aria-hidden="true">0 items selected</p>
              <input id="education-5--school" aria-describedby="school-instruction" enterkeyhint="search"
                data-uxi-widget-type="selectinput" data-uxi-multiselect-id="school-widget">
            </div>
          </div>
        </div>
        <label>Degree <select id="education-5--degree"><option>Master of Science</option><option>Bachelor of Science</option></select></label>
        <label>GPA <input id="education-5--gradeAverage"></label>
      </div>
    </div>
  </div>`;
  const school = document.querySelector<HTMLInputElement>('#education-5--school')!;
  const degree = document.querySelector<HTMLSelectElement>('#education-5--degree')!;
  const gpa = document.querySelector<HTMLInputElement>('#education-5--gradeAverage')!;
  const widget = document.getElementById('school-widget')!;
  const instruction = document.getElementById('school-instruction')!;
  const portal = document.createElement('div');
  portal.dataset.automationId = 'responsiveMonikerPrompt';
  portal.dataset.associatedWidget = widget.id;
  portal.dataset.automationType = 'singleSelectPrompt';
  portal.dataset.uxiPromptType = 'singleselect';
  const view = document.createElement('div');
  view.dataset.uxiWidgetType = 'multiselectlist';
  view.dataset.uxiMultiselectlistIsresponsive = 'false';
  view.dataset.uxiMultiselectlistIssearch = 'false';
  view.innerHTML = '<div role="listbox" data-automation-id="activeListContainer">No Items</div>';
  portal.append(view);
  school.addEventListener('click', () => document.body.append(portal));
  school.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    view.dataset.uxiMultiselectlistIssearch = 'true';
    view.innerHTML = `<div role="listbox" data-automation-id="activeListContainer"><div role="presentation">
      <div id="menuItem-school-1" data-automation-id="menuItem" role="option" aria-label="${institution} not checked"
        aria-selected="false" aria-posinset="1" aria-setsize="1">
        <div data-automation-id="promptLeafNode" data-uxi-multiselect-id="school-widget"
          data-uxi-multiselectlistitem-hassidecharm="false"><div data-automation-id="promptOption">${institution}</div></div>
      </div></div></div>`;
  });
  portal.addEventListener('click', () => {
    school.value = '';
    portal.remove();
    instruction.textContent = `1 item selected, ${institution}`;
    widget.insertAdjacentHTML('beforeend', `<ul role="listbox" data-automation-id="selectedItemList"
      data-uxi-multiselect-id="school-widget"><li role="option" data-automation-id="selectedItem"
      aria-label="${institution}, press delete to clear value.">
      <div data-automation-id="DELETE_charm" role="presentation" aria-hidden="true" tabindex="-1"></div>
      <div data-automation-id="promptOption">${institution}</div></li></ul>`);
    school.dispatchEvent(new Event('change', { bubbles: true }));
    afterSelection?.(degree);
  });
  const profile = emptyProfile();
  profile.education = [{ school: institution, degree: 'Master of Science', fieldOfStudy: '', startDate: '', endDate: '', gpa: '3.8' }];
  return { degree, gpa, profile };
}

test('accepts the verified school selection after its own input dispatches change', async () => {
  const { gpa, profile } = application();
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  const school = scan.fields.find(field => field.label === 'School or University')!;
  expect(school.status).toBe('ready');
  const fill = await engine.fill(scan.scanId);
  expect(fill.entries).toContainEqual(expect.objectContaining({ id: school.id, status: 'filled' }));
  expect(gpa.value).toBe('3.8');
});

test('preserves a changed degree and leaves remaining education details blank', async () => {
  const { degree, gpa, profile } = application(sibling => {
    sibling.value = 'Bachelor of Science';
    sibling.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  const school = scan.fields.find(field => field.label === 'School or University')!;
  const fill = await engine.fill(scan.scanId);
  expect(fill.entries).toContainEqual(expect.objectContaining({ id: school.id, status: 'failed' }));
  expect(degree.value).toBe('Bachelor of Science');
  expect(gpa.value).toBe('');
});
