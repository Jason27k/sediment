"use client";

import { useCallback, useEffect, useState } from "react";

type Candidate = {
  id: string;
  title: string;
  body_md: string;
  kind: "concept" | "recipe";
  assumes: string | null;
  suggestion: "new" | "review" | "extend" | null;
  near_note_id: string | null;
  near_title: string | null;
  near_score: number | null;
};

/**
 * §06 step 4. Candidates sit here, not in the corpus.
 *
 * The suggestion is the dedupe verdict: "extend" means this duplicates an
 * existing note and should amend it rather than become note thirteen.
 */
export function CaptureTray({
  projectSlug,
  refreshKey,
}: {
  projectSlug: string;
  refreshKey: number;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/candidates?project=${projectSlug}`);
    if (!response.ok) return;
    const { candidates } = await response.json();
    setCandidates(candidates);
  }, [projectSlug]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function act(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    await fetch(`/api/candidates/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    await load();
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
