import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

function application() {
  document.body.innerHTML = `<main data-automation-id="applyFlowPage"><div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Education-section"><h4 id="Education-section">Education</h4>
      <div role="group" aria-labelledby="Education-1-panel"><h5 id="Education-1-panel">Education 1</h5>
        <div data-automation-id="formField-schoolName"><label for="education-5--schoolName">School or University</label>
          <input id="education-5--schoolName" value="Example University"></div>
        <div data-automation-id="formField-degree"><label for="education-5--degree">Degree</label>
          <button type="button" id="education-5--degree" aria-haspopup="listbox"
            aria-label="Degree Master of Science Required" value="ms">Master of Science</button></div>
        <div data-automation-id="formField-fieldOfStudy"><label for="education-5--fieldOfStudy">Field of Study</label>
          <div data-automation-id="multiSelectContainer" id="study-widget">
            <div data-automation-id="multiselectInputContainer"><div data-automation-id="promptSelectionLabel"></div>
              <input id="education-5--fieldOfStudy" data-uxi-widget-type="selectinput"
                data-uxi-multiselect-id="study-widget" enterkeyhint="search"></div></div></div>
      </div></div></div></main>`;
  const degree = document.getElementById('education-5--degree') as HTMLButtonElement;
  const study = document.getElementById('education-5--fieldOfStudy') as HTMLInputElement;
  const widget = document.getElementById('study-widget')!;
  function openDegree() {
    degree.setAttribute('aria-controls', 'degree-list');
    degree.setAttribute('aria-expanded', 'true');
    document.body.insertAdjacentHTML('beforeend', `<ul role="listbox" id="degree-list">
      <li role="option" data-value="ms">Master of Science</li><li role="option" data-value="ba">Bachelor of Arts</li></ul>`);
  }
  function closeDegree() {
    degree.removeAttribute('aria-controls');
    degree.removeAttribute('aria-expanded');
    document.getElementById('degree-list')?.remove();
  }
  study.addEventListener('click', () => {
    document.body.insertAdjacentHTML('beforeend', `<div data-automation-id="responsiveMonikerPrompt" data-associated-widget="study-widget"
      data-automation-type="singleSelectPrompt" data-uxi-prompt-type="singleselect">
      <div role="listbox" data-automation-id="activeListContainer"><div role="option" data-automation-id="menuItem"
        id="study-option" aria-label="Web Design not checked" aria-posinset="1" aria-setsize="1">
        <div data-automation-id="promptLeafNode" data-uxi-multiselect-id="study-widget" data-uxi-multiselectlistitem-hassidecharm="false">
          <div data-automation-id="promptOption">Web Design</div></div></div></div></div>`);
    const portal = document.body.lastElementChild!;
    portal.querySelector('[data-automation-id="promptLeafNode"]')!.addEventListener('click', () => {
      portal.remove();
      widget.insertAdjacentHTML('beforeend', `<ul role="listbox" data-automation-id="selectedItemList" data-uxi-multiselect-id="study-widget">
        <li role="option" data-automation-id="selectedItem" aria-label="Web Design, press delete to clear value.">
          <div data-automation-id="promptOption">Web Design</div></li></ul>`);
    });
  });
  const profile = emptyProfile();
  profile.education = [{ school: 'Example University', degree: 'Master of Science', fieldOfStudy: 'Web Design', startDate: '', endDate: '', gpa: '' }];
  return { engine: createEngine(document), profile, degree, study, widget, openDegree, closeDegree };
}

test.each(['opens after scan', 'closes on next focus'])('a sibling dropdown catalog %s without changing the education record', async transition => {
  const { engine, profile, study, widget, openDegree, closeDegree } = application();
  if (transition === 'closes on next focus') openDegree();
  const scan = await engine.scan(profile);
  const field = scan.fields.find(field => field.label === 'Field of Study')!;
  expect(field.status).toBe('ready');
  if (transition === 'opens after scan') openDegree();
  else study.addEventListener('focus', closeDegree);
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 1, failed: 0, skipped: 0 });
  expect(widget.querySelector('[data-automation-id="selectedItem"]')?.textContent?.trim()).toBe('Web Design');
});

test.each(['selected degree', 'question', 'manual edit and restore'])('still rejects a changed sibling %s', async change => {
  const { engine, profile, degree, widget, openDegree } = application();
  const scan = await engine.scan(profile);
  const field = scan.fields.find(field => field.label === 'Field of Study')!;
  openDegree();
  if (change === 'selected degree') {
    degree.value = 'ba';
    degree.textContent = 'Bachelor of Arts';
    degree.setAttribute('aria-label', 'Degree Bachelor of Arts Required');
  } else if (change === 'question') {
    degree.labels![0].textContent = 'Different degree question';
  } else {
    degree.dispatchEvent(new Event('change', { bubbles: true }));
  }
  expect(await engine.fill(scan.scanId, [field.id])).toMatchObject({ filled: 0, skipped: 1 });
  expect(widget.querySelector('[data-automation-id="selectedItem"]')).toBeNull();
});
