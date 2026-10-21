import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { Editor } from "./components/Editor";
import { VoicePicker } from "./components/VoicePicker";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { GenerateButton } from "./components/GenerateButton";
import { Player } from "./components/Player";
import { Toast } from "./components/Toast";
import type { ToastData } from "./components/Toast";
import { BarsIcon } from "./components/icons";
import { api } from "./api";
import { ApiError, FALLBACK_SPEED_SPEC } from "./types";
import type {
  Meta,
  Quota,
  SettingsState,
  TtsRequest,
  Voice,
  VoiceSettingsSpec,
} from "./types";

const FALLBACK_DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // the getting-started snippet's voice
const FALLBACK_MODEL = "eleven_multilingual_v2";
const FALLBACK_FORMAT = "mp3_44100_128";

/** Pre-meta placeholder; replaced by the server's declared defaults on load. */
const PLACEHOLDER_SETTINGS: SettingsState = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
  speed: 1,
};

export function settingsFromMeta(vs: VoiceSettingsSpec): SettingsState {
  return {
    stability: vs.stability.default,
    similarityBoost: vs.similarityBoost.default,
    style: vs.style.default,
    useSpeakerBoost: vs.useSpeakerBoost.default,
    speed: (vs.speed ?? FALLBACK_SPEED_SPEC).default,
  };
}

/** Persistent "out of credits" notice: quota numbers, reset date, and actions. */
function QuotaBanner({
  message,
  quota,
  onDismiss,
}: {
  message: string;
  quota: Quota | null;
  onDismiss: () => void;
}) {
  const reset = quota?.nextResetUnix
    ? new Date(quota.nextResetUnix * 1000).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;
  return (
    <div
      role="alert"
      className="mb-6 flex flex-col gap-3 rounded-2xl border border-red-500/30 bg-red-500/8 px-5 py-4 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="font-medium text-red-100">Quota exhausted</p>
        <p className="mt-0.5 text-red-200/85">{message}</p>
        {quota && (
          <p className="mt-0.5 text-xs text-zinc-500">
            {quota.characterCount.toLocaleString("en-US")} / {quota.characterLimit.toLocaleString("en-US")} characters
            used{reset ? ` — resets ${reset}` : ""}.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href="https://elevenlabs.io/app/settings/subscription"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-100 transition-colors hover:bg-red-500/25"
        >
          Manage plan ↗
        </a>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default function App() {
  // ---- server-provided config ----
  const [meta, setMeta] = useState<Meta | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  // ---- voices ----
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voicesWarning, setVoicesWarning] = useState<string | null>(null);

  // ---- quota ----
  const [quota, setQuota] = useState<Quota | null>(null);
  const [quotaWarning, setQuotaWarning] = useState<string | null>(null);

  // ---- form state ----
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [modelId, setModelId] = useState(FALLBACK_MODEL);
  const [outputFormat, setOutputFormat] = useState(FALLBACK_FORMAT);
  const [settings, setSettings] = useState<SettingsState>(PLACEHOLDER_SETTINGS);

  // ---- generation ----
  const [busy, setBusy] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [takeBytes, setTakeBytes] = useState(0);
  const [lastTake, setLastTake] = useState<{ voiceName: string; modelName: string } | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  // Quota failures get a persistent banner (with actions) instead of the short toast.
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  // Guards the one-time model default so a later meta refresh can't stomp a
  // model the user picked by hand.
  const metaApplied = useRef(false);

  const maxChars = meta?.maxTextChars ?? 5000;

  // ---- boot ----
  useEffect(() => {
    document.title = "Voice Studio — ElevenLabs TTS";
    api
      .meta()
      .then((meta) => {
        setMeta(meta);
        setText((current) => current || meta.defaultText);
        if (!metaApplied.current) {
          metaApplied.current = true;
          // The server's VOICE_SETTINGS are the single source of truth for the
          // slider defaults, so seed the panel from them instead of duplicating.
          setSettings(settingsFromMeta(meta.voiceSettings));
          // Only the first load may pick the model; a later refresh must not
          // stomp a model the user chose by hand.
          setModelId(Object.keys(meta.models)[0] ?? FALLBACK_MODEL);
        }
      })
      .catch((err) => setFatal(err.message));
  }, []);

  useEffect(() => {
    api
      .voices()
      .then(({ voices, warning }) => {
        setVoices(voices);
        if (warning) setVoicesWarning(warning);
      })
      .catch((err) =>
        setVoicesWarning(err instanceof Error ? err.message : "Voice list unavailable."),
      );
  }, []);

  const refreshQuota = useCallback(() => {
    api
      .quota()
      .then(({ quota, error }) => {
        setQuota(quota);
        // e.g. key without user_read permission — degrade to a quiet "n/a" pill.
        setQuotaWarning(quota ? null : (error ?? "Quota unavailable."));
      })
      .catch((err) => {
        setQuota(null);
        // e.g. 401 from a key without the user_read permission — without this
        // the top bar would sit on its loading skeleton forever.
        setQuotaWarning(err instanceof Error ? err.message : "Quota unavailable.");
      });
  }, []);

  useEffect(() => refreshQuota(), [refreshQuota]);

  // Pick a sensible default voice once both meta and the list have loaded.
  useEffect(() => {
    if (voiceId || !voices?.length) return;
    const preferred = meta?.defaultVoiceId ?? FALLBACK_DEFAULT_VOICE;
    setVoiceId(voices.some((v) => v.id === preferred) ? preferred : voices[0].id);
  }, [voices, meta, voiceId]);

  // ---- generation ----
  const generate = useCallback(async () => {
    if (busy) return;
    if (!text.trim()) return setToast({ message: "Type some text first." });
    if (!voiceId) return setToast({ message: "Pick a voice first." });
    if (!meta) return setToast({ message: fatal ?? "Server is not ready yet." });

    setBusy(true);
    try {
      const body: TtsRequest = {
        text,
        voiceId,
        modelId,
        outputFormat,
        voiceSettings: {
          stability: settings.stability,
          similarityBoost: settings.similarityBoost,
          style: settings.style,
          useSpeakerBoost: settings.useSpeakerBoost,
          ...(meta.models[modelId]?.supportsSpeed ? { speed: settings.speed } : {}),
        },
      };

      const blob = await api.tts(body);

      const voiceName = voices?.find((v) => v.id === voiceId)?.name ?? voiceId;
      const modelName = meta.models[modelId]?.name ?? modelId;

      setAudioBlob(blob);
      setTakeBytes(blob.size);
      setLastTake({ voiceName, modelName });
      setToast(null);
      setQuotaError(null);
      setTimeout(
        () => playerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        60,
      );
      refreshQuota();
    } catch (err) {
      const isQuota = err instanceof ApiError && (err.kind === "quota" || err.status === 402);
      if (isQuota) {
        // Persistent, actionable banner; also refresh the pill in the top bar.
        setQuotaError(err.message);
        setToast(null);
        refreshQuota();
      } else {
        setToast({
          message: err instanceof Error ? err.message : "Generation failed.",
        });
      }
    } finally {
      setBusy(false);
    }
  }, [busy, text, voiceId, meta, modelId, outputFormat, settings, voices, fatal, refreshQuota]);

  // ⌘/Ctrl + Enter generates from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void generate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [generate]);

  // The object URL is owned by this effect: it is created when a new take
  // arrives and revoked when that take is replaced or the player goes away.
  useEffect(() => {
    if (!audioBlob) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioBlob]);

  const selectedVoiceName = voices?.find((v) => v.id === voiceId)?.name ?? (voiceId || "—");
  const speedSupported = meta?.models[modelId]?.supportsSpeed ?? false;
  const voicesAvailable = voices !== null && voices.length > 0;

  return (
    <div className="relative min-h-dvh">
      <div className="page-glow" aria-hidden="true" />

      <TopBar quota={quota} quotaWarning={quotaWarning} />

      <main className="mx-auto max-w-4xl px-6 pt-14 pb-24">
        {/* Hero */}
        <div className="animate-rise mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-ink-800/80 px-3 py-1.5 text-xs text-zinc-400">
            <span className="h-1.5 w-1.5 animate-glow-pulse rounded-full bg-accent-500" />
            ElevenLabs textToSpeech.convert · eleven_multilingual_v2 · mp3_44100_128
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            The first move is what sets{" "}
            <span className="text-gradient bg-[linear-gradient(90deg,var(--color-accent-400),var(--color-magenta-500))] bg-clip-text text-transparent">
              everything in motion.
            </span>
          </h1>
          <p className="text-pretty mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-400">
            Studio-grade speech from plain text — audition voices with real samples, tune the delivery,
            and generate broadcast-ready audio straight from your ElevenLabs account.
          </p>
        </div>

        {quotaError && <QuotaBanner message={quotaError} quota={quota} onDismiss={() => setQuotaError(null)} />}
        {fatal && (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/8 px-5 py-4 text-sm text-red-200">
            {fatal}
          </div>
        )}
        {!fatal && voicesWarning && (
          <div className="mb-6 rounded-2xl border border-amber-500/25 bg-amber-500/6 px-5 py-3.5 text-sm text-amber-200/90">
            {voicesWarning}
          </div>
        )}

        <div className="space-y-4">
          <Editor
            meta={meta}
            text={text}
            onText={setText}
            modelId={modelId}
            onModelId={setModelId}
            outputFormat={outputFormat}
            onOutputFormat={setOutputFormat}
            maxChars={maxChars}
          />

          <VoicePicker voices={voices} voiceId={voiceId} onVoiceId={setVoiceId} />

          <AdvancedSettings
            meta={meta}
            settings={settings}
            onChange={setSettings}
            speedSupported={speedSupported}
          />

          <GenerateButton
            busy={busy}
            chars={text.length}
            maxChars={maxChars}
            hasVoice={voicesAvailable && voiceId !== ""}
            onClick={() => void generate()}
          />

          {audioUrl && (
            <div ref={playerRef}>
              <Player
                url={audioUrl}
                metaLine={
                  lastTake
                    ? `${lastTake.voiceName} · ${lastTake.modelName}`
                    : selectedVoiceName
                }
                bytes={takeBytes}
                onClose={() => {
                  // The effect owns the URL: dropping the blob makes it revoke
                  // the object URL. Clearing the URL too unmounts the player in
                  // the same commit, so the <audio> never points at a dead URL.
                  setAudioBlob(null);
                  setAudioUrl(null);
                  setLastTake(null);
                }}
              />
            </div>
          )}
        </div>

        <footer className="mt-14 flex flex-col items-center gap-2 border-t border-white/6 pt-8 text-center text-xs text-zinc-600">
          <div className="flex items-center gap-2">
            <BarsIcon className="h-3 w-3 text-accent-500" />
            Voice Studio — built on the official ElevenLabs JS SDK
          </div>
          <div>
            Every generation counts against your account's character quota. Perfect for demos,
            prototypes, and the drive home.
          </div>
        </footer>
      </main>

      {toast && <Toast data={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
