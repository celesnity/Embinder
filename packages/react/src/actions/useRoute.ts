// Declares navigable pages and the app's navigate adapter (router-agnostic).
import { useEffect } from 'react';
import { setRoutes, clearRoutes, setNavigateAdapter, type RouteDef } from './registry.js';

export function useRoute(routes: RouteDef[], opts: { navigate: (path: string) => void }): void {
  const key = routes.map((r) => `${r.id}:${r.path}:${r.destructive ?? ''}`).join('|');
  useEffect(() => {
    setRoutes(routes);
    return () => clearRoutes(routes.map((r) => r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    setNavigateAdapter(opts.navigate);
    return () => setNavigateAdapter(undefined);
  }, [opts.navigate]);
}
