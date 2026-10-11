import assert from "node:assert/strict";

export function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      assert.equal(actual, expected);
    },
    toEqual(expected: unknown) {
      assert.deepEqual(actual, expected);
    },
    toContain(expected: string) {
      assert.ok(
        String(actual).includes(expected),
        `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`,
      );
    },
    toHaveLength(n: number) {
      assert.equal((actual as { length: number }).length, n);
    },
    toBeCloseTo(expected: number, digits = 5) {
      const eps = 10 ** -digits;
      assert.ok(Math.abs(Number(actual) - expected) <= eps);
    },
    toBeGreaterThan(n: number) {
      assert.ok(Number(actual) > n);
    },
    rejects: {
      async toThrow() {
        await assert.rejects(actual as Promise<unknown>);
      },
    },
    not: {
      toContain(expected: string) {
        assert.ok(
          !String(actual).includes(expected),
          `expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(expected)}`,
        );
      },
      toBe(expected: unknown) {
        assert.notEqual(actual, expected);
      },
    },
  };
}
