import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContentProofreadingService } from './content-proofreading-service.ts';
import type { ProofreadCorrection } from '../../shared/types.ts';

const mockController = {
  registerTarget: vi.fn(),
  unregisterTarget: vi.fn(),
  proofread: vi.fn(),
  scheduleProofread: vi.fn(),
  applyCorrection: vi.fn(),
  getCorrections: vi.fn(() => []),
  isRestoringFromHistory: vi.fn(() => false),
  cancelPendingProofreads: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('../../shared/proofreading/controller.ts', () => ({
  createProofreadingController: vi.fn(() => mockController),
}));

const mockLanguageDetectionService = {
  detectLanguage: vi.fn(async () => 'en'),
  destroy: vi.fn(),
};

vi.mock('../../services/language-detector.ts', () => ({
  createLanguageDetector: vi.fn(async () => ({
    detect: vi.fn(async () => ({ detectedLanguage: 'en', confidence: 0.9 })),
  })),
  createLanguageDetectorAdapter: vi.fn((detector) => detector),
  createLanguageDetectionService: vi.fn((_adapter) => mockLanguageDetectionService),
}));

const mockChrome = {
  runtime: {
    sendMessage: vi.fn(async () => ({
      success: true,
      corrections: [],
      correctedInput: 'corrected text',
    })),
  },
};

(globalThis as any).chrome = mockChrome;

function createMockElement(): HTMLElement {
  return {
    textContent: 'sample text',
  } as HTMLElement;
}

describe('ContentProofreadingService', () => {
  let service: ContentProofreadingService;
  let callbacks: {
    getElementText: (element: HTMLElement) => string;
    filterCorrections: (corrections: ProofreadCorrection[]) => ProofreadCorrection[];
    onLifecycleEvent?: () => void;
    onBusyChange?: () => void;
    onMessage?: () => void;
    onClearMessage?: () => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    callbacks = {
      getElementText: vi.fn((element: HTMLElement) => element.textContent || '') as any,
      filterCorrections: vi.fn((corrections: ProofreadCorrection[]) => corrections) as any,
      onLifecycleEvent: vi.fn() as any,
      onBusyChange: vi.fn() as any,
      onMessage: vi.fn() as any,
      onClearMessage: vi.fn() as any,
    };

    service = new ContentProofreadingService({
      debounceMs: 1000,
      ...callbacks,
    });
  });

  describe('initialize', () => {
    it('should initialize language detection service', async () => {
      await service.initialize();

      expect(service).toBeDefined();
    });

    it('should handle language detection initialization failure', async () => {
      const { createLanguageDetector } = await import('../../services/language-detector.ts');
      vi.mocked(createLanguageDetector).mockRejectedValueOnce(new Error('Not available'));

      await service.initialize();

      expect(service).toBeDefined();
    });
  });

  describe('registerTarget', () => {
    it('should register target with controller', () => {
      const element = createMockElement();
      const hooks = {
        highlight: vi.fn(),
        clearHighlights: vi.fn(),
        onCorrectionsChange: vi.fn(),
      };

      service.registerTarget({ element, hooks });

      expect(mockController.registerTarget).toHaveBeenCalledWith({ element, hooks });
    });
  });

  describe('unregisterTarget', () => {
    it('should unregister target from controller', () => {
      const element = createMockElement();

      service.unregisterTarget(element);

      expect(mockController.unregisterTarget).toHaveBeenCalledWith(element);
    });
  });

  describe('proofread', () => {
    it('should trigger proofread with controller', async () => {
      await service.initialize();
      const element = createMockElement();

      await service.proofread(element);

      expect(mockController.proofread).toHaveBeenCalledWith(element, undefined);
    });

    it('should pass force option to controller', async () => {
      await service.initialize();
      const element = createMockElement();

      await service.proofread(element, { force: true });

      expect(mockController.proofread).toHaveBeenCalledWith(
        element,
        expect.objectContaining({
          force: true,
        })
      );
    });

    it('should pass selection option to controller', async () => {
      await service.initialize();
      const element = createMockElement();
      const selection = { start: 0, end: 5 };

      await service.proofread(element, { selection });

      expect(mockController.proofread).toHaveBeenCalledWith(
        element,
        expect.objectContaining({
          selection,
        })
      );
    });
  });

  describe('scheduleProofread', () => {
    it('should schedule proofread with controller', () => {
      const element = createMockElement();

      service.scheduleProofread(element);

      expect(mockController.scheduleProofread).toHaveBeenCalledWith(element);
    });
  });

  describe('applyCorrection', () => {
    it('should apply correction with controller', () => {
      const element = createMockElement();
      const correction: ProofreadCorrection = {
        startIndex: 0,
        endIndex: 5,
        correction: 'fixed',
      };

      service.applyCorrection(element, correction);

      expect(mockController.applyCorrection).toHaveBeenCalledWith(element, correction);
    });
  });

  describe('getCorrections', () => {
    it('should get corrections from controller', () => {
      const element = createMockElement();

      service.getCorrections(element);

      expect(mockController.getCorrections).toHaveBeenCalledWith(element);
    });
  });

  describe('isRestoringFromHistory', () => {
    it('should check if restoring from history', () => {
      const element = createMockElement();

      service.isRestoringFromHistory(element);

      expect(mockController.isRestoringFromHistory).toHaveBeenCalledWith(element);
    });
  });

  describe('cancelPendingProofreads', () => {
    it('should cancel pending proofreads', () => {
      service.cancelPendingProofreads();

      expect(mockController.cancelPendingProofreads).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should cleanup resources', async () => {
      await service.initialize();
      service.destroy();

      expect(mockController.dispose).toHaveBeenCalled();
      expect(mockLanguageDetectionService.destroy).toHaveBeenCalled();
    });
  });
});
