"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TrayCandidate } from "@/lib/types";

/**
 * §06 step 4. Candidates sit here, not in the corpus.
 *
 * The list is server-rendered and refreshed with router.refresh() rather than
 * fetched on mount: the page that renders this tray has already queried the
 * database, so making the browser ask again is a round trip that buys nothing
 * and a second copy of the data that can disagree with the first.
 *
 * The suggestion is the dedupe verdict: "extend" means this duplicates an
 * existing note and should amend it rather than become note thirteen.
 */
export function CaptureTray({ candidates }: { candidates: TrayCandidate[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    await fetch(`/api/candidates/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    router.refresh();
  }

  return (
    <aside className="flex flex-col gap-3 lg:border-l lg:border-rule lg:pl-6">
      <h2 className="font-mono text-xs uppercase tracking-widest text-ink-faint">
        Capture tray {candidates.length > 0 && `· ${candidates.length}`}
      </h2>

      {candidates.length === 0 ? (
        <p className="text-xs text-ink-faint">
          Nothing proposed. Most turns should yield nothing — that is the extractor working,
          not failing.
        </p>
      ) : (
        candidates.map((candidate) => (
          <div key={candidate.id} className="flex flex-col gap-2 border border-rule bg-surface p-3">
            <div className="flex items-baseline gap-2">
              <span
                className={`font-mono text-[0.6rem] uppercase tracking-widest ${
                  candidate.kind === "concept" ? "text-accent" : "text-signal"
                }`}
              >
                {candidate.kind}
              </span>
              {candidate.near_score !== null && (
                <span className="font-mono text-[0.6rem] text-ink-faint">
                  {candidate.near_score.toFixed(2)} vs {candidate.near_title}
                </span>
              )}
            </div>

            <h3 className="text-sm font-medium leading-snug">{candidate.title}</h3>
            <p className="text-xs leading-relaxed text-ink-soft">{candidate.body_md}</p>

            {candidate.assumes && (
              <p className="font-mono text-[0.6rem] text-ink-faint">assumes {candidate.assumes}</p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {candidate.suggestion === "extend" && candidate.near_note_id ? (
                <button
                  onClick={() =>
                    act(candidate.id, {
                      action: "extend",
                      targetNoteId: candidate.near_note_id,
                    })
                  }
                  disabled={busyId === candidate.id}
                  className="border border-accent px-2 py-1 font-mono text-[0.65rem] text-accent disabled:opacity-40"
                >
                  extend existing
                </button>
              ) : null}
              <button
                onClick={() => act(candidate.id, { action: "accept" })}
                disabled={busyId === candidate.id}
                className="border border-accent px-2 py-1 font-mono text-[0.65rem] text-accent disabled:opacity-40"
              >
                keep as new
              </button>
              <button
                onClick={() => act(candidate.id, { action: "dismiss" })}
                disabled={busyId === candidate.id}
                className="border border-rule px-2 py-1 font-mono text-[0.65rem] text-ink-faint disabled:opacity-40"
              >
                dismiss
              </button>
            </div>
          </div>
        ))
      )}
    </aside>
  );
}
