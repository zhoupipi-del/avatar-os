import {
  VRMExpressionMorphTargetBind,
  type VRMExpression,
  type VRMExpressionManager,
} from "@pixiv/three-vrm";

type Weights = Readonly<Record<string, number>>;

function contributions(
  expression: VRMExpression,
  weight: number,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const bind of expression.binds) {
    if (!(bind instanceof VRMExpressionMorphTargetBind)) continue;
    for (const mesh of bind.primitives) {
      const key = `${mesh.uuid}:${bind.index}`;
      result.set(
        key,
        (result.get(key) ?? 0) + Math.max(0, bind.weight * weight),
      );
    }
  }
  return result;
}

/**
 * Preserve native VRM overrides. For expressions without overrides, reserve shared
 * morph targets for speech/blinking and fit emotions into the remaining budget.
 * Always use the controller's raw weights so attenuation cannot accumulate.
 */
export function coordinateFacialWeights(
  manager: VRMExpressionManager,
  raw: Weights,
): void {
  const active = manager.expressions.filter(
    (expression) => expression.outputWeight > 0,
  );
  const nativeMouth = active.some(
    (expression) => expression.overrideMouth !== "none",
  );
  const nativeBlink = active.some(
    (expression) => expression.overrideBlink !== "none",
  );
  const reserved = new Map<string, number>();
  const names = [
    ...(nativeMouth ? [] : manager.mouthExpressionNames),
    ...(nativeBlink ? [] : manager.blinkExpressionNames),
  ];
  for (const name of new Set(names)) {
    const expression = manager.getExpression(name);
    if (!expression) continue;
    for (const [key, value] of contributions(
      expression,
      expression.outputWeight,
    )) {
      reserved.set(key, (reserved.get(key) ?? 0) + value);
    }
  }

  const candidates = Object.entries(raw).flatMap(([name, weight]) => {
    const expression = manager.getExpression(name);
    if (
      !expression ||
      expression.overrideMouth !== "none" ||
      expression.overrideBlink !== "none"
    ) {
      return [];
    }
    return [
      {
        expression,
        weight,
        binds: contributions(
          expression,
          expression.isBinary ? (weight > 0.5 ? 1 : 0) : weight,
        ),
      },
    ];
  });
  const total = new Map<string, number>();
  for (const candidate of candidates) {
    for (const [key, value] of candidate.binds)
      total.set(key, (total.get(key) ?? 0) + value);
  }
  for (const { expression, weight, binds } of candidates) {
    let multiplier = 1;
    for (const [key, value] of binds) {
      if (value <= 0) continue;
      multiplier = Math.min(
        multiplier,
        Math.max(0, 1 - (reserved.get(key) ?? 0)) / total.get(key)!,
      );
    }
    // Binary expressions cannot represent a partial budget: crossing 0.5 would
    // restore their full morph weight and overrun speech/blink reservations.
    manager.setValue(
      expression.expressionName,
      expression.isBinary && multiplier < 1 ? 0 : weight * multiplier,
    );
  }
}
