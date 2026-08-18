/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_POSTHOG_HOST?: string;
  readonly PUBLIC_POSTHOG_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface GhTrackEvent {
  name: string;
  data: Record<string, unknown>;
  ts: number;
}

interface Window {
  __ghTrackQueue?: GhTrackEvent[];
  __ghPlaygroundDump?: () => string;
  posthog?: { capture: (name: string, data?: Record<string, unknown>) => void };
}
