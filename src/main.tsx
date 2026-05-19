import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import './index.css';
import { queryClient } from './lib/queryClient';
import { createAppRouter } from './router';
import { TooltipProvider } from './components/ui/Tooltip';
import { ThemeProvider, useTheme } from './lib/theme';
import { I18nProvider } from './lib/i18n';

const router = createAppRouter(queryClient);

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="bottom-right" richColors closeButton theme={theme} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={300}>
            <RouterProvider router={router} />
          </TooltipProvider>
          <ThemedToaster />
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
