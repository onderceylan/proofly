const TEXT_INPUT_SELECTORS = ['input:not([type])', 'input[type="text"]'] as const;
const TEXTAREA_SELECTORS = ['textarea:not([role="textbox"])', '[role="textbox"]'] as const;
const CONTENTEDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';

export const PROOFREAD_TARGET_SELECTORS = [
  TEXTAREA_SELECTORS,
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

export function isSpellcheckDisabled(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('spellcheck');
  return typeof value === 'string' && value.trim().toLowerCase() === 'false';
}

function hasSpellcheckDisabledAncestor(element: HTMLElement): boolean {
  const parent = element.parentElement;
  if (!parent) {
    return false;
  }
  return parent.closest('[spellcheck="false"]') !== null;
}

export function isAutocorrectDisabled(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('autocorrect');
  return typeof value === 'string' && value.trim().toLowerCase() === 'off';
}

export function isWritingSuggestionsDisabled(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('writingsuggestions');
  return typeof value === 'string' && value.trim().toLowerCase() === 'false';
}

export function isHidden(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('aria-hidden');
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export function isReadonly(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const ariaReadonlyValue = element.getAttribute('aria-readonly');
  const readonlyAttr = element.getAttribute('readonly');

  return (
    readonlyAttr !== null ||
    (typeof ariaReadonlyValue === 'string' && ariaReadonlyValue.trim().toLowerCase() === 'true')
  );
}

export function isDisabled(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const ariaDisabledValue = element.getAttribute('aria-disabled');
  const disabledAttr = element.getAttribute('disabled');

  return (
    disabledAttr !== null ||
    (typeof ariaDisabledValue === 'string' && ariaDisabledValue.trim().toLowerCase() === 'true')
  );
}

export function isGrammarlyDisabled(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const grammarlyAttr = element.dataset?.gramm;

  return typeof grammarlyAttr === 'string' && grammarlyAttr.trim().toLowerCase() === 'false';
}

export function isPresentation(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const role = element.getAttribute('role');

  return (
    typeof role === 'string' &&
    (role.trim().toLowerCase() === 'presentation' || role.trim().toLowerCase() === 'none')
  );
}

export function isUsernameField(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('autocomplete');
  return typeof value === 'string' && value.trim().toLowerCase() === 'username';
}

export function isOneTimeCodeField(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('autocomplete');
  return typeof value === 'string' && value.trim().toLowerCase() === 'one-time-code';
}

export function isNumericField(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const value = element.getAttribute('inputmode');
  return typeof value === 'string' && value.trim().toLowerCase() === 'numeric';
}

export function shouldAutoProofread(element: Element): element is HTMLElement {
  if (!isProofreadTarget(element)) {
    return false;
  }

  if (isDisabled(element)) {
    return false;
  }

  if (isHidden(element)) {
    return false;
  }

  if (isReadonly(element)) {
    return false;
  }

  if (isPresentation(element)) {
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

  if (hasSpellcheckDisabledAncestor(element)) {
    return false;
  }

  if (isGrammarlyDisabled(element)) {
    return false;
  }

  if (isUsernameField(element)) {
    return false;
  }

  if (isOneTimeCodeField(element)) {
    return false;
  }

  if (isNumericField(element)) {
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
