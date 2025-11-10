import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger.ts';
import {
  DEFAULT_PROOFREADER_CONFIG,
  DEFAULT_SERVICE_CONFIG,
  IProofreader,
  checkProofreaderAvailability,
  createProofreader,
  createProofreaderAdapter,
  createProofreadingService,
  destroyProofreaderInstance,
  getOrCreateProofreader,
} from './proofreader.ts';

vi.mock('./logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const globalRef = globalThis as Record<string, unknown>;
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

function setupWindow() {
  globalRef.window = globalRef.window ?? (globalThis as Window & typeof globalThis);
  globalRef.globalThis = globalThis;
}

function mockProofreaderGlobals(availability: Availability = 'downloadable') {
  const availabilityMock = vi.fn().mockResolvedValue(availability);
  const proofreaderInstance = {
    proofread: vi.fn().mockResolvedValue({ correctedInput: 'fixed', corrections: [] }),
    destroy: vi.fn(),
  };
  const createMock = vi
    .fn()
    .mockImplementation(async (options?: { monitor?: (monitor: any) => void }) => {
      options?.monitor?.({
        addEventListener: (_event: string, handler: (data: { loaded: number }) => void) => {
          handler({ loaded: 0.25 });
        },
      });
      return proofreaderInstance as unknown as Proofreader;
    });

  (globalThis as Record<string, unknown>).Proofreader = {
    availability: availabilityMock,
    create: createMock,
  };

  return { availabilityMock, createMock, proofreaderInstance };
}

describe('proofreader service', () => {
  beforeEach(() => {
    setupWindow();
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).Proofreader;
    destroyProofreaderInstance();
  });

  it('returns unavailable and warns when API missing', async () => {
    const result = await checkProofreaderAvailability();
    expect(result).toBe('unavailable');
    expect(logger.warn).toHaveBeenCalledWith('Chrome Built-in Proofreader API not available');
  });

  it('delegates availability check to Chrome API', async () => {
    const { availabilityMock } = mockProofreaderGlobals('downloadable');
    const result = await checkProofreaderAvailability();
    expect(result).toBe('downloadable');
    expect(availabilityMock).toHaveBeenCalledWith({
      expectedInputLanguages: DEFAULT_PROOFREADER_CONFIG.expectedInputLanguages,
    });
  });

  it('throws when creating proofreader if API unavailable', async () => {
    mockProofreaderGlobals('unavailable');
    await expect(createProofreader()).rejects.toThrow(
      'Proofreader API not supported on this device'
    );
  });

  it('creates proofreader and reports progress', async () => {
    mockProofreaderGlobals('downloadable');
    const onProgress = vi.fn();
    const proofreader = await createProofreader(DEFAULT_PROOFREADER_CONFIG, onProgress);
    expect(proofreader).toBeDefined();
    expect(onProgress).toHaveBeenCalledWith(0.25);
    expect(logger.info).toHaveBeenCalledWith('Downloaded 25%');
  });

  it('adapts proofreader interface', async () => {
    const { proofreaderInstance } = mockProofreaderGlobals('downloadable');
    const proofreader = await createProofreader();
    const adapter = createProofreaderAdapter(proofreader);
    await adapter.proofread('Hello');
    adapter.destroy();
    expect(proofreaderInstance.proofread).toHaveBeenCalledWith('Hello');
    expect(proofreaderInstance.destroy).toHaveBeenCalledTimes(1);
  });

  it('proofreads text respecting length bounds and hooks', async () => {
    const proofreader: IProofreader = {
      proofread: vi.fn().mockResolvedValue({
        correctedInput: 'fixed',
        corrections: [{ startIndex: 0, endIndex: 4, correction: 'fixed' }],
      }),
      destroy: vi.fn(),
    };
    const onBusyChange = vi.fn();
    const service = createProofreadingService(
      proofreader,
      { ...DEFAULT_SERVICE_CONFIG, minTextLength: 3, maxTextLength: 10 },
      { onBusyChange }
    );

    await expect(service.proofread('')).resolves.toEqual({ correctedInput: '', corrections: [] });
    await expect(service.proofread('hi')).resolves.toEqual({
      correctedInput: 'hi',
      corrections: [],
    });
    await expect(service.proofread('exceedingly long text')).rejects.toThrow(
      'Text length (21) exceeds maximum (10)'
    );

    const result = await service.proofread('valid');
    expect(result.corrections).toHaveLength(1);
    expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);

    expect(service.canProofread('no')).toBe(false);
    expect(service.canProofread('valid')).toBe(true);
    expect(service.getConfig()).toEqual({
      ...DEFAULT_SERVICE_CONFIG,
      minTextLength: 3,
      maxTextLength: 10,
    });

    service.destroy();
    expect(proofreader.destroy).toHaveBeenCalledTimes(1);
  });

  it('reuses singleton proofreader instances', async () => {
    mockProofreaderGlobals('downloadable');
    const first = await getOrCreateProofreader();
    const second = await getOrCreateProofreader();
    expect(first).toBe(second);

    destroyProofreaderInstance();
    mockProofreaderGlobals('downloadable');
    const fresh = await getOrCreateProofreader();
    expect(fresh).not.toBe(first);
  });
});
