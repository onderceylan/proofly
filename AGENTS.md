# Proofly Development Guide

Proofly is a privacy-first Chrome extension for proofreading that uses Chrome's Built-in AI API for on-device text correction.

## 🎯 Core Principles

1. **Privacy**: Zero data leaves the user's device
2. **Performance**: Lightweight scripts, lazy loading, minimal overhead
3. **Non-invasiveness**: Zero dependencies, Shadow DOM isolation, no code pollution
4. **Accessibility**: Free, open-source, works offline

## 🏗️ Architecture

### Technology Stack

- **TypeScript**: Strict mode, comprehensive type coverage
  - **Type Definitions**: Add external type packages to `tsconfig.json` `types` array, NOT via reference imports
  - Example: `"types": ["vite/client", "chrome", "@types/dom-chromium-ai"]`
- **Vite + CRXJS**: Modern build pipeline
- **Web Components**: Shadow DOM for UI isolation
- **Vanilla JS**: No frameworks—keep bundle size minimal
- **Functional Programming**: Pure functions, composition, no side effects
- **Dependency Injection**: Services as modules/parameters for testing
- **Design Tokens**: CSS custom properties for theming

### Key Decisions

1. **Modular & Extensible**: Loosely coupled modules with single responsibilities
2. **Functional Core**: Pure functions, easy to test and compose
3. **Dependency Injection**: Never use singletons or global state
4. **Shadow DOM Everywhere**: All UI components MUST use Shadow DOM
5. **Lazy Loading**: Heavy components load only on user interaction
6. **Content Script Minimalism**: Initial injection <5KB, dynamic imports
7. **Zero Dependencies**: Pure vanilla TypeScript only
8. **Design Token System**: CSS custom properties for consistency

## 🔧 Development Guidelines

### Logging Guidelines

**IMPORTANT**:

- **ALWAYS use `logger.info()` for debugging** instead of console.log
- **Use `logger.warn()` for warnings** instead of console.warn
- **Use `logger.error()` for errors** instead of console.error
- **NEVER add 'Proofly' prefix to log messages** - the logger handles context automatically
- The logger is available at `src/services/logger.ts` and should be imported in all modules
- Logger automatically includes context (background, content, options, etc.) and session information

**Example**:

```typescript
import { logger } from '../services/logger.ts';

// ✅ Good: Use logger for debugging
logger.info('Processing proofread request', { textLength: text.length });
logger.warn('Model not ready, queueing request');
logger.error('Failed to proofread', { error });

// ❌ Bad: Using console directly
console.log('Processing request');
console.warn('Model not ready');
console.error('Failed to proofread');

// ❌ Bad: Adding prefix manually
logger.info('Proofly - Processing request'); // Don't do this!
```

### Build Verification

**IMPORTANT**:

- **DO NOT run `npm run build` manually** unless explicitly instructed by the user
- The `npm run dev` script is already running in a separate terminal and automatically builds the extension on file changes
- The dev script watches for changes and rebuilds automatically, providing faster feedback during development
- Only run `npm run build` if specifically requested by the user for production builds or troubleshooting

### Code Formatting

**IMPORTANT**:

- **ALWAYS run `npm run format` after making code changes** to ensure consistent code style
- This formats all TypeScript, JavaScript, JSON, CSS, Markdown, and HTML files according to the project's Prettier configuration
- Formatting is not automatic - you must run the format command manually after changes
- Use `npm run format:check` to verify formatting without making changes (useful for validation)

**Example Workflow**:

```bash
# 1. Make code changes
# 2. Format the code
npm run format

# 3. Verify changes (dev script auto-rebuilds)
# 4. Test the changes
```

### Iteration Testing Checklist

- On every feature/fix iteration run `npm run typecheck` followed by `npm test` to catch regressions early.
- When adding a brand-new e2e scenario, temporarily focus it with `test.only(...)`, run `npm run test:e2e`, and remove the focus flag before committing.

### Standard Testing Workflow for Content Scripts

**FOR EVERY CODE CHANGE**, follow this complete verification workflow:

#### 1. Make Changes

- Implement the requested changes in the codebase
- Dev script auto-rebuilds the extension

#### 2. Open Test Environment

- Ensure test server is running: `python3 -m http.server 8080` (in project root)
- Navigate to http://localhost:8080/test.html (local test page with input, textarea, and contenteditable)
- Or use any other test page appropriate for the feature

#### 3. Type Test Input

- Enter text with intentional errors, issues, or content that exercises the feature
- Simulate real user interactions

#### 4. Verify Changes (4-Step Verification)

**A. Element Inspection via Page Snapshot**

```typescript
mcp__chrome - devtools__take_snapshot({ verbose: false });
```

- Purpose: Inspect DOM structure, verify highlights/corrections are applied
- Check: Element attributes, classes, data attributes, Shadow DOM content
- Verify: Components are rendered, custom elements exist

**B. Visual Verification via Screenshot (Before Click)**

```typescript
mcp__chrome - devtools__take_screenshot({ fullPage: true });
```

- Purpose: Visual confirmation of UI elements, highlights, underlines
- Check: Visual appearance, positioning, styling, user-visible state
- Verify: Colors, wavy underlines, highlight positioning

**C. Issue Card Interaction Test**

```typescript
// 1. Take snapshot to find highlighted text
mcp__chrome - devtools__take_snapshot({ verbose: false });

// 2. Click on a highlighted issue in the textarea
mcp__chrome - devtools__click({ uid: 'textarea_uid' });
// Click at the position of a highlighted word

// 3. Take screenshot to verify issue card appears
mcp__chrome - devtools__take_screenshot({ fullPage: false });
```

- Purpose: Verify user interaction with highlighted issues
- Check: Issue card/popover appears, displays correction details
- Verify: Click detection, popover positioning, correction type label, suggestion text, "Apply Fix" button

**D. Debugging via Extension Logs**

```typescript
mcp__chrome -
  devtools__extension_get_logs({
    extensionId: 'oiaicmknhbpnhngdeppegnhobnleeolm',
    maxEntries: 100,
    contextType: 'all',
    logLevel: 'all',
  });
```

- Purpose: Debug execution flow, verify sequence of operations
- Check: Log messages, timing, execution order, error states
- Verify: Content script initialization, event handlers, API calls, click events

#### 5. Analysis & Iteration

- Compare expected vs actual behavior across all four verification methods
- Check for console errors or warnings via `list_console_messages`
- Verify complete flow: input → detection → highlighting → click → issue card → correction
- If issues found, return to step 1

#### Quick Reference

**Test Page**: http://localhost:8080/test.html
**Test Server**: `python3 -m http.server 8080` (runs in project root)
**Extension ID**: oiaicmknhbpnhngdeppegnhobnleeolm
**Manifest Config**: manifest.config.ts (not manifest.json)

**Test Page Features**:

- **Input field**: Single-line text input with pre-filled error text
- **Textarea**: Multi-line text area with pre-filled error text
- **ContentEditable div**: Editable div with pre-filled error text
- All elements test focus-triggered proofreading for pre-filled values

**Common Test Scenarios**:

- Basic proofreading: Type text with spelling/grammar errors
- Focus events: Click/focus on pre-filled inputs to trigger proofreading
- Performance: Type rapidly, verify responsiveness
- Edge cases: Empty input, special characters, very long text
- UI interactions: Click highlights, hover corrections, accept suggestions

### Chrome Extension Development Loop

When developing and debugging Chrome extension features, follow this iterative testing cycle:

1. **Make Code Changes**: Edit the relevant TypeScript/JavaScript files (dev script auto-rebuilds)
2. **Wait for Auto-Build**: The dev script running in a separate terminal will automatically detect changes and rebuild
3. **Navigate to Extension Page**: Use Chrome DevTools MCP to navigate to the extension page
   - Example: `chrome-extension://[extension-id]/src/options/index.html`
4. **Fill Test Data**: Use `fill` tool to fill form inputs, trigger events, simulate user interactions
   - Use `evaluate_script` as the last resort to programmatically interact with the page if `fill` tool does not work
5. **Inspect Console Logs**: Use `list_console_messages` to check for:
   - JavaScript errors
   - Debug logs
   - API responses
   - State changes
   - Avoid `get_console_message` tool calling as it does not have access to extension contexts
6. **Access Extension Logs**: Use `extension_get_logs` to retrieve app logs across all contexts:
   ```typescript
   mcp__chrome -
     devtools__extension_get_logs({
       extensionId: 'oiaicmknhbpnhngdeppegnhobnleeolm',
       maxEntries: 100,
       contextType: 'all',
       logLevel: 'all',
     });
   ```
   This captures logs from background, content scripts, popup, sidebar, and options pages.
7. **Take Page Snapshots**: Use `take_snapshot` to verify DOM state and UI elements
   - Check element text content
   - Verify component rendering
   - Inspect accessibility tree
8. **Verify Behavior**: Check if the feature works as expected
9. **Iterate**: If issues found, repeat from step 1

**Example Testing Cycle**:

```typescript
// 1. Make code changes (dev script auto-rebuilds in the background)

// 2. Navigate to extension page
mcp__chrome -
  devtools__navigate_page({
    url: 'chrome-extension://oiaicmknhbpnhngdeppegnhobnleeolm/src/options/index.html',
  });

// 3. Fill test data via script evaluation
mcp__chrome -
  devtools__fill_form({
    elements: [
      { uid: '71_3', value: 'Text for input field' },
      { uid: '71_5', value: 'Text for textarea' },
    ],
  });

// 4. Check console for errors/logs
mcp__chrome -
  devtools__extension_get_logs({
    extensionId: 'oiaicmknhbpnhngdeppegnhobnleeolm',
    maxEntries: 100,
    contextType: 'all',
    logLevel: 'all',
  });

// 6. Verify DOM state
mcp__chrome - devtools__take_snapshot();

// 7. Verify specific elements or corrections appeared
mcp__chrome - devtools__take_screenshot();
```

**Key Principles**:

- **Do NOT take screenshots** in the testing loop - use snapshots for faster verification
- **Do NOT run `npm run build`** - the dev script handles automatic rebuilding
- Use console logs extensively for debugging complex logic
- Leverage `evaluate_script` to simulate user interactions programmatically
- Check both console output AND DOM state to verify behavior
- Use `extension_get_logs` to access structured logs across all extension contexts

### E2E Helpers

- Always move reusable e2e utilities (helpers, capture logic, shared waits) into `e2e/helpers/utils.ts` so specs stay focused on scenarios.

### Code Style

#### Import Paths

- **NEVER use `~` or other aliases for imports**: Always use relative paths
- **Example**:

  ```typescript
  // ❌ Bad: Using alias
  import { logger } from '~/services/logger.ts';

  // ✅ Good: Relative path
  import { logger } from '../services/logger.ts';
  ```

#### Comments

- **Don't use comments with code**: Avoid adding comments and descriptions to files, variables, and functions
- **Self-explanatory naming**: Use clear, descriptive names for variables, functions, and types
- **Example**:

  ```typescript
  // ❌ Bad: Unnecessary comment
  // Get the user's name
  const name = user.name;

  // ✅ Good: Self-explanatory
  const userName = user.name;
  ```

#### Modern Web APIs Only

**IMPORTANT: NO DEPRECATED APIs**

- **NEVER use `document.execCommand()`**: This API is deprecated and should not be used
- **Target: Chrome Browser**: We only target Chrome, so use any modern baseline Chrome APIs
- **Use Modern Alternatives**:
  - For text insertion: Use `setRangeText()` for textarea/input, Selection/Range API for contenteditable
  - For clipboard: Use `navigator.clipboard` API (writeText, readText)
  - For undo/redo: Implement custom undo manager with history stack

**Example**:

```typescript
// ❌ Bad: Using deprecated execCommand
document.execCommand('insertText', false, 'hello');
document.execCommand('copy');

// ✅ Good: Modern Chrome APIs
// For textarea/input
element.setRangeText('hello', start, end, 'end');

// For clipboard
await navigator.clipboard.writeText('hello');

// For undo/redo
undoManager.saveState(element);
element.setRangeText(replacement, start, end);
```

**Rationale**:

- `execCommand` is deprecated and will be removed from browsers
- Modern APIs are more reliable and consistent
- Custom undo manager gives us full control over undo/redo behavior
- Ensures future compatibility

### Architectural Principles

#### 1. Modularity & Loose Coupling

```typescript
// ✅ Good: Dependency injected
interface IProofreader {
  proofread(text: string): Promise<ProofreadResult>;
}

function createProofreadingService(proofreader: IProofreader) {
  return {
    async proofread(text: string): Promise<ProofreadResult> {
      return proofreader.proofread(text);
    },
  };
}
```

#### 2. Pure Functions & Composition

```typescript
// ✅ Good: Pure function, no side effects
function buildCorrectedText(originalText: string, corrections: ProofreadCorrection[]): string {
  let result = originalText;
  const sortedCorrections = [...corrections].sort((a, b) => b.startIndex - a.startIndex);

  for (const correction of sortedCorrections) {
    result =
      result.substring(0, correction.startIndex) +
      correction.correction +
      result.substring(correction.endIndex);
  }

  return result;
}
```

### File Organization

```
src/
├── background/
│   ├── service-worker.ts
│   └── message-handler.ts
├── content/
│   ├── main.ts                          # <5KB entry
│   ├── components/                      # Web components (Shadow DOM)
│   ├── handlers/                        # Target-specific handlers
│   │   ├── target-handler.ts            # Handler interface
│   │   ├── mirror-target-handler.ts     # For input/textarea (mirror overlay)
│   │   └── direct-target-handler.ts     # For contenteditable (direct highlighting)
│   ├── services/                        # Content script services
│   │   ├── element-tracker.ts           # DOM observation & element registry
│   │   ├── popover-manager.ts           # Popover UI lifecycle
│   │   ├── preference-manager.ts        # Storage & settings management
│   │   ├── issue-manager.ts             # Corrections & messages storage
│   │   └── content-proofreading-service.ts  # Wraps ProofreadingController
│   └── proofreading-manager.ts          # Coordinates all services
├── services/                            # Shared services (pure functions)
│   ├── proofreader.ts
│   └── model-downloader.ts
├── popup/
├── sidepanel/
├── options/
├── shared/
│   ├── types.ts
│   ├── constants.ts
│   ├── proofreading/                    # Shared proofreading logic
│   │   ├── controller.ts                # Core proofreading controller
│   │   ├── target-selectors.ts          # Element validation utilities
│   │   └── control-events.ts            # Lifecycle event system
│   ├── utils/                           # Pure utility functions
│   └── styles/
│       ├── tokens.css                   # Design tokens
│       ├── reset.css
│       └── mixins.css
└── manifest.json
```

#### Content Script Services

The `src/content/services/` directory contains focused services that handle specific aspects of proofreading:

**`element-tracker.ts`**

- **Purpose**: DOM observation and element lifecycle management
- **Responsibilities**:
  - Sets up `MutationObserver` to detect added/removed elements
  - Manages document-level event listeners (`input`, `focus`, `blur`)
  - Maintains registry of tracked elements with unique IDs
  - Provides element validation via shared `target-selectors.ts`
- **Key Methods**: `initialize()`, `registerElement()`, `getElementId()`, `isProofreadTarget()`, `shouldAutoProofread()`

**`content-proofreading-service.ts`**

- **Purpose**: Wraps shared `ProofreadingController` with content-specific logic
- **Responsibilities**:
  - Integrates language detection service
  - Implements `runProofread` dependency (handles `chrome.runtime.sendMessage`)
  - Manages async proofreading queue
  - Reports proofreader busy state to background
  - Handles error messages (unsupported language, detection failures)
- **Key Methods**: `initialize()`, `proofread()`, `scheduleProofread()`, `applyCorrection()`

**`issue-manager.ts`**

- **Purpose**: Manages corrections, messages, and issue broadcasting
- **Responsibilities**:
  - Stores corrections and error messages per element
  - Maintains issue ID lookup for fast correction retrieval
  - Emits issues updates to sidepanel/background via `chrome.runtime.sendMessage`
  - Builds issue payloads with element metadata
- **Key Methods**: `setCorrections()`, `getCorrection()`, `setMessage()`, `emitIssuesUpdate()`

**`popover-manager.ts`**

- **Purpose**: Manages correction popover UI lifecycle
- **Responsibilities**:
  - Creates and destroys `CorrectionPopover` component
  - Controls visibility based on autofix settings
  - Handles popover hide events
  - Integrates with `ContentHighlighter`
- **Key Methods**: `show()`, `hide()`, `updateVisibility()`, `setAutofixOnDoubleClick()`

**`preference-manager.ts`**

- **Purpose**: Centralized settings and storage management
- **Responsibilities**:
  - Loads initial preferences from `chrome.storage`
  - Sets up storage change listeners
  - Emits events when preferences change
  - Manages correction types, colors, underline style, shortcuts
- **Key Methods**: `initialize()`, `getEnabledCorrectionTypes()`, `getCorrectionColors()`, `buildIssuePalette()`

#### Shared Proofreading Logic

**`src/shared/proofreading/controller.ts`**

- Core proofreading controller with debouncing, queueing, and undo integration
- Used by `ContentProofreadingService` via dependency injection

**`src/shared/proofreading/target-selectors.ts`**

- Element validation utilities (`isProofreadTarget`, `shouldAutoProofread`)
- Used by `ElementTracker` and `ProofreadingManager`

**`src/shared/proofreading/control-events.ts`**

- Lifecycle event system for proofreading operations
- Emits events for monitoring and debugging

### Web Component Pattern

**IMPORTANT: Custom Element Naming Convention**

- All custom elements MUST use the `prfly-` prefix
- Examples: `prfly-mirror`, `prfly-highlighter`, `prfly-textarea`, `prfly-issues-sidebar`
- This prevents conflicts with other extensions and libraries

```typescript
export class ProoflyComponent extends HTMLElement {
  private shadow: ShadowRoot;
  private cleanup: Array<() => void> = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.attachEventListeners();
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
  }

  private getStyles(): string {
    return `
      @import url('/styles/tokens.css');

      :host {
        display: block;
        font-family: var(--font-family-base);
      }
    `;
  }
}

// Register with prfly- prefix
customElements.define('prfly-component-name', ProoflyComponent);
```

### Design Tokens

```css
/* src/shared/styles/tokens.css */
:host,
:root {
  /* Colors */
  --color-primary: #4f46e5;
  --color-surface: #ffffff;
  --color-text-primary: #111827;
  --color-error: #dc2626;

  /* Correction Type Colors */
  --correction-spelling-color: #dc2626;
  --correction-grammar-color: #2563eb;
  --correction-punctuation-color: #7c3aed;
  --correction-capitalization-color: #ea580c;
  --correction-preposition-color: #0891b2;
  --correction-missing-words-color: #16a34a;

  /* Typography */
  --font-family-base: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;

  /* Spacing */
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;

  /* Border radius */
  --radius-md: 0.5rem;

  /* Shadows */
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);

  /* Z-index */
  --z-popover: 1050;

  /* Transitions */
  --transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

## 🤖 Chrome Built-in AI Proofreader API

### Check Availability

```typescript
async function checkProofreaderAvailability(): Promise<Availability> {
  if (!('Proofreader' in window)) {
    return 'unavailable';
  }

  const availability = await Proofreader.availability({
    expectedInputLanguages: ['en'],
    includeCorrectionTypes: true,
  });

  return availability; // "unavailable" | "downloadable" | "downloading" | "available"
}
```

### Create Proofreader with Progress

```typescript
async function createProofreader(): Promise<Proofreader> {
  const proofreader = await Proofreader.create({
    expectedInputLanguages: ['en'],
    includeCorrectionTypes: true, // Enable type classification
    includeCorrectionExplanations: true,
    correctionExplanationLanguage: 'en',
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        console.log(`Downloaded ${e.loaded * 100}%`);
        updateDownloadProgress(e.loaded);
      });
    },
  });

  return proofreader;
}
```

### Proofread Text

```typescript
async function proofreadText(proofreader: Proofreader, text: string): Promise<ProofreadResult> {
  const result = await proofreader.proofread(text);
  // {
  //   correctedInput: "Fully corrected text",
  //   corrections: [{ startIndex, endIndex, correction, type?, explanation? }]
  // }
  return result;
}
```

### Key Types

```typescript
interface ProofreadResult {
  correctedInput: string;
  corrections: ProofreadCorrection[];
}

interface ProofreadCorrection {
  startIndex: number;
  endIndex: number;
  correction: string;
  type?: CorrectionType;
  explanation?: string;
}

type CorrectionType =
  | 'spelling'
  | 'grammar'
  | 'punctuation'
  | 'capitalization'
  | 'preposition'
  | 'missing-words';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
```

### Correction Type Colors

```typescript
// src/shared/constants/correction-types.ts
export const CORRECTION_TYPES = {
  spelling: {
    color: '#dc2626',
    background: '#fef2f2',
    border: '#fecaca',
    label: 'Spelling',
  },
  grammar: {
    color: '#2563eb',
    background: '#eff6ff',
    border: '#bfdbfe',
    label: 'Grammar',
  },
  punctuation: {
    color: '#7c3aed',
    background: '#f5f3ff',
    border: '#ddd6fe',
    label: 'Punctuation',
  },
  capitalization: {
    color: '#ea580c',
    background: '#fff7ed',
    border: '#fed7aa',
    label: 'Capitalization',
  },
  preposition: {
    color: '#0891b2',
    background: '#ecfeff',
    border: '#a5f3fc',
    label: 'Preposition',
  },
  'missing-words': {
    color: '#16a34a',
    background: '#f0fdf4',
    border: '#bbf7d0',
    label: 'Missing Words',
  },
} as const;

export function getCorrectionTypeColor(type?: CorrectionType) {
  if (!type) return CORRECTION_TYPES.spelling;
  return CORRECTION_TYPES[type] || CORRECTION_TYPES.spelling;
}
```

### Hardware Requirements

- **OS**: Windows 10/11, macOS 13+, Linux, or ChromeOS on Chromebook Plus
- **Storage**: At least 22 GB free space
- **GPU**: More than 4 GB VRAM
- **Network**: Unlimited data or unmetered connection (for download)

## 📐 Service Patterns

### Pattern 1: Factory Functions with Dependency Injection

```typescript
export interface TextExtractorConfig {
  minLength: number;
  maxLength: number;
  normalizeWhitespace: boolean;
}

export function createTextExtractor(config: TextExtractorConfig) {
  return {
    extract(element: HTMLElement): string | null {
      let text = extractTextFromElement(element);

      if (config.normalizeWhitespace) {
        text = normalizeWhitespace(text);
      }

      if (text.length < config.minLength || text.length > config.maxLength) {
        return null;
      }

      return text;
    },
  };
}
```

### Pattern 2: Event-Based Communication

```typescript
// src/shared/events.ts
export interface ProoflyEvents {
  'proofread:start': { text: string; element: HTMLElement };
  'proofread:complete': { result: ProofreadResult; element: HTMLElement };
  'proofread:error': { error: Error; element: HTMLElement };
}

export function createEventDispatcher(target: EventTarget = document) {
  return {
    dispatch<T extends keyof ProoflyEvents>(name: T, data: ProoflyEvents[T]): void {
      target.dispatchEvent(new CustomEvent(name, { detail: data, bubbles: true }));
    },

    on<T extends keyof ProoflyEvents>(
      name: T,
      handler: (event: CustomEvent<ProoflyEvents[T]>) => void
    ): () => void {
      const listener = handler as EventListener;
      target.addEventListener(name, listener);
      return () => target.removeEventListener(name, listener);
    },
  };
}
```

### Pattern 3: Async Helpers

```typescript
// src/shared/utils/async-utils.ts
export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
}

export async function withRetry<T>(operation: () => Promise<T>, config: RetryConfig): Promise<T> {
  let lastError: Error;
  let delay = config.delayMs;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (attempt < config.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= config.backoffMultiplier;
      }
    }
  }
  throw lastError!;
}
```

## 🔄 Model Download UX

### Client-Side Pattern

```html
<button type="button" id="enableProofly">Enable Proofly</button>
<progress hidden id="downloadProgress" value="0"></progress>
<label for="downloadProgress">Downloading AI model (~22GB)...</label>
```

```typescript
enableButton.addEventListener('click', async () => {
  try {
    enableButton.disabled = true;
    proofreaderSession = await createProofreaderWithProgress(progressBar);
    await chrome.storage.local.set({ proofreaderReady: true });
    enableButton.textContent = '✓ Proofly Enabled';
  } catch (error) {
    alert(`Failed to enable Proofly: ${error.message}`);
    enableButton.disabled = false;
  }
});
```

## 🎨 UX Patterns

### 1. Auto-Correct (Default)

```typescript
async function shouldAutoCorrect(): Promise<boolean> {
  const settings = await chrome.storage.sync.get({ autoCorrect: true });
  return settings.autoCorrect;
}

document.addEventListener('input', async (e) => {
  if (!isEditableElement(e.target)) return;
  if (!(await shouldAutoCorrect())) return;

  clearTimeout(proofreadTimeout);
  proofreadTimeout = setTimeout(async () => {
    const text = getTextFromElement(e.target);
    if (text.length > 10) await proofreadAndShowSuggestions(text, e.target);
  }, 1000);
});
```

### 2. Manual Activation

```typescript
chrome.contextMenus.create({
  id: 'prooflyCheck',
  title: 'Proofread with Proofly',
  contexts: ['selection', 'editable'],
});
```

## 🚫 Anti-Patterns

1. **❌ Global CSS/JavaScript Pollution**: Always use Shadow DOM
2. **❌ Heavy Dependencies**: Keep it pure vanilla TypeScript
3. **❌ Aggressive Permissions**: Only request necessary Chrome APIs
4. **❌ Telemetry**: No analytics or tracking—ever
5. **❌ Memory Leaks**: Always cleanup event listeners
6. **❌ Large Bundle Sizes**: Initial content script <5KB gzipped
7. **❌ Blocking Page Load**: Never interfere with host page

## 🧪 Testing

### Pure Functions

```typescript
// src/shared/utils/text-utils.test.ts
import { describe, it, expect } from 'vitest';
import { extractWords } from './text-utils';

describe('extractWords', () => {
  it('splits text into words', () => {
    expect(extractWords('hello world')).toEqual(['hello', 'world']);
  });
});
```

### Services with DI

```typescript
describe('ProofreadingService', () => {
  it('returns empty corrections for empty text', async () => {
    const mockProofreader: IProofreader = { proofread: vi.fn() };
    const service = createProofreadingService(mockProofreader);
    const result = await service.proofread('   ');

    expect(result.corrections).toHaveLength(0);
    expect(mockProofreader.proofread).not.toHaveBeenCalled();
  });
});
```

---

**Remember**: Every line of code should ask "Does this respect user privacy?" and "Is this truly necessary?"
