"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DiffRow } from "@/lib/diff";
import { DiffView } from "./diff-view";

type Proposal = { title: string; body_md: string; rationale: string };
type Proposed = {
  amendmentId: string;
  proposal: Proposal;
  diff: DiffRow[];
  changed: boolean;
  titleChanged: boolean;
};

/**
 * §07: the confusion resolves, and the resolution amends the note.
 *
 * The diff is shown before anything is written, and "no change" is a real
 * outcome rather than a failure — a branch that confirms the note was already
 * right is worth as much as one that fixes it, and pretending otherwise would
 * push edits into the corpus to justify the round trip.
 *
 * Every outcome is recorded, discards included: an apply rate counted only from
 * the proposals that landed is not a rate.
 */
export function AmendPanel({
  noteId,
  noteSlug,
  noteTitle,
  projectSlug,
  conversationId,
}: {
  noteId: string;
  noteSlug: string;
  noteTitle: string;
  projectSlug: string;
  conversationId: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<Proposed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/notes/${noteId}/amend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await response.text());
      return null;
    }
    return response.json();
  }

  async function propose() {
    setApplied(false);
    const proposed = (await send({ mode: "propose", conversationId })) as Proposed | null;
    if (proposed) setResult(proposed);
  }

  async function apply() {
    if (!result) return;
    if (!(await send({ mode: "apply", amendmentId: result.amendmentId }))) return;
    setResult(null);
    setApplied(true);
    router.refresh();
  }

  async function discard() {
    if (!result) return;
    await send({ mode: "discard", amendmentId: result.amendmentId });
    setResult(null);
  }

  return (
    <aside className="flex flex-col gap-3 lg:border-l lg:border-rule lg:pl-6">
      <h2 className="font-mono text-xs uppercase tracking-widest text-ink-faint">Amendment</h2>

      {!result && !applied && (
        <p className="text-xs leading-relaxed text-ink-faint">
          When this makes sense, fold it back into the note. Nothing is written until you
          have read the diff.
        </p>
      )}

      {applied && (
        <p className="text-xs leading-relaxed text-ink-soft">
          Applied to{" "}
          <Link
            href={`/p/${projectSlug}/notes/${noteSlug}`}
            className="text-accent hover:underline"
          >
            {noteTitle}
          </Link>
          . This branch keeps the reasoning that got you there.
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          {result.proposal.rationale && (
            <p className="text-xs leading-relaxed text-ink-soft">{result.proposal.rationale}</p>
          )}

          {result.changed ? (
            <>
              {result.titleChanged && (
                <p className="font-mono text-[0.65rem] text-ink-faint">
                  title → {result.proposal.title}
                </p>
              )}
              <DiffView rows={result.diff} />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={apply}
                  disabled={busy}
                  className="border border-accent px-2 py-1 font-mono text-[0.65rem] text-accent disabled:opacity-40"
                >
                  apply
                </button>
                <button
                  onClick={discard}
                  disabled={busy}
                  className="border border-rule px-2 py-1 font-mono text-[0.65rem] text-ink-faint disabled:opacity-40"
                >
                  discard
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-ink-faint">
              No change proposed — the note already says this. Keep going, or leave it.
            </p>
          )}
        </div>
      )}

      {error && <p className="font-mono text-[0.65rem] text-signal">{error}</p>}

      <button
        onClick={propose}
        disabled={busy}
        className="self-start border border-rule px-2 py-1 font-mono text-[0.65rem] text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40"
      >
        {busy ? "reading the branch…" : result || applied ? "propose again" : "propose amendment"}
      </button>
    </aside>
  );
}
