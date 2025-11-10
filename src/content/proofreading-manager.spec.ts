import { describe, it, expect, beforeEach, vi } from 'vitest';

const globalAny = globalThis as unknown as Record<string, unknown>;
globalAny.HTMLInputElement = globalAny.HTMLInputElement || class {};
globalAny.HTMLTextAreaElement = globalAny.HTMLTextAreaElement || class {};

vi.mock('../shared/proofreading/control-events.ts', () => ({
  emitProofreadControlEvent: vi.fn(),
}));

const mockControllerInstance = {
  registerTarget: vi.fn(),
  scheduleProofread: vi.fn(),
  proofread: vi.fn(),
  dispose: vi.fn(),
  cancelPendingProofreads: vi.fn(),
  applyCorrection: vi.fn(),
  getCorrections: vi.fn(() => []),
  isRestoringFromHistory: vi.fn(() => false),
};

vi.mock('../shared/proofreading/controller.ts', () => ({
  createProofreadingController: vi.fn(() => mockControllerInstance),
}));

vi.mock('./components/content-highlighter.ts', () => ({
  ContentHighlighter: class {
    clearSelection() {}
    highlight() {}
    clearHighlights() {}
    destroy() {}
    setApplyCorrectionCallback() {}
    setOnCorrectionApplied() {}
    setCorrectionColors() {}
    setUnderlineStyle() {}
    setAutofixOnDoubleClick() {}
  },
}));

vi.mock('./components/correction-popover.ts', () => ({
  CorrectionPopover: class {},
}));

vi.mock('../services/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/language-detector.ts', () => ({
  createLanguageDetector: vi.fn(),
  createLanguageDetectorAdapter: vi.fn(),
  createLanguageDetectionService: vi.fn(() => ({
    detectLanguage: vi.fn(async () => 'en'),
  })),
}));

import { emitProofreadControlEvent } from '../shared/proofreading/control-events.ts';
import { ProofreadingManager } from './proofreading-manager.ts';

function createElement(tagName: string, text = ''): HTMLElement {
  return {
    tagName,
    textContent: text,
  } as unknown as HTMLElement;
}

describe('ProofreadingManager lifecycle reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enriches queued events with queue depth and element metadata', () => {
    const manager = new ProofreadingManager();
    const queue = (manager as unknown as { proofreadQueue: { size: () => number } }).proofreadQueue;
    vi.spyOn(queue, 'size').mockReturnValue(4);

    const element = createElement('input');

    (manager as unknown as { handleProofreadLifecycle: Function }).handleProofreadLifecycle({
      status: 'queued',
      element,
      executionId: 'exec-123',
      textLength: 12,
    });

    expect(emitProofreadControlEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        executionId: 'exec-123',
        queueLength: 4,
        elementKind: 'input',
        textLength: 12,
      })
    );
  });

  it('reports ignored events with computed text length', () => {
    const manager = new ProofreadingManager();
    const element = createElement('div', 'draft text');

    (manager as unknown as { reportIgnoredElement: Function }).reportIgnoredElement(
      element,
      'unsupported-target'
    );

    expect(emitProofreadControlEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ignored',
        reason: 'unsupported-target',
        textLength: 'draft text'.length,
      })
    );
  });

  it('forwards extended lifecycle metadata to the control event emitter', () => {
    const manager = new ProofreadingManager();
    const element = createElement('textarea', 'Hello world');

    (manager as unknown as { handleProofreadLifecycle: Function }).handleProofreadLifecycle({
      status: 'complete',
      element,
      executionId: 'exec-999',
      textLength: 11,
      correctionCount: 1,
      detectedIssueCount: 3,
      reason: undefined,
      error: undefined,
      debounceMs: 400,
      forced: true,
      queueLength: 2,
      language: 'en',
      fallbackLanguage: 'en',
    });

    expect(emitProofreadControlEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'complete',
        executionId: 'exec-999',
        textLength: 11,
        correctionCount: 1,
        detectedIssueCount: 3,
        queueLength: 2,
        debounceMs: 400,
        forced: true,
        language: 'en',
        fallbackLanguage: 'en',
      })
    );
  });
});
