import { useEffect, useRef } from "react";
import { BarsIcon, CloseIcon } from "./icons";

interface PlayerProps {
  url: string;
  metaLine: string;
  bytes: number;
  onClose: () => void;
}

/**
 * AudioContext is attached at most once per <audio> element (a media element
 * can only ever have a single MediaElementAudioSourceNode). Keeping records in
 * a WeakMap also survives React StrictMode's double effect invocation.
 */
const sources = new WeakMap<HTMLMediaElement, { ctx: AudioContext; analyser: AnalyserNode }>();

function attach(audio: HTMLAudioElement) {
  let record = sources.get(audio);
  if (!record) {
    const ctx = new AudioContext();
    const node = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;
    node.connect(analyser);
    analyser.connect(ctx.destination);
    record = { ctx, analyser };
    sources.set(audio, record);
  }
  return record;
}

function Visualizer({ audioRef }: { audioRef: React.RefObject<HTMLAudioElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;

    const { ctx, analyser } = attach(audio);
    void ctx.resume().catch(() => {});

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const BAR_COUNT = 56;
    const data = new Uint8Array(analyser.frequencyBinCount);
    // Calm pseudo-waveform for the idle state.
    const idle = Array.from({ length: BAR_COUNT }, (_, i) => 0.32 + 0.55 * Math.abs(Math.sin(i * 1.16)));

    let gradient: CanvasGradient | null = null;
    const gradientFor = (g: CanvasRenderingContext2D, height: number) => {
      if (!gradient) {
        gradient = g.createLinearGradient(0, 0, canvas.width, 0);
        gradient.addColorStop(0, "#ff5d33");
        gradient.addColorStop(1, "#ff3d81");
      }
      return gradient;
    };

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const g = canvas.getContext("2d");
      if (!g) return;
      const { width, height } = canvas;
      g.clearRect(0, 0, width, height);

      const playing = !audio.paused;
      if (playing) ctx.resume().catch(() => {});
      analyser.getByteFrequencyData(data);

      if (!gradient) gradient = gradientFor(g, height);
      g.globalAlpha = playing ? 0.95 : 0.28;

      const slot = width / BAR_COUNT;
      const barWidth = slot * 0.62;
      for (let i = 0; i < BAR_COUNT; i++) {
        const amplitude = playing
          ? 0.06 + 0.94 * (data[Math.floor(Math.pow(i / BAR_COUNT, 1.6) * 150) + 2] / 255)
          : idle[i] * 0.5;
        const h = Math.max(2 * dpr, amplitude * height * 0.92);
        const x = i * slot + (slot - barWidth) / 2;
        const y = (height - h) / 2;
        g.fillStyle = gradient;
        g.beginPath();
        g.roundRect(x, y, barWidth, h, barWidth / 2);
        g.fill();
      }
      g.globalAlpha = 1;
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [audioRef]);

  return <canvas ref={canvasRef} className="block h-20 w-full" aria-hidden="true" />;
}

const kbFormat = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function Player({ url, metaLine, bytes, onClose }: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  return (
    <section className="glass animate-rise rounded-2xl p-5" aria-label="Latest generation">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent-500 to-magenta-500">
            <BarsIcon className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white">Latest take</div>
            <div className="truncate text-[11px] text-zinc-500">
              {metaLine} · {kbFormat(bytes)} · streaming live analyser
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss player"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-500 transition-colors hover:border-white/25 hover:text-white"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <Visualizer audioRef={audioRef} />

      <audio
        ref={audioRef}
        src={url}
        controls
        autoPlay
        onPlay={() => audioRef.current && sources.get(audioRef.current)?.ctx.resume().catch(() => {})}
        className="mt-1 w-full [color-scheme:dark]"
      />
    </section>
  );
}
