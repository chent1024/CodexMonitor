export const LEGACY_DEFAULT_UI_FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const DEFAULT_UI_FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", Roboto, "Helvetica Neue", Arial, sans-serif';

export const LEGACY_DEFAULT_CODE_FONT_FAMILY =
  'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const DEFAULT_CODE_FONT_FAMILY =
  'ui-monospace, "Cascadia Mono", "Segoe UI Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Source Han Mono SC", Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", "Liberation Mono", "Courier New", monospace';

export const CODE_FONT_SIZE_DEFAULT = 11;
export const CODE_FONT_SIZE_MIN = 9;
export const CODE_FONT_SIZE_MAX = 16;

export const UI_FONT_SIZE_DEFAULT = 13;
export const UI_FONT_SIZE_MIN = 11;
export const UI_FONT_SIZE_MAX = 16;

export function normalizeFontFamily(
  value: string | null | undefined,
  fallback: string,
) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function migrateLegacyFontFamily(
  value: string,
  legacyDefault: string,
  nextDefault: string,
) {
  return value.trim() === legacyDefault ? nextDefault : value;
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
