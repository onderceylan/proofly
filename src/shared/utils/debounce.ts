export interface DebouncedFunction<F extends (...args: Parameters<F>) => ReturnType<F>> {
  (...args: Parameters<F>): void;
  cancel(): void;
}

export function debounce<F extends (...args: Parameters<F>) => ReturnType<F>>(
  fn: F,
  delayMs: number
): DebouncedFunction<F> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = function (this: unknown, ...args: Parameters<F>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, delayMs);
  };

  debounced.cancel = function () {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced as DebouncedFunction<F>;
}
