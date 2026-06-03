import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from '@/components/ui/sonner'

// Providers globaux : react-query (cache des données) + toasts sonner.
export function AppProviders({ children }: { children: ReactNode }) {
  // QueryClient instancié une seule fois (état local stable).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000, // 15 s avant de considérer la donnée périmée
            // Rafraîchit au retour sur l'onglet → reflète les actions faites ailleurs
            // (ex. artisan qui signe son contrat depuis son téléphone).
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-center" />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
