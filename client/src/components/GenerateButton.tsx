import { SparkIcon } from "./icons";

interface GenerateButtonProps {
  busy: boolean;
  chars: number;
  maxChars: number;
  hasVoice: boolean;
  onClick: () => void;
}

export function GenerateButton({ busy, chars, maxChars, hasVoice, onClick }: GenerateButtonProps) {
  const disabled = busy || chars === 0 || chars > maxChars || !hasVoice;

  return (
    <div className="animate-rise mt-1 flex items-center justify-center gap-4">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="btn-gradient flex items-center gap-2.5 rounded-xl px-8 py-3.5 text-[15px] font-semibold text-white"
      >
        {busy ? (
          <>
            <span className="spinner h-4 w-4" aria-hidden="true" />
            Generating…
          </>
        ) : (
          <>
            <SparkIcon className="h-4 w-4" />
            Generate audio
          </>
        )}
      </button>
      {!busy && (
        <span className="hidden text-xs text-zinc-600 sm:block">
          <kbd className="rounded border border-white/12 bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            ⌘
          </kbd>
          <span className="mx-1">+</span>
          <kbd className="rounded border border-white/12 bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            ⏎
          </kbd>
        </span>
      )}
    </div>
  );
}
