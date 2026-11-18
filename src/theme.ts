import { createTheme } from "@mantine/core";

// Keep this to non-CSS-variable settings: theme CSS variables are not
// injected at runtime (strict CSP forbids inline <style>), so colors, fonts
// and radii come from @mantine/core/styles.css defaults plus src/app.css.
export const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  cursorType: "pointer",
  components: {
    // react-remove-scroll injects a <style> element; CSP blocks it.
    Modal: { defaultProps: { lockScroll: false } },
    Drawer: { defaultProps: { lockScroll: false } },
  },
});
