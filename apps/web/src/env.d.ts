/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_UMAMI_SCRIPT_URL?: string;
  readonly PUBLIC_UMAMI_WEBSITE_ID?: string;
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
  umami?: { track: (name: string, data?: Record<string, unknown>) => void };
}
