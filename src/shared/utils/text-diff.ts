import type { ProofreadCorrection } from '../types.ts';
import type { ProofreadSelectionRange } from '../proofreading/controller.ts';

export interface TextDiffResult {
  selection: ProofreadSelectionRange;
  delta: number;
  oldDiffEnd: number;
}

const INCREMENTAL_THRESHOLD = 0.7;

export function computeIncrementalSelection(
  oldText: string,
  newText: string
): TextDiffResult | null {
  if (oldText === newText || oldText.length === 0) {
    return null;
  }

  let prefixLen = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }

  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (
    oldSuffix > prefixLen &&
    newSuffix > prefixLen &&
    oldText[oldSuffix - 1] === newText[newSuffix - 1]
  ) {
    oldSuffix--;
    newSuffix--;
  }

  if (prefixLen === oldSuffix && prefixLen === newSuffix) {
    return null;
  }

  let paraStart = prefixLen;
  while (paraStart > 0 && newText[paraStart - 1] !== '\n') {
    paraStart--;
  }

  let paraEnd = newSuffix;
  if (paraEnd <= 0 || newText[paraEnd - 1] !== '\n') {
    while (paraEnd < newText.length && newText[paraEnd] !== '\n') {
      paraEnd++;
    }
    if (paraEnd < newText.length && newText[paraEnd] === '\n') {
      paraEnd++;
    }
  }

  const selectionSize = paraEnd - paraStart;
  if (selectionSize >= newText.length * INCREMENTAL_THRESHOLD) {
    return null;
  }

  return {
    selection: { start: paraStart, end: paraEnd },
    delta: newText.length - oldText.length,
    oldDiffEnd: oldSuffix,
  };
}

export function shiftCorrections(
  corrections: ProofreadCorrection[],
  oldDiffEnd: number,
  delta: number
): ProofreadCorrection[] {
  if (delta === 0) {
    return corrections;
  }

  return corrections.map((c) => {
    if (c.startIndex >= oldDiffEnd) {
      return {
        ...c,
        startIndex: c.startIndex + delta,
        endIndex: c.endIndex + delta,
      };
    }
    return c;
  });
}
