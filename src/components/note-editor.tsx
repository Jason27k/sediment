"use client";

import { marked } from "marked";
import { useRouter } from "next/navigation";
import { useState } from "react";

type EditableNote = {
  id: string;
  slug: string;
  title: string;
  body_md: string;
  kind: string;
  assumes: string | null;
};

export function NoteEditor({
  note,
  projectSlug,
  dependents,
}: {
  note: EditableNote;
  projectSlug: string;
  dependents: { inboundLinks: number; branches: number; reviews: number };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body_md);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body_md: body }),
    });
    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  /** §07: name the consequences while they can still act on them. */
  async function remove() {
    const parts = [
      dependents.inboundLinks && `${dependents.inboundLinks} notes link here`,
      dependents.branches && `${dependents.branches} branches hang off it`,
      dependents.reviews && `${dependents.reviews} reviews of history`,
    ].filter(Boolean);

    const detail = parts.length ? `\n\n${parts.join(", ")}.` : "";
    if (!confirm(`Delete "${note.title}"?${detail}\n\nSoft delete — recoverable for 30 days.`)) {
      return;
    }

    setBusy(true);
    await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    router.push(`/p/${projectSlug}/notes`);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="border border-rule bg-surface px-3 py-2 text-lg font-semibold outline-none focus:border-accent"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={18}
          className="border border-rule bg-surface px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-accent"
        />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="border border-accent px-4 py-1.5 text-sm text-accent disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="border border-rule px-4 py-1.5 text-sm text-ink-faint"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{note.title}</h1>
      <div
        className="prose-note max-w-none text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: marked.parse(note.body_md) as string }}
      />
      <div className="flex gap-2 border-t border-rule pt-3">
        <button
          onClick={() => setEditing(true)}
          className="border border-rule px-3 py-1 font-mono text-xs text-ink-soft hover:border-accent hover:text-accent"
        >
          edit
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="border border-rule px-3 py-1 font-mono text-xs text-signal disabled:opacity-40"
        >
          delete
        </button>
      </div>
    </div>
  );
}
