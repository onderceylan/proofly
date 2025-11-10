import { describe, expect, it } from 'vitest';
import { AsyncQueue } from './queue.ts';

describe('AsyncQueue', () => {
  it('runs tasks sequentially and resolves values', async () => {
    const queue = new AsyncQueue();
    const order: number[] = [];

    const results = await Promise.all([
      queue.enqueue(async () => {
        order.push(1);
        return 'a';
      }),
      queue.enqueue(async () => {
        order.push(2);
        return 'b';
      }),
    ]);

    expect(order).toEqual([1, 2]);
    expect(results).toEqual(['a', 'b']);
    expect(queue.size()).toBe(0);
  });

  it('propagates rejections without blocking following jobs', async () => {
    const queue = new AsyncQueue();
    const result: string[] = [];

    const first = queue.enqueue(async () => {
      throw new Error('boom');
    });

    const second = queue.enqueue(async () => {
      result.push('second');
      return 'ok';
    });

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
    expect(result).toEqual(['second']);
  });
});
