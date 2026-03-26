import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, unwrap, unwrapOr, map, flatMap } from '../result.js';
import { NotFoundError, ValidationError } from '../errors.js';

// ─── ok() ─────────────────────────────────────────────────────────

describe('ok()', () => {
  it('creates a success result', () => {
    const result = ok(42);
    expect(result.success).toBe(true);
    expect(result).toEqual({ success: true, data: 42 });
  });

  it('works with objects', () => {
    const data = { id: '1', name: 'test' };
    const result = ok(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(data);
    }
  });

  it('works with null', () => {
    const result = ok(null);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('works with undefined', () => {
    const result = ok(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });
});

// ─── err() ────────────────────────────────────────────────────────

describe('err()', () => {
  it('creates a failure result', () => {
    const error = new NotFoundError('User not found');
    const result = err(error);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(error);
    }
  });

  it('works with string errors', () => {
    const result = err('something went wrong');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('something went wrong');
    }
  });
});

// ─── isOk() ───────────────────────────────────────────────────────

describe('isOk()', () => {
  it('returns true for ok results', () => {
    expect(isOk(ok(42))).toBe(true);
    expect(isOk(ok(null))).toBe(true);
    expect(isOk(ok(''))).toBe(true);
  });

  it('returns false for err results', () => {
    expect(isOk(err(new NotFoundError()))).toBe(false);
    expect(isOk(err('fail'))).toBe(false);
  });
});

// ─── isErr() ──────────────────────────────────────────────────────

describe('isErr()', () => {
  it('returns true for err results', () => {
    expect(isErr(err(new NotFoundError()))).toBe(true);
    expect(isErr(err('fail'))).toBe(true);
  });

  it('returns false for ok results', () => {
    expect(isErr(ok(42))).toBe(false);
    expect(isErr(ok(null))).toBe(false);
  });
});

// ─── unwrap() ─────────────────────────────────────────────────────

describe('unwrap()', () => {
  it('returns data for ok results', () => {
    expect(unwrap(ok(42))).toBe(42);
    expect(unwrap(ok('hello'))).toBe('hello');
    expect(unwrap(ok(null))).toBeNull();
  });

  it('throws for err results with Error instances', () => {
    const error = new NotFoundError('missing');
    expect(() => unwrap(err(error))).toThrow(NotFoundError);
    expect(() => unwrap(err(error))).toThrow('missing');
  });

  it('throws wrapped Error for non-Error err values', () => {
    expect(() => unwrap(err('string error'))).toThrow('string error');
  });
});

// ─── unwrapOr() ───────────────────────────────────────────────────

describe('unwrapOr()', () => {
  it('returns data for ok results', () => {
    expect(unwrapOr(ok(42), 0)).toBe(42);
    expect(unwrapOr(ok('hello'), 'default')).toBe('hello');
  });

  it('returns fallback for err results', () => {
    expect(unwrapOr(err(new NotFoundError()), 0)).toBe(0);
    expect(unwrapOr(err('fail'), 'default')).toBe('default');
  });

  it('returns null data over fallback', () => {
    expect(unwrapOr(ok(null), 'fallback')).toBeNull();
  });
});

// ─── map() ────────────────────────────────────────────────────────

describe('map()', () => {
  it('transforms ok value', () => {
    const result = map(ok(2), (x) => x * 3);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toBe(6);
    }
  });

  it('passes through err unchanged', () => {
    const error = new NotFoundError('nope');
    const result = map(err(error), (x: number) => x * 3);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe(error);
    }
  });

  it('supports type-changing transformations', () => {
    const result = map(ok(42), (n) => n.toString());
    if (isOk(result)) {
      expect(result.data).toBe('42');
    }
  });
});

// ─── flatMap() ────────────────────────────────────────────────────

describe('flatMap()', () => {
  it('chains ok results', () => {
    const result = flatMap(ok(2), (x) => ok(x * 3));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toBe(6);
    }
  });

  it('short-circuits on first err', () => {
    const error = new ValidationError('bad input');
    const result = flatMap(err(error), (x: number) => ok(x * 3));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe(error);
    }
  });

  it('returns err from chained function', () => {
    const error = new NotFoundError('not found');
    const result = flatMap(ok(42), () => err(error));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe(error);
    }
  });
});
