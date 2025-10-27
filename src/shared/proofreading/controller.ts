import { debounce, type DebouncedFunction } from '../utils/debounce.ts';
import { undoManager } from '../utils/undo-manager.ts';
import { replaceTextWithUndo } from '../utils/clipboard.ts';
import type { ProofreadCorrection, ProofreadResult } from '../types.ts';
import type { ProofreadingTarget, ProofreadingTargetHooks } from './types.ts';

export interface ProofreadingControllerDependencies {
  runProofread(element: HTMLElement, text: string): Promise<ProofreadResult | null>;
  filterCorrections(
    element: HTMLElement,
    corrections: ProofreadCorrection[],
    text: string
  ): ProofreadCorrection[];
  debounceMs: number;
  getElementText?(element: HTMLElement): string;
}

interface ElementState {
  hooks: ProofreadingTargetHooks;
  corrections: ProofreadCorrection[];
  debouncedProofread: DebouncedFunction<() => void>;
  isApplyingCorrection: boolean;
  isRestoringFromHistory: boolean;
  lastText: string;
}

interface ProofreadOptions {
  force?: boolean;
}

const defaultGetElementText = (element: HTMLElement): string => {
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'textarea' || tagName === 'input') {
    return (element as HTMLTextAreaElement | HTMLInputElement).value;
  }
  return element.textContent || '';
};

const isSameCorrection = (a: ProofreadCorrection, b: ProofreadCorrection): boolean =>
  a.startIndex === b.startIndex &&
  a.endIndex === b.endIndex &&
  a.correction === b.correction;

export class ProofreadingController {
  private readonly states = new Map<HTMLElement, ElementState>();
  private readonly runProofread: ProofreadingControllerDependencies['runProofread'];
  private readonly filterCorrections: ProofreadingControllerDependencies['filterCorrections'];
  private readonly getElementText: (element: HTMLElement) => string;
  private readonly debounceMs: number;

  constructor(dependencies: ProofreadingControllerDependencies) {
    this.runProofread = dependencies.runProofread;
    this.filterCorrections = dependencies.filterCorrections;
    this.debounceMs = dependencies.debounceMs;
    this.getElementText = dependencies.getElementText ?? defaultGetElementText;
  }

  registerTarget(target: ProofreadingTarget): void {
    const { element, hooks } = target;

    if (this.states.has(element)) {
      this.states.set(element, {
        ...this.states.get(element)!,
        hooks,
      });
      return;
    }

    const debouncedProofread = debounce(() => {
      void this.proofread(element);
    }, this.debounceMs);

    this.states.set(element, {
      hooks,
      corrections: [],
      debouncedProofread,
      isApplyingCorrection: false,
      isRestoringFromHistory: false,
      lastText: '',
    });

    undoManager.initElement(element, (metadata) => {
      this.handleStateRestore(element, metadata);
    });
  }

  unregisterTarget(element: HTMLElement): void {
    const state = this.states.get(element);
    if (!state) {
      return;
    }

    state.debouncedProofread.cancel();
    this.states.delete(element);
    undoManager.disposeElement(element);
  }

  cancelPendingProofreads(): void {
    for (const state of this.states.values()) {
      state.debouncedProofread.cancel();
    }
  }

  scheduleProofread(element: HTMLElement): void {
    const state = this.states.get(element);
    if (!state || state.isApplyingCorrection || state.isRestoringFromHistory) {
      return;
    }
    state.debouncedProofread();
  }

  async proofread(element: HTMLElement, options: ProofreadOptions = {}): Promise<void> {
    const state = this.states.get(element);
    if (!state) {
      return;
    }

    state.debouncedProofread.cancel();

    if (state.isApplyingCorrection || state.isRestoringFromHistory) {
      return;
    }

    const text = this.getElementText(element);

    // Skip proofreading if text hasn't changed and not forced
    if (!options.force && text === state.lastText) {
      return;
    }

    const trimmed = text.trim();

    if (trimmed.length === 0) {
      this.applyCorrections(element, []);
      state.lastText = text;
      return;
    }

    const metadata = undoManager.getMetadataForText(element, text);
    if (!options.force && metadata !== undefined) {
      const corrections = Array.isArray(metadata) ? metadata : [];
      this.applyCorrections(element, corrections);
      state.lastText = text;
      return;
    }

    try {
      const result = await this.runProofread(element, text);
      const currentText = this.getElementText(element);
      if (currentText !== text) {
        return;
      }

      if (!result) {
        this.applyCorrections(element, []);
        state.lastText = text;
        return;
      }

      const filtered = this.filterCorrections(element, result.corrections ?? [], text);
      this.applyCorrections(element, filtered);
      state.lastText = text;
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        this.applyCorrections(element, []);
        state.lastText = text;
        throw error;
      }
    }
  }

  applyCorrection(element: HTMLElement, correction: ProofreadCorrection): void {
    const state = this.states.get(element);
    if (!state) {
      return;
    }

    state.debouncedProofread.cancel();
    state.isApplyingCorrection = true;

    replaceTextWithUndo(element, correction.startIndex, correction.endIndex, correction.correction);

    const updatedCorrections = state.corrections
      .filter((existing) => !isSameCorrection(existing, correction))
      .map((existing) => adjustCorrectionAfterApply(existing, correction));

    const nextText = this.getElementText(element);
    state.lastText = nextText;

    this.applyCorrections(element, updatedCorrections);
    setTimeout(() => {
      state.isApplyingCorrection = false;
    }, 0);
  }

  getCorrections(element: HTMLElement): ProofreadCorrection[] {
    return this.states.get(element)?.corrections ?? [];
  }

  resetElement(element: HTMLElement): void {
    const state = this.states.get(element);
    if (!state) {
      return;
    }

    state.debouncedProofread.cancel();
    state.corrections = [];
    state.hooks.clearHighlights();
    state.hooks.onCorrectionsChange?.([]);
    undoManager.resetHistory(element, []);
    state.lastText = this.getElementText(element);
  }

  dispose(): void {
    for (const element of this.states.keys()) {
      this.unregisterTarget(element);
    }
  }

  private handleStateRestore(element: HTMLElement, metadata?: unknown): void {
    const state = this.states.get(element);
    if (!state) {
      return;
    }

    state.debouncedProofread.cancel();
    state.isRestoringFromHistory = true;

    const corrections = Array.isArray(metadata) ? (metadata as ProofreadCorrection[]) : [];
    this.applyCorrections(element, corrections);
    state.lastText = this.getElementText(element);

    setTimeout(() => {
      state.isRestoringFromHistory = false;
    }, 0);
  }

  private applyCorrections(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    const state = this.states.get(element);
    if (!state) {
      return;
    }

    state.corrections = corrections;

    if (corrections.length > 0) {
      state.hooks.highlight(corrections);
    } else {
      state.hooks.clearHighlights();
    }

    state.hooks.onCorrectionsChange?.(corrections);
    undoManager.saveState(element, corrections);
  }
}

const adjustCorrectionAfterApply = (
  existing: ProofreadCorrection,
  applied: ProofreadCorrection
): ProofreadCorrection => {
  if (existing.startIndex <= applied.startIndex) {
    return existing;
  }

  const lengthDiff = applied.correction.length - (applied.endIndex - applied.startIndex);
  return {
    ...existing,
    startIndex: existing.startIndex + lengthDiff,
    endIndex: existing.endIndex + lengthDiff,
  };
};

export function createProofreadingController(
  dependencies: ProofreadingControllerDependencies
): ProofreadingController {
  return new ProofreadingController(dependencies);
}
