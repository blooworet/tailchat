import { isValidStr } from './string-helper';

/**
 * 解析配色方案，优先dark模式
 */
export function parseColorScheme(colorScheme: string): {
  isDarkMode: boolean;
  extraSchemeName: string | null;
} {
  if (colorScheme === 'dark') {
    return { isDarkMode: true, extraSchemeName: null };
  }

  if (colorScheme === 'light') {
    return { isDarkMode: false, extraSchemeName: null };
  }

  if (colorScheme === 'auto') {
    const isDark = window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true;
    return { isDarkMode: isDark, extraSchemeName: null };
  }

  // fallback for any unknown value
  return { isDarkMode: true, extraSchemeName: null };
}
