/**
 * Domain shape for a task category. `colorToken` is the immutable identity
 * used to look up both a design-token color (src/theme/tokens.ts's
 * `categoryColors`) and, for a system category, a localized label
 * (`common:category.<colorToken>`) — `name` is stored display text, never
 * the thing UI code branches or translates on. See docs/DATA_MODEL.md,
 * "categories," and docs/DECISIONS.md, "Phase 4."
 */
export interface Category {
  id: string;
  familyId: string | null;
  name: string;
  colorToken: string;
  isSystem: boolean;
}
