import appInfoJson from './app-info.json';

/**
 * Single source of truth for the product's working identity.
 *
 * The actual values live in `app-info.json` (plain JSON, not `.ts`) because
 * `app.config.ts` is loaded by a Node process that only plainly `require()`s
 * its own imports — it cannot resolve sibling `.ts` files, but it can
 * `require()` JSON natively. This file re-exports the same JSON with a
 * frozen, typed shape for application code to import.
 *
 * The product is currently called "FamilyFlow" but the name is not final.
 * Renaming the product means editing `app-info.json` only.
 */
export const APP_INFO = Object.freeze(appInfoJson) as Readonly<{
  productName: string;
  slug: string;
  scheme: string;
  bundleIdentifier: string;
  tagline: string;
}>;
