import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "@/app/auth";
import { router } from "@/router";
import { theme } from "@/theme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    // No runtime <style> injection: CSS variables and global classes are
    // static (styles.css + app.css) so the CSP can stay style-src 'self'.
    <MantineProvider theme={theme} defaultColorScheme="auto" withCssVariables={false} withGlobalClasses={false}>
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <ModalsProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
}
