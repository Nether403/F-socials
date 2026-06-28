// Package-wide type augmentation for vitest-axe's `toHaveNoViolations` matcher.
//
// vitest-axe registers the matcher at runtime (`expect.extend(axeMatchers)`), but its
// shipped matcher types target an older Vitest Assertion namespace and don't surface on
// the typed `Assertion` under Vitest 4 — so a direct `expect(results).toHaveNoViolations()`
// fails typecheck. This ambient declaration reattaches the matcher to the Vitest 4
// `Assertion` / `AsymmetricMatchersContaining` interfaces so the runtime-registered
// matcher is type-visible everywhere in this package (no per-call cast needed).
import 'vitest';

interface AxeMatchers<R = unknown> {
  toHaveNoViolations(): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = unknown> extends AxeMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
