import { createUniqueId } from '../utils.ts';
import {
  isProofreadTarget,
  shouldAutoProofread,
  isSpellcheckDisabled,
} from '../../shared/proofreading/target-selectors.ts';
import type { ProofreadLifecycleReason } from '../../shared/proofreading/control-events.ts';

export interface ElementTrackerEvents {
  onElementAdded?: (element: HTMLElement) => void;
  onElementRemoved?: (element: HTMLElement) => void;
  onElementFocused?: (element: HTMLElement) => void;
  onElementBlurred?: (element: HTMLElement) => void;
  onElementInput?: (element: HTMLElement) => void;
}

export class ElementTracker {
  private readonly registeredElements = new Set<HTMLElement>();
  private readonly elementIds = new WeakMap<HTMLElement, string>();
  private readonly elementLookup = new Map<string, HTMLElement>();
  private observer: MutationObserver | null = null;
  private activeElement: HTMLElement | null = null;

  constructor(private readonly events: ElementTrackerEvents) {}

  initialize(): void {
    this.setupEventListeners();
    this.setupMutationObserver();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.registeredElements.clear();
    this.elementLookup.clear();
    this.activeElement = null;
  }

  registerElement(element: HTMLElement): void {
    if (this.registeredElements.has(element)) {
      return;
    }

    this.registeredElements.add(element);
    this.getElementId(element);
  }

  unregisterElement(element: HTMLElement): void {
    if (!this.registeredElements.has(element)) {
      return;
    }

    this.registeredElements.delete(element);

    const elementId = this.elementIds.get(element);
    if (elementId) {
      this.elementLookup.delete(elementId);
    }

    if (this.activeElement === element) {
      this.activeElement = null;
    }
  }

  getElementId(element: HTMLElement): string {
    let identifier = this.elementIds.get(element);
    if (!identifier) {
      identifier = createUniqueId('element');
      this.elementIds.set(element, identifier);
      this.elementLookup.set(identifier, element);
    }
    return identifier;
  }

  getElementById(id: string): HTMLElement | undefined {
    return this.elementLookup.get(id);
  }

  getActiveElement(): HTMLElement | null {
    return this.activeElement;
  }

  isRegistered(element: HTMLElement): boolean {
    return this.registeredElements.has(element);
  }

  isProofreadTarget(element: HTMLElement): boolean {
    return isProofreadTarget(element);
  }

  shouldAutoProofread(element: HTMLElement): boolean {
    return shouldAutoProofread(element);
  }

  resolveAutoProofreadIgnoreReason(element: HTMLElement): ProofreadLifecycleReason {
    if (isSpellcheckDisabled(element)) {
      return 'spellcheck-disabled';
    }
    const ancestorWithSpellcheckDisabled = element.closest('[spellcheck="false"]');
    if (ancestorWithSpellcheckDisabled) {
      return 'spellcheck-disabled';
    }
    return 'unsupported-target';
  }

  private setupEventListeners(): void {
    const handleInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      this.events.onElementInput?.(target);
    };

    const handleFocus = (event: Event) => {
      const target = event.target as HTMLElement;
      this.activeElement = target;
      this.events.onElementFocused?.(target);
    };

    const handleBlur = (event: Event) => {
      const target = event.target as HTMLElement;
      if (this.activeElement === target) {
        this.activeElement = null;
      }
      this.events.onElementBlurred?.(target);
    };

    document.addEventListener('input', handleInput, true);
    document.addEventListener('focus', handleFocus, true);
    document.addEventListener('blur', handleBlur, true);
  }

  private setupMutationObserver(): void {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        mutation.removedNodes.forEach((node) => this.handleRemovedNode(node));
        mutation.addedNodes.forEach((node) => this.handleAddedNode(node));
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private handleAddedNode(node: Node): void {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as HTMLElement;
    if (!this.isProofreadTarget(element)) {
      return;
    }

    if (this.hasRegisteredContentEditableAncestor(element)) {
      return;
    }

    this.events.onElementAdded?.(element);
  }

  private handleRemovedNode(node: Node): void {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as HTMLElement;

    if (this.isProofreadTarget(element)) {
      this.events.onElementRemoved?.(element);
    }

    if (node.childNodes.length > 0) {
      node.childNodes.forEach((child) => this.handleRemovedNode(child));
    }
  }

  private hasRegisteredContentEditableAncestor(element: HTMLElement): boolean {
    let parent = element.parentElement;
    while (parent) {
      if (this.registeredElements.has(parent) || parent.isContentEditable) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }
}
