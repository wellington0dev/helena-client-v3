export {};

declare global {
  interface Window {
    helena?: {
      request(
        path: string,
        options?: { method?: string; body?: unknown },
      ): Promise<{ status: number; ok: boolean; data: any }>;
      openExternal(url: string): Promise<void>;
      onEvent(callback: (event: unknown) => void): () => void;
    };
  }
}
