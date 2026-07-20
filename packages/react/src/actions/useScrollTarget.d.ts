export interface ScrollTargetConfig {
    id: string;
    label: string;
}
export declare function useScrollTarget(cfg: ScrollTargetConfig): {
    ref: (el: Element | null) => void;
};
