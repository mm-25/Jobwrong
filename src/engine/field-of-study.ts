import type { Education } from '../shared/types';
import { normalize, writable, type Choice, type Field } from './discovery';
import { workdayPrompt } from './workday-controls';

const researchLabels = new Set(['ux research', 'user experience research']);

export function formatFieldOfStudy(field: Field, record: Education): {
  answer?: string;
  semantic?: 'visible';
  choiceRank?: (choice: Choice) => number;
} {
  const primary = record.fieldOfStudy;
  const workday = field.kind === 'combobox' && workdayPrompt(field.element);
  if (field.multiple || (field.kind !== 'select' && !workday)) return { answer: primary };

  const configured = [primary, ...(record.fieldOfStudyAlternatives ?? [])].filter(value => value.trim());
  const preferred = configured.filter(value => normalize(value) !== 'other');
  if (configured.some(value => normalize(value) === 'other')) preferred.push('Other');
  const labels = preferred.map(normalize);
  const rank = (choice: Choice): number => {
    const label = normalize(choice.label);
    const index = labels.findIndex(candidate => candidate === label || (researchLabels.has(candidate) && researchLabels.has(label)));
    // Keep the exact caption ahead of its alias within the same preference.
    return index < 0 ? 0 : 2 * (labels.length - index) - Number(labels[index] !== label);
  };
  if (workday) return preferred.length ? { answer: preferred[0], choiceRank: rank } : {};

  let maximum = 0;
  let best: Choice | undefined;
  for (const choice of field.choices) {
    if (!writable(choice.element)) continue;
    const score = rank(choice);
    if (!score || score < maximum) continue;
    best = score > maximum ? choice : undefined;
    maximum = score;
  }
  return { answer: best?.label, semantic: 'visible' };
}
