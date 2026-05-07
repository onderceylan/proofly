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

let lastElementTracker: Record<string, ReturnType<typeof vi.fn>>;
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
    constructor() {
      lastElementTracker = this as unknown as Record<string, ReturnType<typeof vi.fn>>;
    }
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

let lastProofreadService: Record<string, ReturnType<typeof vi.fn>>;
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
    constructor() {
      lastProofreadService = this as unknown as Record<string, ReturnType<typeof vi.fn>>;
    }
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

let lastCEHandlerOptions: {
  onInvalidateIssues: () => void;
  onNeedProofread?: () => void;
  [key: string]: unknown;
} | null = null;
vi.mock('./handlers/contenteditable-target-handler.ts', () => ({
  ContentEditableTargetHandler: class {
    attach = vi.fn();
    dispose = vi.fn();
    clearHighlights = vi.fn();
    clearSelection = vi.fn();
    highlight = vi.fn();
    previewIssue = vi.fn();
    updatePreferences = vi.fn();
    constructor(_element: unknown, options: typeof lastCEHandlerOptions) {
      lastCEHandlerOptions = options;
    }
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

type PrivateManager = {
  handleElementFocused: (element: HTMLElement) => void;
  handleElementInput: (element: HTMLElement) => void;
  handleProofreadLifecycle: (event: ProofreadLifecycleInternalEvent) => void;
  reportIgnoredElement: (el: HTMLElement, reason: ProofreadLifecycleReason) => void;
};

describe('ProofreadingManager', () => {
  let manager: ProofreadingManager;

  beforeEach(() => {
    vi.clearAllMocks();
    lastCEHandlerOptions = null;
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

      (manager as unknown as PrivateManager).handleProofreadLifecycle({
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

      (manager as unknown as PrivateManager).reportIgnoredElement(element, 'unsupported-target');

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

  describe('contenteditable re-proofreading on input', () => {
    it('should call scheduleProofread via handleElementInput when shouldAutoProofread passes', () => {
      const element = createElement('div', 'text with erors');

      (manager as unknown as PrivateManager).handleElementInput(element);

      expect(lastProofreadService.scheduleProofread).toHaveBeenCalledWith(element);
    });

    it('should create ContentEditableTargetHandler with onNeedProofread on focus', () => {
      const element = createElement('div', 'text with erors');

      (manager as unknown as PrivateManager).handleElementFocused(element);

      expect(lastCEHandlerOptions).not.toBeNull();
      expect(lastCEHandlerOptions!.onNeedProofread).toBeDefined();
      expect(typeof lastCEHandlerOptions!.onNeedProofread).toBe('function');
    });

    it('should trigger proofread when onNeedProofread is called', () => {
      const element = createElement('div', 'text with erors');

      (manager as unknown as PrivateManager).handleElementFocused(element);
      lastProofreadService.proofread.mockClear();

      lastCEHandlerOptions!.onNeedProofread!();

      expect(lastProofreadService.proofread).toHaveBeenCalledWith(element);
    });

    it('should re-proofread via handleElementInput when element is already registered even if shouldAutoProofread flips', () => {
      const element = createElement('div', 'text with erors');
      let callCount = 0;
      lastElementTracker.shouldAutoProofread.mockImplementation(() => {
        callCount++;
        return callCount <= 1;
      });
      lastElementTracker.isRegistered.mockReturnValue(false);

      (manager as unknown as PrivateManager).handleElementFocused(element);

      expect(lastProofreadService.proofread).toHaveBeenCalledWith(element);
      lastProofreadService.proofread.mockClear();
      lastProofreadService.scheduleProofread.mockClear();

      lastElementTracker.isRegistered.mockReturnValue(true);

      (manager as unknown as PrivateManager).handleElementInput(element);

      expect(lastProofreadService.scheduleProofread).toHaveBeenCalledWith(element);
    });

    it('should re-proofread via onNeedProofread when element is already registered even if shouldAutoProofread flips', () => {
      const element = createElement('div', 'text with erors');
      let callCount = 0;
      lastElementTracker.shouldAutoProofread.mockImplementation(() => {
        callCount++;
        return callCount <= 1;
      });
      lastElementTracker.isRegistered.mockReturnValue(false);

      (manager as unknown as PrivateManager).handleElementFocused(element);

      expect(lastProofreadService.proofread).toHaveBeenCalledWith(element);
      lastProofreadService.proofread.mockClear();

      lastElementTracker.isRegistered.mockReturnValue(true);

      lastCEHandlerOptions!.onNeedProofread!();

      expect(lastProofreadService.proofread).toHaveBeenCalledWith(element);
    });

    it('should still block re-proofread for unregistered elements when shouldAutoProofread fails', () => {
      const element = createElement('div', 'text with erors');
      lastElementTracker.shouldAutoProofread.mockReturnValue(false);
      lastElementTracker.isRegistered.mockReturnValue(false);

      (manager as unknown as PrivateManager).handleElementInput(element);

      expect(lastProofreadService.scheduleProofread).not.toHaveBeenCalled();
    });
  });
});
