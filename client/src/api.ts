import { ApiError } from "./types";
import type { Meta, Quota, TtsRequest, Voice } from "./types";

async function parseError(res: Response): Promise<ApiError> {
  let message = `Request failed (HTTP ${res.status}).`;
  let kind: string | null = null;
  try {
    const body = (await res.json()) as { error?: string; kind?: string };
    if (body?.error) message = body.error;
    if (body?.kind) kind = body.kind;
  } catch {
    // response was not JSON — keep the default message
  }
  return new ApiError(message, res.status, kind);
}

export const api = {
  meta: () =>
    fetch("/api/meta").then(async (res) => {
      if (!res.ok) throw await parseError(res);
      return (await res.json()) as Meta;
    }),

  voices: () =>
    fetch("/api/voices").then(async (res) => {
      if (!res.ok) throw await parseError(res);
      return (await res.json()) as { voices: Voice[]; warning?: string };
    }),

  quota: () =>
    fetch("/api/quota").then(async (res) => {
      if (!res.ok) throw await parseError(res);
      return (await res.json()) as { quota: Quota | null; error?: string };
    }),

  tts: async (body: TtsRequest): Promise<Blob> => {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await parseError(res);
    return res.blob();
  },
};
