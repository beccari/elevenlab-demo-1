import { useEffect, useMemo, useState } from "react";
import { PauseIcon, PlayIcon, SearchIcon } from "./icons";
import type { Voice } from "../types";

interface VoicePickerProps {
  voices: Voice[] | null;
  voiceId: string;
  onVoiceId: (id: string) => void;
}

/** Deterministic gradient per voice id. */
function avatarGradient(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 60% 38%), hsl(${(h + 42) % 360} 72% 52%))`;
}

function initials(name: string): string {
  const parts = name.split(/[\s–—-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "V";
}

/** Chips for a couple of the most useful labels. */
function labelChips(labels: Record<string, string>): string[] {
  return ["gender", "age", "accent", "language"]
    .filter((key) => labels[key])
    .map((key) => labels[key]);
}

let previewAudio: HTMLAudioElement | null = null;

export function VoicePicker({ voices, voiceId, onVoiceId }: VoicePickerProps) {
  const [query, setQuery] = useState("");
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return voices;
    return voices?.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.category ?? "").toLowerCase().includes(q) ||
        Object.values(v.labels).some((l) => l.toLowerCase().includes(q)),
    );
  }, [voices, query]);

  // Stop preview audio when the component goes away.
  useEffect(() => {
    return () => {
      previewAudio?.pause();
      previewAudio = null;
    };
  }, []);

  const togglePreview = (voice: Voice) => {
    if (!voice.previewUrl) return;

    if (previewAudio && previewingId === voice.id) {
      previewAudio.pause();
      previewAudio.currentTime = 0;
      previewAudio = null;
      setPreviewingId(null);
      return;
    }

    previewAudio?.pause();
    const audio = new Audio(voice.previewUrl);
    audio.volume = 0.9;
    audio.onended = () => {
      if (previewAudio === audio) {
        previewAudio = null;
        setPreviewingId(null);
      }
    };
    previewAudio = audio;
    void audio.play().catch(() => setPreviewingId(null));
    setPreviewingId(voice.id);
  };

  const select = (voice: Voice) => {
    // Selecting a voice also stops any preview so the audition is clearly "theirs".
    if (previewAudio && previewingId !== voice.id) {
      previewAudio.pause();
      previewAudio = null;
      setPreviewingId(null);
    }
    onVoiceId(voice.id);
  };

  return (
    <section className="glass animate-rise rounded-2xl p-5" aria-label="Voice selection">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Voice</h2>
          {voices && (
            <span className="font-mono text-[11px] text-zinc-600">{voices.length} available</span>
          )}
        </div>
        <div className="relative w-56">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search voices…"
            aria-label="Search voices"
            className="w-full rounded-lg border border-white/10 bg-ink-900/80 py-2 pr-3 pl-9 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors focus:border-accent-500/60"
          />
        </div>
      </div>

      <div className="scroll-slim max-h-80 overflow-y-auto pr-1" role="listbox" aria-label="Voices">
        {!voices &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="mb-2 flex items-center gap-3 rounded-xl border border-white/5 p-3">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-white/8" />
              <div className="h-3.5 w-40 animate-pulse rounded bg-white/8" />
            </div>
          ))}

        {voices && filtered?.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-600">No voices match “{query}”.</p>
        )}

        {voices
          ? filtered?.map((voice) => {
              const selected = voice.id === voiceId;
              const chips = labelChips(voice.labels);
              const previewing = previewingId === voice.id;

              return (
                <div
                  key={voice.id}
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => select(voice)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      select(voice);
                    }
                  }}
                  className={`group mb-2 flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent-500/70 focus-visible:outline-none ${
                    selected
                      ? "border-accent-500/50 bg-gradient-to-r from-accent-500/10 to-magenta-500/8"
                      : "border-white/6 hover:border-white/12 hover:bg-white/3"
                  }`}
                >
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white/95 shadow-md"
                    style={{ background: avatarGradient(voice.id) }}
                  >
                    {initials(voice.name)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`truncate text-sm font-medium ${selected ? "text-white" : "text-zinc-200"}`}
                      >
                        {voice.name}
                      </span>
                      {voice.category && (
                        <span className="shrink-0 rounded border border-white/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                          {voice.category}
                        </span>
                      )}
                    </div>
                    {chips.length > 0 && (
                      <div className="truncate text-[11px] text-zinc-600">{chips.join(" · ")}</div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={!voice.previewUrl}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePreview(voice);
                    }}
                    aria-label={previewing ? `Stop preview of ${voice.name}` : `Preview ${voice.name}`}
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-all duration-150 ${
                      previewing
                        ? "border-transparent bg-gradient-to-br from-accent-500 to-magenta-500 text-white"
                        : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    }`}
                  >
                    {previewing ? (
                      <PauseIcon className="h-3.5 w-3.5" />
                    ) : (
                      <PlayIcon className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              );
            })
          : null}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-600">
        <PlayIcon className="h-3 w-3 text-accent-500" />
        auditions play the official voice sample — click a row to select it for generation
      </p>
    </section>
  );
}
