import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { loadActualTargetSelectors, isProofreadTargetMock } = vi.hoisted(() => {
  let actualTargetSelectorsPromise: Promise<
    typeof import('../shared/proofreading/target-selectors.ts')
  > | null = null;

  return {
    isProofreadTargetMock: vi.fn(),
    loadActualTargetSelectors: () => {
      if (!actualTargetSelectorsPromise) {
        actualTargetSelectorsPromise = vi.importActual(
          '../shared/proofreading/target-selectors.ts'
        );
      }
      return actualTargetSelectorsPromise;
    },
  };
});

vi.mock('../shared/proofreading/target-selectors.ts', async () => {
  const actual =
    (await loadActualTargetSelectors()) as typeof import('../shared/proofreading/target-selectors.ts');

  if (!isProofreadTargetMock.getMockImplementation()) {
    isProofreadTargetMock.mockImplementation(actual.isProofreadTarget);
  }

  return {
    ...actual,
    isProofreadTarget: isProofreadTargetMock,
  };
});

const globalAny = globalThis as unknown as Record<string, any>;

class FakeTextInput {
  value = '';
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class FakeTextArea extends FakeTextInput {}

globalAny.HTMLInputElement = globalAny.HTMLInputElement || FakeTextInput;
globalAny.HTMLTextAreaElement = globalAny.HTMLTextAreaElement || FakeTextArea;
globalAny.window = globalAny.window || {
  getSelection: () => null,
};

globalAny.Node =
  globalAny.Node ||
  class {
    static ELEMENT_NODE = 1;
    static DOCUMENT_FRAGMENT_NODE = 11;
  };

const ELEMENT_NODE = globalAny.Node.ELEMENT_NODE;
const DOCUMENT_FRAGMENT_NODE = globalAny.Node.DOCUMENT_FRAGMENT_NODE;

function createChildNodeList(): NodeListOf<ChildNode> & Node[] {
  return [] as unknown as NodeListOf<ChildNode> & Node[];
}

function createTestElementNode(tagName: string): HTMLElement & { appendChild(child: Node): void } {
  const childNodes = createChildNodeList();
  const element = {
    nodeType: ELEMENT_NODE,
    tagName: tagName.toUpperCase(),
    childNodes,
    appendChild(child: Node) {
      childNodes.push(child);
      if (typeof child === 'object' && child) {
        (child as { parentElement?: HTMLElement }).parentElement = element as HTMLElement;
      }
    },
    parentElement: null,
    isContentEditable: false,
  } as unknown as HTMLElement & { appendChild(child: Node): void };

  return element;
}

class DocumentFragmentStub {
  nodeType = DOCUMENT_FRAGMENT_NODE;
  childNodes = createChildNodeList();
  appendChild(child: Node): void {
    this.childNodes.push(child);
  }
}

if (!globalAny.DocumentFragment) {
  globalAny.DocumentFragment = DocumentFragmentStub;
}

if (!globalAny.document) {
  globalAny.document = {
    createElement: (tag: string) => createTestElementNode(tag),
    createDocumentFragment: () => new globalAny.DocumentFragment(),
  };
}

afterEach(async () => {
  const actual =
    (await loadActualTargetSelectors()) as typeof import('../shared/proofreading/target-selectors.ts');
  isProofreadTargetMock.mockImplementation(actual.isProofreadTarget);
});

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

vi.mock('../shared/proofreading/controller.ts', async () => {
  const actual = (await vi.importActual('../shared/proofreading/controller.ts')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    createProofreadingController: vi.fn(() => mockControllerInstance),
  };
});

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

import {
  emitProofreadControlEvent,
  type ProofreadLifecycleReason,
} from '../shared/proofreading/control-events.ts';
import {
  rebaseProofreadResult,
  type ProofreadLifecycleInternalEvent,
} from '../shared/proofreading/controller.ts';
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

    (
      manager as unknown as {
        handleProofreadLifecycle: (event: ProofreadLifecycleInternalEvent) => void;
      }
    ).handleProofreadLifecycle({
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

    (
      manager as unknown as {
        reportIgnoredElement: (el: HTMLElement, reason: ProofreadLifecycleReason) => void;
      }
    ).reportIgnoredElement(element, 'unsupported-target');

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

    (
      manager as unknown as {
        handleProofreadLifecycle: (event: ProofreadLifecycleInternalEvent) => void;
      }
    ).handleProofreadLifecycle({
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
      })
    );
  });
});

describe('ProofreadingManager selection helpers', () => {
  let manager: ProofreadingManager;

  beforeEach(() => {
    manager = new ProofreadingManager();
  });

  it('returns selection range for text inputs', () => {
    const TextAreaCtor = globalAny.HTMLTextAreaElement as { new (): HTMLTextAreaElement };
    const textarea = new TextAreaCtor();
    textarea.value = 'Example textarea text';
    textarea.setSelectionRange(2, 10);

    const range = (
      manager as unknown as {
        getSelectionRange: (element: HTMLElement) => { start: number; end: number } | null;
      }
    ).getSelectionRange(textarea as unknown as HTMLElement);

    expect(range).toEqual({ start: 2, end: 10 });

    textarea.setSelectionRange(5, 5);
    const collapsed = (
      manager as unknown as {
        getSelectionRange: (element: HTMLElement) => { start: number; end: number } | null;
      }
    ).getSelectionRange(textarea as unknown as HTMLElement);

    expect(collapsed).toBeNull();
  });

  it('derives selection range for contenteditable elements', () => {
    const selectionNode = {} as unknown as Node;
    const element = {
      isContentEditable: true,
      textContent: 'Proofly content editable text',
      contains: (node: unknown) => node === selectionNode,
    } as unknown as HTMLElement;

    const selection = {
      rangeCount: 1,
      getRangeAt: () => ({
        startContainer: selectionNode,
        endContainer: selectionNode,
        startOffset: 1,
        endOffset: 8,
      }),
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    };

    const previousGetSelection = globalAny.window.getSelection;
    globalAny.window.getSelection = () => selection;

    (
      manager as unknown as {
        getTextOffsetWithin: (root: HTMLElement, node: Node, offset: number) => number;
      }
    ).getTextOffsetWithin = vi.fn((_root, _node, offset) => offset);

    const selectionRange = (
      manager as unknown as {
        getSelectionRange: (el: HTMLElement) => { start: number; end: number } | null;
      }
    ).getSelectionRange(element);

    expect(selectionRange).toEqual({ start: 1, end: 8 });

    globalAny.window.getSelection = previousGetSelection;
  });

  it('clamps rebased corrections when applying partial results', () => {
    const range = { start: 5, end: 11 };
    const fullText = 'Full input sentence.';
    const result = {
      correctedInput: 'better',
      corrections: [
        {
          startIndex: 0,
          endIndex: 6,
          correction: 'better',
        },
      ],
    };

    const rebased = rebaseProofreadResult(result, range, fullText);

    expect(rebased.correctedInput).toBe(
      `${fullText.slice(0, range.start)}${result.correctedInput}${fullText.slice(range.end)}`
    );
    expect(rebased.corrections[0]).toMatchObject({ startIndex: 5, endIndex: 11 });
  });

  it('forces proofread when manually triggered through shortcut', async () => {
    const manager = new ProofreadingManager();
    const element = createElement('textarea');

    (manager as unknown as { activeElement: HTMLElement | null }).activeElement =
      element as unknown as HTMLElement;
    (
      manager as unknown as { getSelectionRange: () => { start: number; end: number } | null }
    ).getSelectionRange = vi.fn().mockReturnValue({ start: 0, end: 5 });

    await manager.proofreadActiveElement();

    expect(mockControllerInstance.proofread).toHaveBeenCalledWith(
      element,
      expect.objectContaining({
        force: true,
        selection: { start: 0, end: 5 },
      })
    );
  });
});

describe('ProofreadingManager contenteditable ancestor detection', () => {
  let manager: ProofreadingManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ProofreadingManager();
  });

  it('returns false when element has no parent', () => {
    const element = {
      parentElement: null,
    } as unknown as HTMLElement;

    const result = (
      manager as unknown as {
        hasRegisteredContentEditableAncestor: (element: HTMLElement) => boolean;
      }
    ).hasRegisteredContentEditableAncestor(element);

    expect(result).toBe(false);
  });

  it('returns false when element has no contenteditable ancestor', () => {
    const parent = {
      isContentEditable: false,
      parentElement: null,
    } as unknown as HTMLElement;

    const element = {
      parentElement: parent,
    } as unknown as HTMLElement;

    const result = (
      manager as unknown as {
        hasRegisteredContentEditableAncestor: (element: HTMLElement) => boolean;
      }
    ).hasRegisteredContentEditableAncestor(element);

    expect(result).toBe(false);
  });

  it('returns true when element has contenteditable ancestor that is registered', () => {
    const grandparent = {
      isContentEditable: true,
      parentElement: null,
    } as unknown as HTMLElement;

    const parent = {
      isContentEditable: false,
      parentElement: grandparent,
    } as unknown as HTMLElement;

    const element = {
      parentElement: parent,
    } as unknown as HTMLElement;

    // Register the contenteditable ancestor
    const registeredElements = (manager as unknown as { registeredElements: Set<HTMLElement> })
      .registeredElements;
    registeredElements.add(grandparent);

    const result = (
      manager as unknown as {
        hasRegisteredContentEditableAncestor: (element: HTMLElement) => boolean;
      }
    ).hasRegisteredContentEditableAncestor(element);

    expect(result).toBe(true);
  });

  it('returns true when element has unregistered contenteditable ancestor', () => {
    const parent = {
      isContentEditable: true,
      parentElement: null,
    } as unknown as HTMLElement;

    const element = {
      parentElement: parent,
    } as unknown as HTMLElement;

    // Don't register the parent
    const result = (
      manager as unknown as {
        hasRegisteredContentEditableAncestor: (element: HTMLElement) => boolean;
      }
    ).hasRegisteredContentEditableAncestor(element);

    expect(result).toBe(true);
  });

  it('returns true for nested contenteditable with registered outer ancestor', () => {
    const outerDiv = {
      isContentEditable: true,
      parentElement: null,
    } as unknown as HTMLElement;

    const innerDiv = {
      isContentEditable: true,
      parentElement: outerDiv,
    } as unknown as HTMLElement;

    const paragraph = {
      isContentEditable: true,
      parentElement: innerDiv,
    } as unknown as HTMLElement;

    // Register only the outer div (simulating rich text editor structure)
    const registeredElements = (manager as unknown as { registeredElements: Set<HTMLElement> })
      .registeredElements;
    registeredElements.add(outerDiv);

    const result = (
      manager as unknown as {
        hasRegisteredContentEditableAncestor: (element: HTMLElement) => boolean;
      }
    ).hasRegisteredContentEditableAncestor(paragraph);

    expect(result).toBe(true);
  });

  it('skips non-contenteditable intermediate elements', () => {
    const contentEditableDiv = {
      isContentEditable: true,
      parentElement: null,
    } as unknown as HTMLElement;

    const regularDiv = {
      isContentEditable: false,
      parentElement: contentEditableDiv,
    } as unknown as HTMLElement;

    const regularSpan = {
      isContentEditable: false,
      parentElement: regularDiv,
    } as unknown as HTMLElement;

    const paragraph = {
      isContentEditable: true,
      parentElement: regularSpan,
    } as unknown as HTMLElement;

    // Register the top-level contenteditable div
    const registeredElements = (manager as unknown as { registeredElements: Set<HTMLElement> })
      .registeredElements;
    registeredElements.add(contentEditableDiv);

    const result = (
      manager as unknown as {
        hasRegisteredContentEditableAncestor: (element: HTMLElement) => boolean;
      }
    ).hasRegisteredContentEditableAncestor(paragraph);

    expect(result).toBe(true);
  });

  it('returns true when immediate parent is contenteditable', () => {
    const parent = {
      isContentEditable: true,
      parentElement: null,
    } as unknown as HTMLElement;

    const child = {
      parentElement: parent,
    } as unknown as HTMLElement;

    const result = (
      manager as unknown as {
        hasRegisteredContentEditableAncestor: (element: HTMLElement) => boolean;
      }
    ).hasRegisteredContentEditableAncestor(child);

    expect(result).toBe(true);
  });
});

describe('ProofreadingManager removed node handling', () => {
  let manager: ProofreadingManager;

  beforeEach(() => {
    manager = new ProofreadingManager();
  });

  it('cleans up root element when it is removed', () => {
    const textarea = document.createElement('textarea');
    const registeredElements = (manager as unknown as { registeredElements: Set<HTMLElement> })
      .registeredElements;
    registeredElements.add(textarea);

    isProofreadTargetMock.mockImplementation((element) => element === textarea);

    const cleanupSpy = vi
      .spyOn(
        manager as unknown as { cleanupRemovedElement: (el: HTMLElement) => void },
        'cleanupRemovedElement'
      )
      .mockImplementation(() => {});

    (manager as unknown as { handleRemovedNode: (node: Node) => void }).handleRemovedNode(textarea);

    expect(cleanupSpy).toHaveBeenCalledWith(textarea);
  });

  it('cleans up nested registered targets when ancestor node is removed', () => {
    const container = document.createElement('div');
    const subTree = document.createElement('div');
    const wrapper = document.createElement('div');
    const textarea = document.createElement('textarea');

    wrapper.appendChild(textarea);
    subTree.appendChild(wrapper);
    container.appendChild(subTree);

    const registeredElements = (manager as unknown as { registeredElements: Set<HTMLElement> })
      .registeredElements;
    registeredElements.add(textarea);

    isProofreadTargetMock.mockImplementation((element) => element === textarea);

    const cleanupSpy = vi
      .spyOn(
        manager as unknown as { cleanupRemovedElement: (el: HTMLElement) => void },
        'cleanupRemovedElement'
      )
      .mockImplementation(() => {});

    (manager as unknown as { handleRemovedNode: (node: Node) => void }).handleRemovedNode(
      container
    );

    expect(cleanupSpy).toHaveBeenCalledWith(textarea);
  });
});
