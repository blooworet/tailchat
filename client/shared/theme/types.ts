export type ThemeSpec = {
  // Flat vars map: CSS variable name -> value
  // Example: { "--tc-input-radius": "1.5rem", "--tc-surface-shadow": "0 10px 15px rgba(0,0,0,0.1)" }
  vars: Record<string, string>;
};
