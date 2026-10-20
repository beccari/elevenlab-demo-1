import { useState } from "react";
import { ChevronIcon, ResetIcon } from "./icons";
import type { Meta, SettingsState } from "../types";

interface AdvancedSettingsProps {
  meta: Meta | null;
  settings: SettingsState;
  onChange: (settings: SettingsState) => void;
  /** Whether the selected model supports the `speed` parameter. */
  speedSupported: boolean;
}

interface SliderRowProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (value: number) => void;
}

function SliderRow({ label, hint, value, min, max, step, format, onChange }: SliderRowProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="rounded-xl border border-white/6 bg-ink-900/60 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-medium text-zinc-200">
          {label}
          <span className="ml-2 text-[11px] font-normal text-zinc-600">{hint}</span>
        </div>
        <span className="font-mono text-xs text-accent-400">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        className="slider mt-1"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
        aria-label={label}
      />
    </div>
  );
}

function SpeakerBoostToggle({ on, onToggle }: { on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="col-span-full flex items-center justify-between rounded-xl border border-white/6 bg-ink-900/60 px-4 py-3">
      <div className="text-[13px] font-medium text-zinc-200">
        Speaker boost
        <span className="ml-2 text-[11px] font-normal text-zinc-600">
          tighter voice match · +latency
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Speaker boost"
        onClick={() => onToggle(!on)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
          on ? "bg-gradient-to-r from-accent-500 to-magenta-500" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
            on ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}

export function AdvancedSettings({
  meta,
  settings,
  onChange,
  speedSupported,
}: AdvancedSettingsProps) {
  const [open, setOpen] = useState(false);
  const vs = meta?.voiceSettings;

  const patch = (key: keyof SettingsState, value: number | boolean) =>
    onChange({ ...settings, [key]: value });

  const reset = () => {
    if (!vs) return;
    onChange({
      stability: vs.stability.default,
      similarityBoost: vs.similarityBoost.default,
      style: vs.style.default,
      useSpeakerBoost: vs.useSpeakerBoost.default,
      speed: 1,
    });
  };

  return (
    <section className="glass animate-rise overflow-hidden rounded-2xl" aria-label="Voice settings">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center justify-between px-5 py-4 text-left transition-colors hover:bg-white/2"
        >
          <div className="flex items-center gap-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Delivery settings
            </h2>
            <span className="rounded-md bg-white/6 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
              optional · overrides the voice's stored settings
            </span>
          </div>
          <ChevronIcon
            className={`h-4 w-4 text-zinc-500 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <button
            type="button"
            onClick={reset}
            title="Reset to defaults"
            aria-label="Reset settings to defaults"
            className="my-3 mr-3 grid w-9 place-items-center self-center rounded-lg border border-white/10 text-zinc-500 transition-colors hover:border-white/25 hover:text-white"
          >
            <ResetIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div
        className="grid overflow-hidden transition-all duration-300 ease-out"
        style={open ? { gridTemplateRows: "1fr", opacity: 1 } : { gridTemplateRows: "0fr", opacity: 0 }}
        aria-hidden={!open}
      >
        <div className="min-h-0">
          <div className="grid gap-2.5 px-5 pb-3 sm:grid-cols-2">
            {vs && (
              <>
                <SliderRow
                  label="Stability"
                  hint="lower → more emotive"
                  value={settings.stability}
                  min={vs.stability.min}
                  max={vs.stability.max}
                  step={vs.stability.step}
                  onChange={(v) => patch("stability", v)}
                />
                <SliderRow
                  label="Similarity"
                  hint="adherence to the original"
                  value={settings.similarityBoost}
                  min={vs.similarityBoost.min}
                  max={vs.similarityBoost.max}
                  step={vs.similarityBoost.step}
                  onChange={(v) => patch("similarityBoost", v)}
                />
                <SliderRow
                  label="Style"
                  hint="style exaggeration"
                  value={settings.style}
                  min={vs.style.min}
                  max={vs.style.max}
                  step={vs.style.step}
                  onChange={(v) => patch("style", v)}
                />
                {speedSupported ? (
                  <SliderRow
                    label="Speed"
                    hint="1.00 = natural pace"
                    value={settings.speed}
                    min={0.7}
                    max={1.2}
                    step={0.05}
                    format={(v) => `${v.toFixed(2)}×`}
                    onChange={(v) => patch("speed", v)}
                  />
                ) : (
                  <div className="col-span-full flex items-center justify-between rounded-xl border border-white/6 bg-ink-900/60 px-4 py-3">
                    <div className="text-[13px] font-medium text-zinc-200">
                      Speed
                      <span className="ml-2 text-[11px] font-normal text-zinc-600">
                        not available on Multilingual v2
                      </span>
                    </div>
                    <span className="font-mono text-xs text-zinc-600">—</span>
                  </div>
                )}
                <SpeakerBoostToggle
                  on={settings.useSpeakerBoost}
                  onToggle={(v) => patch("useSpeakerBoost", v)}
                />
              </>
            )}
          </div>
          <div className="border-t border-white/6 px-5 py-2.5 text-[11px] text-zinc-600">
            Applied per request via <code className="font-mono text-zinc-500">voice_settings</code> —
            the voice's stored settings are never modified.
          </div>
        </div>
      </div>
    </section>
  );
}
