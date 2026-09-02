/**
 * Raw design tokens. This is the only file that should contain literal
 * color/spacing/typography values — every screen and component consumes
 * them through `useAppTheme()` (see ThemeProvider.tsx), never by importing
 * this file directly, so a future rebrand or dark-mode tweak touches one
 * place.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;

export const typography = {
  fontFamily: undefined, // defer to Paper/RN system default until a brand font is chosen
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 30,
  },
  lineHeights: {
    xs: 16,
    sm: 20,
    md: 24,
    lg: 28,
    xl: 32,
    xxl: 38,
  },
} as const;

/**
 * Brand and semantic colors, calm and low-saturation by design (per the
 * product brief: "clarity ... over decorative complexity"). Priority and
 * category colors are semantic tokens, not literals, so task/event UI
 * never hardcodes a hex value.
 */
const palette = {
  blue600: '#3B5BDB',
  blue500: '#4F6BFE',
  blue100: '#E3E8FF',
  slate900: '#111318',
  slate700: '#33363F',
  slate500: '#6B7280',
  slate300: '#D1D5DB',
  slate100: '#F3F4F6',
  slate50: '#FAFAFB',
  white: '#FFFFFF',
  green600: '#2F9E63',
  amber600: '#C77A1F',
  red600: '#D64545',
} as const;

export const semanticColors = {
  light: {
    primary: palette.blue600,
    onPrimary: palette.white,
    primaryContainer: palette.blue100,
    background: palette.slate50,
    surface: palette.white,
    surfaceVariant: palette.slate100,
    onSurface: palette.slate900,
    onSurfaceVariant: palette.slate500,
    outline: palette.slate300,
    success: palette.green600,
    warning: palette.amber600,
    danger: palette.red600,
    busyBlock: palette.slate300,
  },
  dark: {
    primary: palette.blue500,
    onPrimary: palette.slate900,
    primaryContainer: palette.blue600,
    background: palette.slate900,
    surface: palette.slate700,
    surfaceVariant: '#3D414B',
    onSurface: palette.slate50,
    onSurfaceVariant: palette.slate300,
    outline: '#4B4F59',
    success: '#4CC98A',
    warning: '#E0A24A',
    danger: '#E36868',
    busyBlock: '#4B4F59',
  },
} as const;

/** Priority tokens are shared across both themes — these are accents, not surfaces. */
export const priorityColors = {
  normal: palette.slate500,
  important: palette.amber600,
  critical: palette.red600,
} as const;

/** Default category tokens (docs/DATA_MODEL.md — categories are user-extensible). */
export const categoryColors = {
  work: palette.blue600,
  family: '#8452D6',
  home: palette.green600,
  shopping: '#D6608F',
  health: '#1FA7A0',
  other: palette.slate500,
} as const;
