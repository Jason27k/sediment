export type NoteKind = "concept" | "recipe";
export type CandidateStatus = "pending" | "accepted" | "dismissed" | "merged";
export type Suggestion = "new" | "review" | "extend";

export type User = { id: string; email: string; name: string | null; image: string | null };

export type Project = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  brief: string | null;
  created_at: Date;
};

export type Note = {
  id: string;
  user_id: string;
  project_id: string;
  slug: string;
  title: string;
  body_md: string;
  kind: NoteKind;
  assumes: string | null;
  source_type: "message" | "url" | "file" | null;
  source_ref: string | null;
  merged_into: string | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type Candidate = {
  id: string;
  project_id: string;
  message_id: string | null;
  title: string;
  body_md: string;
  kind: NoteKind;
  assumes: string | null;
  status: CandidateStatus;
  near_note_id: string | null;
  near_score: number | null;
  suggestion: Suggestion | null;
  created_at: Date;
};

/** A candidate as the tray reads it: the row plus the note the dedupe check landed on. */
export type TrayCandidate = Candidate & { near_title: string | null; near_slug: string | null };

export type AmendmentStatus = "proposed" | "applied" | "discarded" | "superseded" | "no_change";

/**
 * §07. One proposal and what became of it.
 *
 * Both bodies are kept so the apply rate and the size a note keeps across
 * repeated branches are answerable from these rows alone, without needing the
 * note's own history.
 */
export type Amendment = {
  id: string;
  user_id: string;
  note_id: string;
  conversation_id: string;
  before_title: string;
  before_body_md: string;
  after_title: string;
  after_body_md: string;
  rationale: string | null;
  status: AmendmentStatus;
  resolved_at: Date | null;
  created_at: Date;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: Date;
};

/**
 * The project's main thread when both parents are null, otherwise a branch (§07).
 * anchor_title and anchor_snapshot_md hold the anchor as it read at branch time,
 * which is what lets a branch outlive the note or message it hangs off.
 */
export type Conversation = {
  id: string;
  user_id: string;
  project_id: string;
  title: string | null;
  parent_note_id: string | null;
  parent_message_id: string | null;
  anchor_title: string | null;
  anchor_snapshot_md: string | null;
  summary: string | null;
  summary_through_count: number;
  created_at: Date;
};
