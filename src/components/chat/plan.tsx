// The agent's current todo list, pinned in the composer toolbar while
// unfinished, so "where is it at?" never needs scrolling back. Phones show
// the count only; the popover has the list.
import { Popover, UnstyledButton } from "@mantine/core";
import { ListChecks } from "lucide-react";
import type { ToolBlock } from "@/lib/sync/chat";
import { field, todosOf } from "./tools/format";
import { TodoBody } from "./tools/views";
import classes from "./chat.module.css";

export function PlanChip({ plan }: { plan: ToolBlock }) {
  const todos = todosOf(plan.input);
  const done = todos.filter((t) => t.status === "completed").length;
  if (todos.length === 0 || done === todos.length) return null;
  const raw = Array.isArray((plan.input as { todos?: unknown }).todos) ? (plan.input as { todos: unknown[] }).todos : [];
  const currentIdx = todos.findIndex((t) => t.status === "in_progress");
  const current = currentIdx >= 0 ? (field(raw[currentIdx], "activeForm") ?? todos[currentIdx]!.content) : todos.find((t) => t.status === "pending")?.content;
  return (
    <Popover position="top-end" width={320} offset={6} shadow="md" radius="md" withinPortal>
      <Popover.Target>
        <UnstyledButton className={classes.planChip} aria-label={`Plan: ${done} of ${todos.length} done`} title={current}>
          <ListChecks size={14} className={classes.planIcon} />
          <span className={classes.planCount}>
            {done}/{todos.length}
          </span>
          {current && <span className={classes.planNow}>{current}</span>}
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <TodoBody b={plan} />
      </Popover.Dropdown>
    </Popover>
  );
}
