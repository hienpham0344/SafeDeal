import { AppProviders } from "./AppProviders";
import { AppRouter } from "./AppRouter";
import { ErrorBoundary } from "./ErrorBoundary";

export function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </ErrorBoundary>
  );
}
