import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Theme CSS variables are not injected at runtime (strict CSP forbids inline
// <style>): every value here that maps to a CSS variable (brand shades,
// fonts, radii, the dark palette) is mirrored statically in src/app.css.
// Change both together.
const brand: MantineColorsTuple = ["#eef0ff", "#e0e3fd", "#c4c8f8", "#a4aaf2", "#858ceb", "#6d75e3", "#5a62d6", "#4b51bd", "#3e43a0", "#313580"];
const dark: MantineColorsTuple = ["#d5d7de", "#b4b7c1", "#8b8f9b", "#6a6e7a", "#3a3d45", "#2f3138", "#24262c", "#1a1b1f", "#151619", "#0f1012"];

const sans =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: 6,
  colors: { brand, dark },
  fontFamily: sans,
  fontFamilyMonospace: 'ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
  headings: { fontFamily: sans, fontWeight: "650" },
  defaultRadius: "md",
  radius: { md: "0.5rem", lg: "0.75rem", xl: "1.25rem" },
  cursorType: "pointer",
  components: {
    // react-remove-scroll injects a <style> element; CSP blocks it.
    Modal: { defaultProps: { lockScroll: false } },
    Drawer: { defaultProps: { lockScroll: false } },
  },
});
