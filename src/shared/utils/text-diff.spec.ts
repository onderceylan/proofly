import { describe, it, expect } from 'vitest';
import { computeIncrementalSelection, shiftCorrections } from './text-diff.ts';
import type { ProofreadCorrection } from '../types.ts';

describe('computeIncrementalSelection', () => {
  it('returns null for identical texts', () => {
    expect(computeIncrementalSelection('hello', 'hello')).toBeNull();
  });

  it('returns null for empty old text', () => {
    expect(computeIncrementalSelection('', 'hello')).toBeNull();
  });

  it('detects single character insertion mid-paragraph', () => {
    const result = computeIncrementalSelection(
      'First paragraph.\nSecond pragraph.\nThird paragraph.',
      'First paragraph.\nSecond paragraph.\nThird paragraph.'
    );
    expect(result).not.toBeNull();
    expect(result!.selection.start).toBe(17);
    expect(result!.selection.end).toBe(35);
    expect(result!.delta).toBe(1);
  });

  it('detects deletion in a paragraph', () => {
    const result = computeIncrementalSelection('Hello world.\nBye world.', 'Hello.\nBye world.');
    expect(result).not.toBeNull();
    expect(result!.selection.start).toBe(0);
    expect(result!.selection.end).toBe(7);
    expect(result!.delta).toBe(-6);
  });

  it('expands to paragraph boundaries', () => {
    const result = computeIncrementalSelection('AAA\nBBB\nCCC', 'AAA\nBXB\nCCC');
    expect(result).not.toBeNull();
    expect(result!.selection.start).toBe(4);
    expect(result!.selection.end).toBe(8);
  });

  it('returns null when change covers most of the text', () => {
    const result = computeIncrementalSelection('ABCDE', 'XYZWV');
    expect(result).toBeNull();
  });

  it('returns null when single paragraph text changes', () => {
    const result = computeIncrementalSelection(
      'Hello world, this is a test',
      'Hello world, this is a tset'
    );
    expect(result).toBeNull();
  });

  it('handles appending text at the end of a paragraph', () => {
    const result = computeIncrementalSelection(
      'First line.\nSecond line.',
      'First line.\nSecond line. More text.'
    );
    expect(result).not.toBeNull();
    expect(result!.selection.start).toBe(12);
    expect(result!.delta).toBe(11);
  });

  it('handles insertion of a new paragraph', () => {
    const result = computeIncrementalSelection('AAA\nCCC', 'AAA\nBBB\nCCC');
    expect(result).not.toBeNull();
    expect(result!.selection.start).toBe(4);
    expect(result!.selection.end).toBe(8);
    expect(result!.delta).toBe(4);
  });

  it('handles change at the very start', () => {
    const result = computeIncrementalSelection('Hello.\nWorld.', 'Hi.\nWorld.');
    expect(result).not.toBeNull();
    expect(result!.selection.start).toBe(0);
    expect(result!.selection.end).toBe(4);
  });
});

describe('shiftCorrections', () => {
  const makeCorrection = (start: number, end: number): ProofreadCorrection => ({
    startIndex: start,
    endIndex: end,
    correction: 'fix',
  });

  it('returns corrections unchanged when delta is 0', () => {
    const corrections = [makeCorrection(0, 5), makeCorrection(10, 15)];
    expect(shiftCorrections(corrections, 8, 0)).toEqual(corrections);
  });

  it('shifts corrections after the edit point by positive delta', () => {
    const corrections = [makeCorrection(0, 3), makeCorrection(10, 15)];
    const shifted = shiftCorrections(corrections, 5, 2);
    expect(shifted[0]).toEqual(makeCorrection(0, 3));
    expect(shifted[1]).toEqual(makeCorrection(12, 17));
  });

  it('shifts corrections after the edit point by negative delta', () => {
    const corrections = [makeCorrection(0, 3), makeCorrection(10, 15)];
    const shifted = shiftCorrections(corrections, 5, -2);
    expect(shifted[0]).toEqual(makeCorrection(0, 3));
    expect(shifted[1]).toEqual(makeCorrection(8, 13));
  });

  it('does not shift corrections before the edit point', () => {
    const corrections = [makeCorrection(0, 3), makeCorrection(10, 15)];
    const shifted = shiftCorrections(corrections, 20, 5);
    expect(shifted).toEqual(corrections);
  });

  it('shifts corrections exactly at the edit point', () => {
    const corrections = [makeCorrection(5, 10)];
    const shifted = shiftCorrections(corrections, 5, 3);
    expect(shifted[0]).toEqual(makeCorrection(8, 13));
  });
});
