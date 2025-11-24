import { AsyncQueue } from '../../shared/utils/queue.ts';
import {
  createLanguageDetector,
  createLanguageDetectorAdapter,
  createLanguageDetectionService,
} from '../../services/language-detector.ts';
import { logger } from '../../services/logger.ts';
import {
  createProofreadingController,
  type ProofreadingController,
  type ProofreadRunContext,
} from '../../shared/proofreading/controller.ts';
import type { ProofreadCorrection, ProofreadResult } from '../../shared/types.ts';
import type { ProofreadingTarget } from '../../shared/proofreading/types.ts';
import type {
  ProofreadRequestMessage,
  ProofreadResponse,
  IssueGroupError,
  IssueGroupErrorCode,
} from '../../shared/messages/issues.ts';

export interface ContentProofreadingServiceOptions {
  debounceMs: number;
  getElementText: (element: HTMLElement) => string;
  filterCorrections: (corrections: ProofreadCorrection[], text: string) => ProofreadCorrection[];
  onLifecycleEvent?: (event: any) => void;
  onBusyChange?: (busy: boolean) => void;
  onMessage?: (element: HTMLElement, message: IssueGroupError) => void;
  onClearMessage?: (element: HTMLElement, code?: IssueGroupErrorCode) => void;
}

export class ContentProofreadingService {
  private controller: ProofreadingController;
  private languageDetectionService: ReturnType<typeof createLanguageDetectionService> | null = null;
  private readonly proofreadQueue = new AsyncQueue();
  private lastProofreaderBusy = false;

  constructor(private readonly options: ContentProofreadingServiceOptions) {
    this.controller = createProofreadingController({
      runProofread: (element, text, context) => this.runProofread(element, text, context),
      filterCorrections: (_element, corrections, text) =>
        this.options.filterCorrections(corrections, text),
      debounceMs: this.options.debounceMs,
      getElementText: this.options.getElementText,
      onLifecycleEvent: this.options.onLifecycleEvent,
    });
  }

  async initialize(): Promise<void> {
    await this.initializeLanguageDetection();
  }

  destroy(): void {
    this.controller.dispose();
    this.languageDetectionService?.destroy();
    this.languageDetectionService = null;
    this.proofreadQueue.clear();
  }

  registerTarget(target: ProofreadingTarget): void {
    this.controller.registerTarget(target);
  }

  unregisterTarget(element: HTMLElement): void {
    this.controller.unregisterTarget(element);
  }

  async proofread(
    element: HTMLElement,
    options?: { force?: boolean; selection?: any }
  ): Promise<void> {
    return this.controller.proofread(element, options);
  }

  scheduleProofread(element: HTMLElement): void {
    this.controller.scheduleProofread(element);
  }

  cancelPendingProofreads(): void {
    this.controller.cancelPendingProofreads();
  }

  applyCorrection(element: HTMLElement, correction: ProofreadCorrection): void {
    this.controller.applyCorrection(element, correction);
  }

  getCorrections(element: HTMLElement): ProofreadCorrection[] {
    return this.controller.getCorrections(element);
  }

  isRestoringFromHistory(element: HTMLElement): boolean {
    return this.controller.isRestoringFromHistory(element);
  }

  private async initializeLanguageDetection(): Promise<void> {
    try {
      const detector = await createLanguageDetector();
      const adapter = createLanguageDetectorAdapter(detector);
      this.languageDetectionService = createLanguageDetectionService(adapter);
      logger.info('Language detection service initialized');
    } catch (error) {
      logger.warn({ error }, 'Language detection unavailable, using English fallback');
      this.languageDetectionService = null;
    }
  }

  private async runProofread(
    element: HTMLElement,
    text: string,
    context: ProofreadRunContext
  ): Promise<ProofreadResult | null> {
    return this.proofreadQueue.enqueue(async () => {
      const selection = context.selection;
      const targetText = selection ? text.slice(selection.start, selection.end) : text;
      let detectedLanguage: string | null = null;

      if (this.languageDetectionService) {
        try {
          detectedLanguage = await this.languageDetectionService.detectLanguage(targetText);
          if (detectedLanguage) {
            this.options.onClearMessage?.(element, 'language-detection-unconfident');
            this.options.onClearMessage?.(element, 'language-detection-error');
          } else {
            this.options.onMessage?.(element, this.buildLanguageDetectionUnconfidentWarning());
            this.options.onClearMessage?.(element, 'language-detection-error');
          }
        } catch (error) {
          logger.warn({ error }, 'Language detection failed, falling back to English');
          this.options.onClearMessage?.(element, 'language-detection-unconfident');
          this.options.onMessage?.(element, this.buildLanguageDetectionError());
          detectedLanguage = null;
        }
      } else {
        this.options.onClearMessage?.(element, 'language-detection-unconfident');
        this.options.onClearMessage?.(element, 'language-detection-error');
      }

      const fallbackLanguage = 'en';
      const requestedLanguage = detectedLanguage?.trim() || fallbackLanguage;

      const response = await this.requestProofread(
        targetText,
        requestedLanguage,
        fallbackLanguage,
        context
      );

      if (!response.ok) {
        if (response.error.code === 'unsupported-language') {
          this.options.onMessage?.(
            element,
            this.buildUnsupportedLanguageError(requestedLanguage, response.error.message)
          );
          logger.warn(
            { language: requestedLanguage, error: response.error.message },
            'Proofreader rejected requested language'
          );
          return null;
        }

        if (response.error.code === 'cancelled') {
          logger.info(
            { language: requestedLanguage },
            'Proofreader request cancelled, scheduling retry'
          );
          if (!selection) {
            queueMicrotask(() => {
              this.controller.scheduleProofread(element);
            });
          }
          throw new DOMException(
            response.error.message || 'Proofreader request cancelled',
            'AbortError'
          );
        }

        throw new Error(response.error.message || 'Proofreader request failed');
      }

      this.options.onClearMessage?.(element, 'unsupported-language');
      const result = response.result;

      if (!result || !selection) {
        return result;
      }

      // Rebase corrections if selection was used
      const prefix = text.slice(0, selection.start);
      const suffix = text.slice(selection.end);
      const corrections = result.corrections.map((correction) => ({
        ...correction,
        startIndex: correction.startIndex + selection.start,
        endIndex: correction.endIndex + selection.start,
      }));

      return {
        correctedInput: `${prefix}${result.correctedInput}${suffix}`,
        corrections,
      };
    });
  }

  private async requestProofread(
    text: string,
    language: string,
    fallbackLanguage: string,
    context: ProofreadRunContext
  ): Promise<ProofreadResponse> {
    const request: ProofreadRequestMessage = {
      type: 'proofly:proofread-request',
      payload: {
        requestId: context.executionId,
        text,
        language,
        fallbackLanguage,
      },
    };

    this.reportProofreaderBusy(true);
    try {
      const response = (await chrome.runtime.sendMessage(request)) as ProofreadResponse | null;
      if (!response) {
        throw new Error('Proofreader service returned empty response');
      }
      return response;
    } catch (error) {
      logger.error(
        { error, language, fallbackLanguage },
        'Failed to dispatch proofreader request to service worker'
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    } finally {
      this.reportProofreaderBusy(false);
    }
  }

  private reportProofreaderBusy(busy: boolean): void {
    if (this.lastProofreaderBusy === busy) {
      return;
    }

    this.lastProofreaderBusy = busy;
    this.options.onBusyChange?.(busy);

    try {
      void chrome.runtime
        .sendMessage({ type: 'proofly:proofreader-state', payload: { busy } })
        .catch((error) => {
          logger.warn({ error }, 'Failed to notify background of proofreader state');
        });
    } catch (error) {
      logger.warn({ error }, 'Proofreader state notification threw unexpectedly');
    }
  }

  private buildUnsupportedLanguageError(language: string, errorMessage?: string): IssueGroupError {
    const languageLabel = language?.trim() || 'unknown';
    const details = errorMessage ? ` Reason: ${errorMessage}` : '';
    return {
      code: 'unsupported-language',
      severity: 'error',
      message: `Proofreader API rejected language "${languageLabel}".${details}`.trim(),
      details: {
        language: languageLabel,
      },
    };
  }

  private buildLanguageDetectionUnconfidentWarning(): IssueGroupError {
    return {
      code: 'language-detection-unconfident',
      severity: 'warning',
      message:
        "Could not confidently detect this field's language. Defaulting to English for proofreading.",
    };
  }

  private buildLanguageDetectionError(): IssueGroupError {
    return {
      code: 'language-detection-error',
      severity: 'error',
      message:
        'Language detection failed on this field. Defaulting to English; results might be less accurate.',
    };
  }
}
