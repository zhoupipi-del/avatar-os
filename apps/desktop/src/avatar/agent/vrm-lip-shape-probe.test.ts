import { describe, expect, it, vi } from "vitest";
import {
  probeLipShapes,
  type VrmExpressionManagerLike,
} from "./vrm-lip-shape-probe";

function makeManager(names: string[]): VrmExpressionManagerLike {
  const expressionMap: Record<string, unknown> = {};
  for (const name of names) {
    expressionMap[name] = { name };
  }
  return {
    getExpression: (name: string) =>
      Object.prototype.hasOwnProperty.call(expressionMap, name)
        ? expressionMap[name]
        : null,
    expressionMap,
    expressions: names.map((name) => ({ name })),
  };
}

describe("probeLipShapes", () => {
  it("returns unavailable when there is no expressionManager", () => {
    const result = probeLipShapes(null);
    expect(result.available).toBe(false);
    expect(result.missing).toEqual(["a", "i", "u", "e", "o"]);
    expect(result.availableShapes).toEqual([]);
    expect(result.perVowel).toEqual({
      a: null,
      i: null,
      u: null,
      e: null,
      o: null,
    });
  });

  it("finds all five standard three-vrm mouth shapes", () => {
    const manager = makeManager(["aa", "ih", "ou", "ee", "oh"]);
    const result = probeLipShapes({ expressionManager: manager });
    expect(result.available).toBe(true);
    expect(result.perVowel).toEqual({
      a: "aa",
      i: "ih",
      u: "ou",
      e: "ee",
      o: "oh",
    });
    expect(result.availableShapes).toEqual(["aa", "ih", "ou", "ee", "oh"]);
    expect(result.missing).toEqual([]);
  });

  it("falls back to literal vowel names when standard names are absent", () => {
    const manager = makeManager(["a", "i", "u", "e", "o"]);
    const result = probeLipShapes({ expressionManager: manager });
    expect(result.available).toBe(true);
    expect(result.perVowel).toEqual({
      a: "a",
      i: "i",
      u: "u",
      e: "e",
      o: "o",
    });
  });

  it("reports partial coverage and missing vowels", () => {
    const manager = makeManager(["aa", "ih"]); // only a + i
    const result = probeLipShapes({ expressionManager: manager });
    expect(result.available).toBe(true);
    expect(result.perVowel.a).toBe("aa");
    expect(result.perVowel.i).toBe("ih");
    expect(result.perVowel.u).toBeNull();
    expect(result.perVowel.e).toBeNull();
    expect(result.perVowel.o).toBeNull();
    expect(result.missing).toEqual(["u", "e", "o"]);
  });

  it("falls back to expressionMap when getExpression returns null", () => {
    const manager: VrmExpressionManagerLike = {
      getExpression: () => null,
      expressionMap: { oh: { name: "oh" } },
      expressions: [],
    };
    const result = probeLipShapes({ expressionManager: manager });
    expect(result.perVowel.o).toBe("oh");
  });

  it("falls back to expressions array when map is missing", () => {
    const manager: VrmExpressionManagerLike = {
      getExpression: () => null,
      expressions: [{ name: "ih" }],
    };
    const result = probeLipShapes({ expressionManager: manager });
    expect(result.perVowel.i).toBe("ih");
  });

  it("never writes expression values (no setValue called)", () => {
    const manager = makeManager([
      "aa",
      "ih",
      "ou",
      "ee",
      "oh",
    ]) as Record<string, unknown>;
    const setValue = vi.fn();
    manager.setValue = setValue;
    probeLipShapes({
      expressionManager: manager as unknown as VrmExpressionManagerLike,
    });
    expect(setValue).not.toHaveBeenCalled();
  });
});
