import { BarsIcon } from "./icons";
import type { Quota } from "../types";

const nf = new Intl.NumberFormat("en-US");

function QuotaPill({ quota }: { quota: Quota }) {
  const pct =
    quota.characterLimit > 0
      ? Math.min(100, (quota.characterCount / quota.characterLimit) * 100)
      : 0;
  const reset = quota.nextResetUnix
    ? new Date(quota.nextResetUnix * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div
      className="group relative flex items-center gap-2.5 rounded-full border border-white/10 bg-ink-800/80 py-1.5 pl-3 pr-4"
      title={reset ? `Resets ${reset}` : undefined}
    >
      <span className="rounded-md bg-white/8 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-accent-400">
        {quota.tier}
      </span>
      <span className="font-mono text-xs text-zinc-300">
        {nf.format(quota.characterCount)}
        <span className="text-zinc-600"> / {nf.format(quota.characterLimit)}</span>
      </span>
      <div className="h-1 w-14 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-500 to-magenta-500 transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function TopBar({ quota, quotaWarning }: { quota: Quota | null; quotaWarning: string | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/6 bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-magenta-500 shadow-lg shadow-accent-500/25">
            <BarsIcon className="h-4 w-4 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Voice Studio</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              powered by ElevenLabs
            </div>
          </div>
        </div>

        {quota ? (
          <QuotaPill quota={quota} />
        ) : quotaWarning ? (
          <div
            className="rounded-full border border-white/10 bg-ink-800/80 px-3 py-1.5 text-xs text-zinc-500"
            title={quotaWarning}
          >
            quota n/a
          </div>
        ) : (
          <div className="h-8 w-44 animate-pulse rounded-full bg-white/5" />
        )}
      </div>
    </header>
  );
}
