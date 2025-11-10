import { describe, expect, it } from 'vitest';
import { serializeError, serializeMessage } from './serialize.ts';

describe('serialize utilities', () => {
  it('serializes Error instances with stack information', () => {
    const err = new Error('boom');
    const result = serializeError(err);
    expect(result).toMatchObject({ message: 'boom' });
  });

  it('stringifies plain objects and guards against failures', () => {
    const result = serializeError({ foo: 'bar' });
    expect(result).toBe('{"foo":"bar"}');

    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(serializeError(cyclic)).toBe('[unserializable object]');
  });

  it('normalizes primitive messages', () => {
    expect(serializeMessage('hello')).toBe('hello');
    expect(serializeMessage(42)).toBe('42');
    expect(serializeMessage(null)).toBe('null');
  });

  it('serializes objects and reports unserializable errors', () => {
    expect(serializeMessage({ hi: 'there' })).toBe('{"hi":"there"}');
    const payload: any = {};
    payload.self = payload;
    const result = serializeMessage(payload);
    expect(result.startsWith('[unserializable:')).toBe(true);
  });
});
