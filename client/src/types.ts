export interface ModelInfo {
  name: string;
  description: string;
  speedBadge: string;
  /** multilingual_v2 rejects `speed` — flash & turbo v2.5 accept it. */
  supportsSpeed: boolean;
}

export interface SliderSpec {
  min: number;
  max: number;
  step: number;
  default: number;
}

/**
 * Used only when a server predates the `speed` entry in VOICE_SETTINGS, so an
 * older API can't break the settings panel. The server's spec always wins.
 */
export const FALLBACK_SPEED_SPEC: SliderSpec = { min: 0.7, max: 1.2, step: 0.05, default: 1 };

export interface VoiceSettingsSpec {
  stability: SliderSpec;
  similarityBoost: SliderSpec;
  style: SliderSpec;
  useSpeakerBoost: { default: boolean };
  speed: SliderSpec;
}

export interface Meta {
  models: Record<string, ModelInfo>;
  outputFormats: Record<string, string>;
  voiceSettings: VoiceSettingsSpec;
  defaultVoiceId: string;
  defaultText: string;
  maxTextChars: number;
}

export interface Voice {
  id: string;
  name: string;
  category: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
}

export interface Quota {
  tier: string;
  characterCount: number;
  characterLimit: number;
  nextResetUnix: number | null;
}

export interface VoiceSettingsValues {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  speed?: number;
}

export interface TtsRequest {
  text: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  voiceSettings?: VoiceSettingsValues;
}

export interface SettingsState {
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
}

export class ApiError extends Error {
  readonly status: number;
  /** Server-side classification: "quota" | "auth" | "rate_limit" | … */
  readonly kind: string | null;
  constructor(message: string, status: number, kind: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
  }
}
