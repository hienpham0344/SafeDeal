import { AppProviders } from "./AppProviders";
import { AppRouter } from "./AppRouter";
import { ErrorBoundary } from "./ErrorBoundary";
import { ToastProvider } from "@/components/ui/ToastProvider";

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </ToastProvider>
    </ErrorBoundary>
  );
}
