const TEXT_INPUT_SELECTORS = ['input:not([type])', 'input[type="text"]'] as const;
const TEXTAREA_SELECTOR = 'textarea';
const CONTENTEDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';

export const PROOFREAD_TARGET_SELECTORS = [
  TEXTAREA_SELECTOR,
  ...TEXT_INPUT_SELECTORS,
  CONTENTEDITABLE_SELECTOR,
] as const;

const TEXT_INPUT_SELECTOR = TEXT_INPUT_SELECTORS.join(', ');
const TARGET_SELECTOR = PROOFREAD_TARGET_SELECTORS.join(', ');

export function isProofreadTarget(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.matches(TARGET_SELECTOR)) {
    return true;
  }

  return element.isContentEditable;
}

export function isSpellcheckDisabled(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('spellcheck');
  return typeof value === 'string' && value.trim().toLowerCase() === 'false';
}

export function isAutocorrectDisabled(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('autocorrect');
  return typeof value === 'string' && value.trim().toLowerCase() === 'off';
}

export function isWritingSuggestionsDisabled(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('writingsuggestions');
  return typeof value === 'string' && value.trim().toLowerCase() === 'false';
}

export function shouldProofread(element: Element): element is HTMLElement {
  if (!isProofreadTarget(element)) {
    return false;
  }

  if (isSpellcheckDisabled(element)) {
    return false;
  }

  if (isAutocorrectDisabled(element)) {
    return false;
  }

  if (isWritingSuggestionsDisabled(element)) {
    return false;
  }

  return true;
}

export function shouldMirrorOnElement(
  element: Element
): element is HTMLTextAreaElement | HTMLInputElement {
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }

  return isTextInput(element);
}

export function isTextInput(element: Element): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.matches(TEXT_INPUT_SELECTOR);
}
