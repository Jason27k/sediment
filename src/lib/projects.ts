import { sql } from "./db";
import { slugify, uniqueSlug } from "./slug";
import type { Note, Project, TrayCandidate } from "./types";

export async function listProjects(userId: string): Promise<(Project & { note_count: number })[]> {
  return (await sql`
    select p.*, (select count(*) from active_notes n where n.project_id = p.id)::int as note_count
    from projects p
    where p.user_id = ${userId}
    order by p.created_at desc`) as (Project & { note_count: number })[];
}

export async function createProject(
  userId: string,
  name: string,
  brief: string | null,
): Promise<Project> {
  const rows = (await sql`select slug from projects where user_id = ${userId}`) as {
    slug: string;
  }[];
  const slug = uniqueSlug(slugify(name), new Set(rows.map((r) => r.slug)));

  const [project] = (await sql`
    insert into projects (user_id, name, slug, brief)
    values (${userId}, ${name}, ${slug}, ${brief})
    returning *`) as Project[];

  return project;
}

export async function getProject(userId: string, slug: string): Promise<Project | null> {
  const [project] = (await sql`
    select * from projects where user_id = ${userId} and slug = ${slug}`) as Project[];
  return project ?? null;
}

export async function listNotes(projectId: string): Promise<Note[]> {
  return (await sql`
    select * from active_notes where project_id = ${projectId} order by updated_at desc`) as Note[];
}

export async function getNoteBySlug(projectId: string, slug: string): Promise<Note | null> {
  const [note] = (await sql`
    select * from active_notes where project_id = ${projectId} and slug = ${slug}`) as Note[];
  return note ?? null;
}

/** §06 step 4. The capture tray. Candidates are not notes and never appear in the corpus. */
export async function listCandidates(projectId: string): Promise<TrayCandidate[]> {
  return (await sql`
    select c.*, n.title as near_title, n.slug as near_slug
    from note_candidates c
    left join notes n on n.id = c.near_note_id
    where c.project_id = ${projectId} and c.status = 'pending'
    order by c.created_at desc`) as TrayCandidate[];
}

/** The project's main thread; branches (§07) hang off notes and are created separately. */
export async function getOrCreateMainConversation(
  userId: string,
  projectId: string,
): Promise<string> {
  const [existing] = (await sql`
    select id from conversations
    where project_id = ${projectId} and parent_note_id is null and parent_message_id is null
    order by created_at
    limit 1`) as { id: string }[];

  if (existing) return existing.id;

  const [created] = (await sql`
    insert into conversations (user_id, project_id, title)
    values (${userId}, ${projectId}, 'Main thread')
    returning id`) as { id: string }[];

  return created.id;
}
