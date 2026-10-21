import { useEffect } from "react";
import { CloseIcon } from "./icons";

export interface ToastData {
  message: string;
}

export function Toast({ data, onDismiss }: { data: ToastData; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [data, onDismiss]);

  return (
    <div
      role="alert"
      className="toast-enter fixed bottom-6 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-xl"
      style={{
        background: "rgb(60 12 20 / 0.92)",
        borderColor: "rgb(255 106 148 / 0.35)",
      }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-500/25 font-bold text-xs text-red-200">
          !
        </span>
        <p className="text-sm leading-snug text-red-100">{data.message}</p>
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
