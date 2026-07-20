import { type RouteDef } from './registry.js';
export declare function useRoute(routes: RouteDef[], opts: {
    navigate: (path: string) => void;
}): void;
