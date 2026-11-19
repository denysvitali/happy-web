// What the session is working through, pinned in the composer toolbar so
// "where is it at?" never needs scrolling back. One chip for both lists: the
// Happy session ToDos (durable, `metadata.todos`) count when present, else the
// provider's unfinished TodoWrite plan. Phones show the count only; the
// popover has the lists.
import { Popover, UnstyledButton } from "@mantine/core";
import { CheckCircle2, Circle, CircleDot, ListChecks } from "lucide-react";
import type { ToolBlock } from "@/lib/sync/chat";
import type { SessionTodos } from "@/lib/sync/todos";
import { field, todosOf } from "./tools/format";
import { TodoBody } from "./tools/views";
import classes from "./chat.module.css";

function livePlan(plan: ToolBlock | undefined) {
  if (!plan) return undefined;
  const todos = todosOf(plan.input);
  const done = todos.filter((t) => t.status === "completed").length;
  if (todos.length === 0 || done === todos.length) return undefined;
  const raw = Array.isArray((plan.input as { todos?: unknown }).todos) ? (plan.input as { todos: unknown[] }).todos : [];
  const currentIdx = todos.findIndex((t) => t.status === "in_progress");
  const current = currentIdx >= 0 ? (field(raw[currentIdx], "activeForm") ?? todos[currentIdx]!.content) : todos.find((t) => t.status === "pending")?.content;
  return { done, total: todos.length, current };
}

export function PlanChip({ plan, todos }: { plan?: ToolBlock | undefined; todos?: SessionTodos | undefined }) {
  const live = livePlan(plan);
  const head = todos ?? live;
  if (!head) return null;
  const label = todos ? "ToDos" : "Plan";
  return (
    <Popover position="top-end" width={340} offset={6} shadow="md" radius="md" withinPortal>
      <Popover.Target>
        <UnstyledButton className={classes.planChip} aria-label={`${label}: ${head.done} of ${head.total} done`} title={head.current}>
          <ListChecks size={14} className={classes.planIcon} />
          <span className={classes.planCount}>
            {head.done}/{head.total}
          </span>
          {head.current && head.done < head.total && <span className={classes.planNow}>{head.current}</span>}
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown className={classes.planPop}>
        {todos && <SessionTodoList todos={todos} />}
        {todos && live && plan && <div className={classes.planSection}>Agent plan</div>}
        {live && plan && <TodoBody b={plan} />}
      </Popover.Dropdown>
    </Popover>
  );
}

function SessionTodoList({ todos }: { todos: SessionTodos }) {
  return (
    <ul className={classes.todos}>
      {todos.items.map((t) => (
        <li key={t.id} data-status={t.status} style={t.depth ? { paddingLeft: Math.min(t.depth, 4) * 18 } : undefined}>
          {t.status === "completed" ? <CheckCircle2 size={15} /> : t.status === "in_progress" ? <CircleDot size={15} /> : <Circle size={15} />}
          <div className={classes.todoText}>
            <span>{t.content}</span>
            {t.agentId && <em className={classes.todoAgent}>{t.agentId}</em>}
            {t.description && <p className={classes.todoNote}>{t.description}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
