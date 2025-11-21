# Themes (ThemeSpec)

This folder contains data-driven themes for the new style-only architecture.

## ThemeSpec (TS/JSON)

A ThemeSpec is a flat CSS variables map:

```ts
export type ThemeSpec = {
  vars: Record<string, string>;
};
```

Example (telegram-dark.ts):

```ts
import type { ThemeSpec } from '../../shared/theme/types';

const spec: ThemeSpec = {
  vars: {
    '--tc-input-radius': '1.5rem',
    '--tc-surface-shadow': '0 10px 15px rgba(0,0,0,0.10)',
    '--tc-icon-button-size': '3rem',
  },
};

export default spec;
```

## How it is applied

- The app mounts a `ThemeProvider` (client/shared/theme/ThemeProvider.tsx) which reads the current colorScheme string (e.g. `dark+telegram`).
- It selects the matching ThemeSpec and writes `spec.vars` onto the `#tailchat-app` element as CSS variables.
- Components read only CSS variables (Design Tokens) for style.

## Authoring guidance

- Do NOT modify logic/JSX in themes.
- Only provide CSS variables (Design Tokens). Avoid hard-coded app-specific selectors.
- Provide both light and dark variants when applicable.
- If you need a new visual dimension, propose a new token first, then set its value here.
