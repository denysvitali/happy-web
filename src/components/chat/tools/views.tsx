// Expanded bodies of the specialised tool views. Header metadata (icon,
// title, one-line summary, badge) lives in ./registry.ts.
import { Anchor } from "@mantine/core";
import { CheckCircle2, Circle, CircleDot, MessageCircleQuestion } from "lucide-react";
import type { ToolBlock } from "@/lib/sync/chat";
import { Markdown } from "../markdown";
import { Clip, CopyIcon, KeyValues, ResultView, Section } from "../primitives";
import { asText, commandOf, editRows, field, isObj, questionsOf, shellOutput, str, todosOf, type DiffRow, type Obj } from "./format";
import classes from "../chat.module.css";

export interface ToolViewProps {
  b: ToolBlock;
}

const inputOf = (b: ToolBlock): Obj => (isObj(b.input) ? b.input : {});

function Result({ b, label = "Output" }: ToolViewProps & { label?: string }) {
  if (!b.result) return null;
  return (
    <Section label={b.result.isError ? "Error" : label} right={<CopyIcon text={asText(b.result.output)} />}>
      <ResultView output={b.result.output} isError={b.result.isError} />
    </Section>
  );
}

// ---- generic / MCP --------------------------------------------------------------

export function GenericBody({ b }: ToolViewProps) {
  return (
    <>
      {b.input !== undefined && (
        <Section label="Arguments">
          <KeyValues value={b.input} />
        </Section>
      )}
      <Result b={b} label="Result" />
    </>
  );
}

// ---- shell --------------------------------------------------------------------

export function BashBody({ b }: ToolViewProps) {
  const cmd = commandOf(b.input) ?? "";
  const i = inputOf(b);
  const cwd = field(i, "cwd", "workdir");
  const out = b.result ? shellOutput(b.result.output) : undefined;
  return (
    <>
      <div className={classes.terminal}>
        <div className={classes.terminalHead}>
          <span>{cwd ?? "shell"}</span>
          <CopyIcon text={cmd} label="Copy command" />
        </div>
        <pre className={classes.command}>
          <span className={classes.prompt}>$ </span>
          {cmd}
        </pre>
      </div>
      {out && (out.stdout || out.stderr) && (
        <Section label={b.result?.isError ? "Output (failed)" : "Output"} right={<CopyIcon text={[out.stdout, out.stderr].filter(Boolean).join("\n")} />}>
          {out.stdout && <Clip text={out.stdout} tone={b.result?.isError && !out.stderr ? "error" : undefined} />}
          {out.stderr && <Clip text={out.stderr} tone="error" />}
        </Section>
      )}
      {out && !out.stdout && !out.stderr && <span className={classes.dim}>No output</span>}
    </>
  );
}

// ---- files --------------------------------------------------------------------

export function ReadBody({ b }: ToolViewProps) {
  const i = inputOf(b);
  const path = field(i, "file_path", "path", "notebook_path") ?? "";
  return (
    <>
      <code className={classes.path}>{path}</code>
      <Result b={b} label="Content" />
    </>
  );
}

function Diff({ rows }: { rows: DiffRow[] }) {
  if (rows.length === 0) return <span className={classes.dim}>No changes</span>;
  return (
    <div className={classes.diff}>
      {rows.map((r, k) =>
        r.op === "…" ? (
          <div key={k} className={classes.diffSkip}>
            ⋯ {r.count} unchanged {r.count === 1 ? "line" : "lines"}
          </div>
        ) : (
          <div key={k} className={classes.diffLine} data-op={r.op}>
            <span className={classes.diffOp}>{r.op}</span>
            {r.text || " "}
          </div>
        ),
      )}
    </div>
  );
}

function FileHead({ b }: ToolViewProps) {
  const path = field(inputOf(b), "file_path", "path") ?? "";
  return path ? <code className={classes.path}>{path}</code> : null;
}

function ErrorOnly({ b }: ToolViewProps) {
  return b.result?.isError ? <Result b={b} /> : null;
}

export function EditBody({ b }: ToolViewProps) {
  return (
    <>
      <FileHead b={b} />
      <Diff rows={editRows(b.input)} />
      {inputOf(b).replace_all === true && <span className={classes.dim}>All occurrences replaced</span>}
      <ErrorOnly b={b} />
    </>
  );
}

export function MultiEditBody({ b }: ToolViewProps) {
  const edits = Array.isArray(inputOf(b).edits) ? (inputOf(b).edits as unknown[]) : [];
  return (
    <>
      <FileHead b={b} />
      {edits.map((e, k) => (
        <Diff key={k} rows={editRows(e)} />
      ))}
      <ErrorOnly b={b} />
    </>
  );
}

export function WriteBody({ b }: ToolViewProps) {
  const content = str(inputOf(b).content) ?? "";
  return (
    <>
      <FileHead b={b} />
      <Section label="Content" right={<CopyIcon text={content} />}>
        <Clip text={content} />
      </Section>
      <ErrorOnly b={b} />
    </>
  );
}

/** Unified diff / apply_patch text with +/- colouring. */
export function PatchBody({ b }: ToolViewProps) {
  const i = inputOf(b);
  const patch = str(i.patch) ?? str(i.input) ?? str(i.diff) ?? (typeof b.input === "string" ? b.input : undefined);
  if (!patch) return <GenericBody b={b} />;
  const rows: DiffRow[] = patch.split("\n").map((line) => {
    const op = line.startsWith("+") && !line.startsWith("+++") ? "+" : line.startsWith("-") && !line.startsWith("---") ? "-" : " ";
    return { op, text: op === " " ? line : line.slice(1) };
  });
  return (
    <>
      <Diff rows={rows} />
      <Result b={b} />
    </>
  );
}

// ---- search -------------------------------------------------------------------

export function SearchBody({ b }: ToolViewProps) {
  const i = inputOf(b);
  const rest = Object.fromEntries(Object.entries(i).filter(([k]) => k !== "pattern" && k !== "query"));
  return (
    <>
      {Object.keys(rest).length > 0 && <KeyValues value={rest} />}
      <Result b={b} label="Matches" />
    </>
  );
}

export function WebFetchBody({ b }: ToolViewProps) {
  const i = inputOf(b);
  const url = str(i.url);
  const safe = url && /^https?:\/\//i.test(url) ? url : undefined;
  return (
    <>
      {url &&
        (safe ? (
          <Anchor href={safe} target="_blank" rel="noopener noreferrer nofollow" size="xs" className={classes.path}>
            {url}
          </Anchor>
        ) : (
          <code className={classes.path}>{url}</code>
        ))}
      {str(i.prompt) && <div className={classes.quote}>{str(i.prompt)}</div>}
      <Result b={b} label="Response" />
    </>
  );
}

// ---- todos / questions / plans ---------------------------------------------------

export function TodoBody({ b }: ToolViewProps) {
  const todos = todosOf(b.input);
  if (todos.length === 0) return <GenericBody b={b} />;
  return (
    <ul className={classes.todos}>
      {todos.map((t, k) => (
        <li key={k} data-status={t.status}>
          {t.status === "completed" ? <CheckCircle2 size={15} /> : t.status === "in_progress" ? <CircleDot size={15} /> : <Circle size={15} />}
          <span>{t.content}</span>
        </li>
      ))}
    </ul>
  );
}

export function QuestionBody({ b }: ToolViewProps) {
  const qs = questionsOf(b.input);
  if (qs.length === 0) return <GenericBody b={b} />;
  return (
    <>
      {qs.map((q, k) => (
        <div key={k} className={classes.question}>
          <div className={classes.questionHead}>
            <MessageCircleQuestion size={14} />
            {q.header && <span className={classes.chip}>{q.header}</span>}
            <span>{q.question}</span>
          </div>
          <div className={classes.options}>
            {q.options.map((o, j) => (
              <div key={j} className={classes.option} title={o.description}>
                <strong>{o.label}</strong>
                {o.description && <span className={classes.dim}>{o.description}</span>}
              </div>
            ))}
          </div>
          {q.multiSelect && <span className={classes.dim}>Multiple choice</span>}
        </div>
      ))}
      <Result b={b} label="Answer" />
    </>
  );
}

export function PlanBody({ b }: ToolViewProps) {
  const plan = str(inputOf(b).plan);
  return (
    <>
      {plan ? (
        <div className={classes.plan}>
          <Markdown text={plan} />
        </div>
      ) : (
        <GenericBody b={b} />
      )}
      {b.result && <Result b={b} label="Response" />}
    </>
  );
}
