import { useEffect } from "react";
import { CloseIcon } from "./icons";

export interface ToastData {
  message: string;
  kind: "error" | "info";
}

export function Toast({ data, onDismiss }: { data: ToastData; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [data, onDismiss]);

  return (
    <div
      role={data.kind === "error" ? "alert" : "status"}
      className="toast-enter fixed bottom-6 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-xl"
      style={{
        background:
          data.kind === "error"
            ? "rgb(60 12 20 / 0.92)"
            : "rgb(20 22 29 / 0.92)",
        borderColor: data.kind === "error" ? "rgb(255 106 148 / 0.35)" : "rgb(255 255 255 / 0.09)",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full font-bold text-xs ${
            data.kind === "error" ? "bg-red-500/25 text-red-200" : "bg-accent-500/25 text-accent-400"
          }`}
        >
          {data.kind === "error" ? "!" : "i"}
        </span>
        <p className={`text-sm leading-snug ${data.kind === "error" ? "text-red-100" : "text-zinc-200"}`}>
          {data.message}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="mt-0.5 text-zinc-500 transition-colors hover:text-white"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
