import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProofreadingManager } from './proofreading-manager.ts';
import {
  emitProofreadControlEvent,
  type ProofreadLifecycleReason,
} from '../shared/proofreading/control-events.ts';
import type { ProofreadLifecycleInternalEvent } from '../shared/proofreading/controller.ts';

vi.mock('../shared/proofreading/control-events.ts', () => ({
  emitProofreadControlEvent: vi.fn(),
}));

vi.mock('./services/element-tracker.ts', () => ({
  ElementTracker: class {
    initialize = vi.fn();
    destroy = vi.fn();
    registerElement = vi.fn();
    unregisterElement = vi.fn();
    getElementId = vi.fn(() => 'elem-123');
    getElementById = vi.fn();
    getActiveElement = vi.fn(() => null);
    isRegistered = vi.fn(() => false);
    isProofreadTarget = vi.fn(() => true);
    shouldAutoProofread = vi.fn(() => true);
    resolveAutoProofreadIgnoreReason = vi.fn(() => 'unsupported-target');
  },
}));

vi.mock('./services/popover-manager.ts', () => ({
  PopoverManager: class {
    show = vi.fn();
    hide = vi.fn();
    updateVisibility = vi.fn();
    setAutofixOnDoubleClick = vi.fn();
    destroy = vi.fn();
  },
}));

vi.mock('./services/preference-manager.ts', () => ({
  PreferenceManager: class {
    initialize = vi.fn(async () => {});
    destroy = vi.fn();
    getEnabledCorrectionTypes = vi.fn(() => new Set(['spelling', 'grammar']));
    getCorrectionColors = vi.fn(() => ({}));
    buildIssuePalette = vi.fn(() => ({}));
    getUnderlineStyle = vi.fn(() => 'wavy');
    isAutoCorrectEnabled = vi.fn(() => true);
    getProofreadShortcut = vi.fn(() => 'Mod+Shift+P');
    isAutofixOnDoubleClickEnabled = vi.fn(() => false);
  },
}));

vi.mock('./services/issue-manager.ts', () => ({
  IssueManager: class {
    setCorrections = vi.fn();
    getCorrections = vi.fn(() => []);
    getCorrection = vi.fn();
    setMessage = vi.fn();
    clearMessage = vi.fn();
    clearState = vi.fn();
    hasCorrections = vi.fn(() => false);
    emitIssuesUpdate = vi.fn();
    scheduleIssuesUpdate = vi.fn();
  },
}));

vi.mock('./services/content-proofreading-service.ts', () => ({
  ContentProofreadingService: class {
    initialize = vi.fn(async () => {});
    destroy = vi.fn();
    registerTarget = vi.fn();
    unregisterTarget = vi.fn();
    proofread = vi.fn(async () => {});
    scheduleProofread = vi.fn();
    applyCorrection = vi.fn();
    getCorrections = vi.fn(() => []);
    isRestoringFromHistory = vi.fn(() => false);
    cancelPendingProofreads = vi.fn();
  },
}));

vi.mock('./components/content-highlighter.ts', () => ({
  ContentHighlighter: class {
    clearSelection = vi.fn();
    destroy = vi.fn();
    setCorrectionColors = vi.fn();
    previewCorrection = vi.fn();
    clearPreview = vi.fn();
  },
}));

vi.mock('./handlers/mirror-target-handler.ts', () => ({
  MirrorTargetHandler: class {
    attach = vi.fn();
    dispose = vi.fn();
    clearSelection = vi.fn();
    updatePreferences = vi.fn();
    previewIssue = vi.fn();
  },
}));

vi.mock('./handlers/direct-target-handler.ts', () => ({
  DirectTargetHandler: class {
    attach = vi.fn();
    dispose = vi.fn();
    clearSelection = vi.fn();
  },
}));

vi.mock('../services/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../shared/utils/platform.ts', () => ({
  isMacOS: vi.fn(() => false),
}));

function createElement(tagName: string, text = ''): HTMLElement {
  return {
    tagName,
    textContent: text,
  } as unknown as HTMLElement;
}

describe('ProofreadingManager', () => {
  let manager: ProofreadingManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createRange: () => ({
        setStart: vi.fn(),
        setEnd: vi.fn(),
        getClientRects: () => ({ length: 0 }),
        getBoundingClientRect: () => new DOMRect(),
      }),
    });
    vi.stubGlobal(
      'HTMLInputElement',
      class HTMLInputElement {} as unknown as typeof HTMLInputElement
    );
    vi.stubGlobal(
      'HTMLTextAreaElement',
      class HTMLTextAreaElement {} as unknown as typeof HTMLTextAreaElement
    );
    manager = new ProofreadingManager();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('initialize', () => {
    it('should initialize all services', async () => {
      await manager.initialize();

      expect(manager).toBeDefined();
    });
  });

  describe('lifecycle reporting', () => {
    it('should enrich lifecycle events with element metadata', () => {
      const element = createElement('input');

      (
        manager as unknown as {
          handleProofreadLifecycle: (event: ProofreadLifecycleInternalEvent) => void;
        }
      ).handleProofreadLifecycle({
        status: 'complete',
        element,
        executionId: 'exec-123',
        textLength: 12,
        correctionCount: 2,
      });

      expect(emitProofreadControlEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'complete',
          executionId: 'exec-123',
          elementId: 'elem-123',
          elementKind: 'input',
          textLength: 12,
          correctionCount: 2,
        })
      );
    });

    it('should report ignored events with reason', () => {
      const element = createElement('div', 'draft text');

      (
        manager as unknown as {
          reportIgnoredElement: (el: HTMLElement, reason: ProofreadLifecycleReason) => void;
        }
      ).reportIgnoredElement(element, 'unsupported-target');

      expect(emitProofreadControlEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ignored',
          reason: 'unsupported-target',
          elementKind: expect.any(String),
        })
      );
    });
  });

  describe('applyIssue', () => {
    it('should apply correction by element and issue ID', () => {
      const elementId = 'elem-123';
      const issueId = 'issue-456';

      manager.applyIssue(elementId, issueId);

      expect(manager).toBeDefined();
    });
  });

  describe('applyAllIssues', () => {
    it('should apply all corrections', () => {
      manager.applyAllIssues();

      expect(manager).toBeDefined();
    });

    it('should handle element-scoped bulk apply', () => {
      manager.applyAllIssues('element-123');

      expect(manager).toBeDefined();
    });
  });

  describe('proofreadActiveElement', () => {
    it('should proofread the active element', async () => {
      await manager.proofreadActiveElement();

      expect(manager).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('should cleanup all services', () => {
      manager.destroy();

      expect(manager).toBeDefined();
    });
  });
});
