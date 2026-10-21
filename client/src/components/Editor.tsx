import type { Meta } from "../types";

interface EditorProps {
  meta: Meta | null;
  text: string;
  onText: (text: string) => void;
  modelId: string;
  onModelId: (id: string) => void;
  outputFormat: string;
  onOutputFormat: (format: string) => void;
  maxChars: number;
}

export function Editor({
  meta,
  text,
  onText,
  modelId,
  onModelId,
  outputFormat,
  onOutputFormat,
  maxChars,
}: EditorProps) {
  const chars = text.length;

  return (
    <section className="glass animate-rise rounded-2xl p-5" aria-label="Text editor">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <label htmlFor="tts-text" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Script
        </label>
        <span className={`font-mono text-xs ${chars > maxChars ? "text-red-400" : "text-zinc-500"}`}>
          {chars}
          <span className="text-zinc-600">/{maxChars}</span>
        </span>
      </div>

      <textarea
        id="tts-text"
        value={text}
        onChange={(e) => onText(e.target.value)}
        maxLength={maxChars}
        rows={5}
        disabled={!meta}
        placeholder={meta?.defaultText}
        className="w-full resize-y rounded-xl border border-white/10 bg-ink-900/80 px-4 py-3.5 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:border-accent-500/60 focus:bg-ink-900 disabled:opacity-50"
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Model</div>
          <div
            role="radiogroup"
            aria-label="Model"
            className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-ink-900/80 p-1.5"
          >
            {meta
              ? Object.entries(meta.models).map(([id, model]) => {
                  const selected = id === modelId;
                  return (
                    <button
                      key={id}
                      role="radio"
                      aria-checked={selected}
                      title={model.description}
                      onClick={() => onModelId(id)}
                      className={`rounded-lg px-2 py-2 text-center transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent-500/70 focus-visible:outline-none ${
                        selected
                          ? "bg-gradient-to-br from-accent-500/18 to-magenta-500/18 shadow-[inset_0_0_0_1px_rgb(255_93_51/0.45)]"
                          : "hover:bg-white/5"
                      }`}
                    >
                      <span
                        className={`block text-[13px] font-semibold ${
                          selected ? "text-white" : "text-zinc-400"
                        }`}
                      >
                        {model.name}
                      </span>
                      <span
                        className={`mt-0.5 block text-[10px] uppercase tracking-wide ${
                          selected ? "text-accent-400" : "text-zinc-600"
                        }`}
                      >
                        {model.speedBadge}
                      </span>
                    </button>
                  );
                })
              : Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="h-[46px] animate-pulse rounded-lg bg-white/5" />
                ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="tts-format"
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400"
          >
            Output
          </label>
          <select
            id="tts-format"
            value={outputFormat}
            onChange={(e) => onOutputFormat(e.target.value)}
            disabled={!meta}
            className="h-[46px] rounded-xl border border-white/10 bg-ink-900/80 px-3 text-sm text-zinc-200 outline-none transition-colors focus:border-accent-500/60 disabled:opacity-50"
          >
            {meta
              ? Object.entries(meta.outputFormats).map(([id, label]) => (
                  <option key={id} value={id} className="bg-ink-900">
                    {label}
                  </option>
                ))
              : null}
          </select>
        </div>
      </div>

      {meta?.models[modelId]?.supportsSpeed === false && (
        <p className="mt-3 text-xs text-zinc-600">
          <span className="text-amber-500/90">Multilingual v2</span> favours quality over latency —
          playback speed control is unavailable on this model.
        </p>
      )}
    </section>
  );
}
