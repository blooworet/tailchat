import React, { useEffect } from 'react';
import { useColorScheme } from '../contexts/ColorSchemeContext';

export function ThemeProvider(props: any) {
  const { getThemeSpec, children } = props || {};
  const { colorScheme } = useColorScheme();

  useEffect(() => {
    try {
      if (!getThemeSpec) return;
      const spec = getThemeSpec(colorScheme);
      const root = (document.getElementById('tailchat-app') as HTMLElement) || document.body;
      if (!root) return;

      if (spec && spec.vars) {
        for (const [k, v] of Object.entries(spec.vars)) {
          root.style.setProperty(k, String(v));
        }
      }

      // no-op
    } catch {}
  }, [colorScheme, getThemeSpec]);

  return <>{children}</>;
}
