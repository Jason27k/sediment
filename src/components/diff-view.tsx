import type { DiffRow } from "@/lib/diff";

/**
 * §07's amendment diff. Rows carry word-level parts when a line was rewritten
 * rather than added or removed outright, which is what makes a reworded
 * paragraph readable instead of a wall of red above a wall of green.
 */
export function DiffView({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="border border-rule bg-surface font-mono text-xs leading-relaxed">
      {rows.map((row, i) => (
        <div
          key={i}
          className={`flex gap-2 px-2 ${
            row.type === "add"
              ? "bg-accent/10"
              : row.type === "del"
                ? "bg-signal/10 text-ink-soft"
                : ""
          }`}
        >
          <span aria-hidden className="select-none text-ink-faint">
            {row.type === "add" ? "+" : row.type === "del" ? "−" : " "}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {row.parts?.length
              ? row.parts.map((part, j) =>
                  part.changed ? (
                    <mark
                      key={j}
                      className={`bg-transparent ${
                        row.type === "add" ? "text-accent" : "text-signal line-through"
                      }`}
                    >
                      {part.text}
                    </mark>
                  ) : (
                    <span key={j}>{part.text}</span>
                  ),
                )
              : row.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}
