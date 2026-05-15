export const LEGACY_DEFAULT_UI_FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const PREVIOUS_DEFAULT_UI_FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", Roboto, "Helvetica Neue", Arial, sans-serif';

export const LEGACY_DEFAULT_CODE_FONT_FAMILY =
  'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const PREVIOUS_DEFAULT_CODE_FONT_FAMILY =
  'ui-monospace, "Cascadia Mono", "Segoe UI Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Source Han Mono SC", Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", "Liberation Mono", "Courier New", monospace';

export const DEFAULT_FONT_FAMILY =
  "微软雅黑, 'YaHei Consolas Hybird', Consolas, 'Courier New', monospace";

export const DEFAULT_UI_FONT_FAMILY = DEFAULT_FONT_FAMILY;

export const DEFAULT_CODE_FONT_FAMILY = DEFAULT_FONT_FAMILY;

export const LEGACY_UI_FONT_FAMILIES = [
  LEGACY_DEFAULT_UI_FONT_FAMILY,
  PREVIOUS_DEFAULT_UI_FONT_FAMILY,
] as const;

export const LEGACY_CODE_FONT_FAMILIES = [
  LEGACY_DEFAULT_CODE_FONT_FAMILY,
  PREVIOUS_DEFAULT_CODE_FONT_FAMILY,
] as const;

export const CODE_FONT_SIZE_DEFAULT = 14;
export const CODE_FONT_SIZE_MIN = 8;
export const CODE_FONT_SIZE_MAX = 24;

export const UI_FONT_SIZE_DEFAULT = 14;
export const UI_FONT_SIZE_MIN = 8;
export const UI_FONT_SIZE_MAX = 24;

export function normalizeFontFamily(
  value: string | null | undefined,
  fallback: string,
) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function migrateLegacyFontFamily(
  value: string,
  legacyDefault: string | readonly string[],
  nextDefault: string,
) {
  const legacyDefaults = Array.isArray(legacyDefault) ? legacyDefault : [legacyDefault];
  return legacyDefaults.some((defaultValue) => value.trim() === defaultValue)
    ? nextDefault
    : value;
}

export function clampCodeFontSize(value: number) {
  if (!Number.isFinite(value)) {
    return CODE_FONT_SIZE_DEFAULT;
  }
  return Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, value));
}

export function clampUiFontSize(value: number) {
  if (!Number.isFinite(value)) {
    return UI_FONT_SIZE_DEFAULT;
  }
  return Math.min(UI_FONT_SIZE_MAX, Math.max(UI_FONT_SIZE_MIN, value));
}
