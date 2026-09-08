"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Opens a branch and goes to it (§07). The anchor decides everything else —
 * which project the branch lands in, and what context it is seeded with.
 */
export function BranchButton({
  noteId,
  messageId,
  label = "branch",
  className = "border border-rule px-2 py-0.5 font-mono text-[0.65rem] text-ink-faint hover:border-accent hover:text-accent disabled:opacity-40",
}: {
  noteId?: string;
  messageId?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);

    const response = await fetch("/api/branches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(noteId ? { noteId } : { messageId }),
    });

    if (!response.ok) {
      setError(await response.text());
      setBusy(false);
      return;
    }

    const { url } = (await response.json()) as { url: string };
    router.push(url);
  }

  return (
    <>
      <button onClick={open} disabled={busy} className={className}>
        {busy ? "opening…" : label}
      </button>
      {error && <span className="font-mono text-[0.65rem] text-signal">{error}</span>}
    </>
  );
}
