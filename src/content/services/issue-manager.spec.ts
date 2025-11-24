import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IssueManager } from './issue-manager.ts';
import type { ProofreadCorrection } from '../../shared/types.ts';

vi.mock('../../shared/messages/issues.ts', () => ({
  resolveElementKind: vi.fn(() => 'input'),
  toSidepanelIssue: vi.fn((correction) => ({
    id: correction.id || 'issue-1',
    text: 'error',
    correction: correction.correction,
    type: correction.type,
  })),
  normalizeIssueLabel: vi.fn((type) => type || 'spelling'),
}));

const mockChrome = {
  runtime: {
    sendMessage: vi.fn(() => Promise.resolve().catch(() => {})),
  },
};

(globalThis as any).chrome = mockChrome;

function createMockElement(id: string): HTMLElement {
  return { id } as HTMLElement;
}

function createMockCorrection(correctionText: string): ProofreadCorrection {
  return {
    startIndex: 0,
    endIndex: 5,
    correction: correctionText,
  };
}

describe('IssueManager', () => {
  let manager: IssueManager;
  let getElementId: (element: HTMLElement) => string;
  let getElementText: (element: HTMLElement) => string;
  let getActiveElement: () => HTMLElement | null;

  beforeEach(() => {
    vi.clearAllMocks();
    getElementId = vi.fn((element: HTMLElement) => element.id) as any;
    getElementText = vi.fn(() => 'sample text with error') as any;
    getActiveElement = vi.fn(() => null) as any;

    manager = new IssueManager({
      pageId: 'page-123',
      getElementId,
      getElementText,
      getActiveElement,
    });
  });

  describe('setCorrections', () => {
    it('should store corrections for an element', () => {
      const element = createMockElement('elem-1');
      const corrections = [createMockCorrection('corr-1'), createMockCorrection('corr-2')];

      manager.setCorrections(element, corrections);

      expect(manager.getCorrections(element)).toEqual(corrections);
    });

    it('should update existing corrections', () => {
      const element = createMockElement('elem-1');
      const corrections1 = [createMockCorrection('corr-1')];
      const corrections2 = [createMockCorrection('corr-2'), createMockCorrection('corr-3')];

      manager.setCorrections(element, corrections1);
      manager.setCorrections(element, corrections2);

      expect(manager.getCorrections(element)).toEqual(corrections2);
    });
  });

  describe('getCorrections', () => {
    it('should return corrections for an element', () => {
      const element = createMockElement('elem-1');
      const corrections = [createMockCorrection('corr-1')];

      manager.setCorrections(element, corrections);

      expect(manager.getCorrections(element)).toEqual(corrections);
    });

    it('should return empty array for element with no corrections', () => {
      const element = createMockElement('elem-1');
      expect(manager.getCorrections(element)).toEqual([]);
    });
  });

  describe('getCorrection', () => {
    it('should retrieve correction by ID', () => {
      const element = createMockElement('elem-1');
      const correction = createMockCorrection('corr-1');

      manager.setCorrections(element, [correction]);

      expect(manager.getCorrection(element, 'corr-1')).toBe(correction);
    });

    it('should return undefined for unknown correction ID', () => {
      const element = createMockElement('elem-1');
      expect(manager.getCorrection(element, 'unknown')).toBeUndefined();
    });
  });

  describe('clearState', () => {
    it('should clear all corrections for an element', () => {
      const element = createMockElement('elem-1');
      manager.setCorrections(element, [createMockCorrection('corr-1')]);

      manager.clearState(element);

      expect(manager.getCorrections(element)).toEqual([]);
    });
  });

  describe('hasCorrections', () => {
    it('should return true when corrections exist', () => {
      const element = createMockElement('elem-1');
      manager.setCorrections(element, [createMockCorrection('corr-1')]);

      expect(manager.hasCorrections()).toBe(true);
    });

    it('should return false when no corrections exist', () => {
      expect(manager.hasCorrections()).toBe(false);
    });
  });

  describe('emitIssuesUpdate', () => {
    it('should send issues update message', () => {
      const element = createMockElement('elem-1');
      manager.setCorrections(element, [createMockCorrection('corr-1')]);

      manager.emitIssuesUpdate();

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'proofly:issues-update',
          payload: expect.objectContaining({
            pageId: 'page-123',
          }),
        })
      );
    });
  });

  describe('scheduleIssuesUpdate', () => {
    it('should debounce issues update', () => {
      vi.useFakeTimers();

      const element = createMockElement('elem-1');
      manager.setCorrections(element, [createMockCorrection('corr-1')]);

      manager.scheduleIssuesUpdate();
      manager.scheduleIssuesUpdate();
      manager.scheduleIssuesUpdate();

      expect(mockChrome.runtime.sendMessage).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should emit immediately when immediate flag is true', () => {
      const element = createMockElement('elem-1');
      manager.setCorrections(element, [createMockCorrection('corr-1')]);

      manager.scheduleIssuesUpdate(true);

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalled();
    });
  });
});
