// Happy session ToDos (`metadata.todos`, written by happy-cli-go's todo_*
// MCP tools). Unlike a provider's TodoWrite plan they outlive turns, nest via
// `parentId` and may be assigned to an agent. Canceled items are hidden like
// in `todo_list`; completed ones stay until the CLI expires them.
import { z } from "zod/mini";

const str = z.catch(z.optional(z.string()), undefined);

const item = z.object({
  id: z.string(),
  content: z.catch(z.string(), ""),
  status: z.catch(z.string(), "pending"),
  order: z.catch(z.number(), 0),
  description: str,
  parentId: str,
  agentId: str,
});

export interface SessionTodo {
  id: string;
  content: string;
  status: string;
  description?: string | undefined;
  agentId?: string | undefined;
  depth: number;
}

export interface SessionTodos {
  items: SessionTodo[];
  done: number;
  total: number;
  current?: string | undefined;
}

/** Visible items in tree order (parents first, siblings by `order`), with counts. */
export function sessionTodos(raw: unknown): SessionTodos | undefined {
  if (!Array.isArray(raw)) return undefined;
  const all = raw.flatMap((r) => {
    const p = z.safeParse(item, r);
    return p.success && p.data.status !== "canceled" ? [p.data] : [];
  });
  if (all.length === 0) return undefined;
  const ids = new Set(all.map((t) => t.id));
  const kids = new Map<string | undefined, typeof all>();
  for (const t of all) {
    const parent = t.parentId && ids.has(t.parentId) && t.parentId !== t.id ? t.parentId : undefined;
    kids.set(parent, [...(kids.get(parent) ?? []), t]);
  }
  const items: SessionTodo[] = [];
  const seen = new Set<string>();
  const walk = (list: typeof all, depth: number) => {
    for (const t of [...list].sort((a, b) => a.order - b.order)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      items.push({ id: t.id, content: t.content, status: t.status, description: t.description || undefined, agentId: t.agentId || undefined, depth });
      walk(kids.get(t.id) ?? [], depth + 1);
    }
  };
  walk(kids.get(undefined) ?? [], 0);
  // A parent cycle has no root; show its members flat rather than drop them.
  walk(all.filter((t) => !seen.has(t.id)), 0);
  const done = items.filter((t) => t.status === "completed").length;
  // The innermost running item says most: skip parents of running children.
  const busyParents = new Set(all.filter((t) => t.status === "in_progress").map((t) => t.parentId));
  const current = (items.find((t) => t.status === "in_progress" && !busyParents.has(t.id)) ?? items.find((t) => t.status === "pending"))?.content;
  return { items, done, total: items.length, current };
}
