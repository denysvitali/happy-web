// Expanded bodies of the specialised tool views. Header metadata (icon,
// title, one-line summary, badge) lives in ./registry.ts.
import { Anchor, Button, TextInput, UnstyledButton } from "@mantine/core";
import { CheckCircle2, Circle, CircleDot, MessageCircleQuestion } from "lucide-react";
import { Fragment, useState } from "react";
import type { ToolBlock } from "@/lib/sync/chat";
import { Markdown } from "../markdown";
import type { PermissionHandler } from "../permission";
import { lineCount, lines, numberRows } from "../text";
import { Clip, CopyIcon, KeyValues, ResultView, Section } from "../primitives";
import {
  asText,
  commandOf,
  editDiffs,
  editRows,
  field,
  isEmptyOutput,
  isObj,
  patchChanges,
  questionAnswers,
  questionsOf,
  readOutput,
  shellOutput,
  str,
  todosOf,
  toolPath,
  writeContent,
  type DiffRow,
  type Obj,
  type Question,
} from "./format";
import classes from "../chat.module.css";

export interface ToolViewProps {
  b: ToolBlock;
  /** Set while the call awaits the user, for views that answer it themselves. */
  onPermission?: PermissionHandler | undefined;
}

const inputOf = (b: ToolBlock): Obj => (isObj(b.input) ? b.input : {});

function Result({ b, label = "Output" }: ToolViewProps & { label?: string }) {
  if (!b.result) return null;
  return (
    <Section label={b.result.isError ? "Error" : label} right={<CopyIcon text={asText(b.result.output)} reveal />}>
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
  const failed = !!b.result?.isError;
  const exit = out?.exitCode ?? (failed ? "failed" : undefined);
  const total = out ? lineCount(out.stdout) + lineCount(out.stderr) : 0;
  return (
    <div className={classes.terminal}>
      {cwd && <div className={classes.terminalCwd}>{cwd}</div>}
      <div className={classes.commandRow}>
        <pre className={classes.command}>
          <span className={classes.prompt}>$ </span>
          {cmd}
        </pre>
        <CopyIcon text={cmd} label="Copy command" reveal />
      </div>
      {out && (
        <div className={classes.terminalOut}>
          {out.stdout || out.stderr ? (
            <>
              <div className={classes.terminalHead} data-tone={failed ? "error" : undefined}>
                <span>
                  Output{total > 0 && ` · ${lines(total)}`}
                  {exit !== undefined && (
                    <span className={classes.exit} data-ok={exit === 0 || undefined}>
                      {typeof exit === "number" ? `exit ${exit}` : exit}
                    </span>
                  )}
                </span>
                <CopyIcon text={[out.stdout, out.stderr].filter(Boolean).join("\n")} reveal />
              </div>
              {out.stdout && <Clip text={out.stdout} tone={failed && !out.stderr ? "error" : undefined} />}
              {out.stderr && <Clip text={out.stderr} tone="error" />}
            </>
          ) : (
            <span className={classes.dim}>No output</span>
          )}
        </div>
      )}
    </div>
  );
}

// ---- files --------------------------------------------------------------------

export function ReadBody({ b }: ToolViewProps) {
  const path = toolPath(b.input) ?? "";
  const r = b.result;
  const parsed = r && !r.isError ? readOutput(r.output) : undefined;
  return (
    <>
      {path && <code className={classes.path}>{path}</code>}
      {parsed?.kind === "text" ? (
        <Section label="Content" right={<CopyIcon text={parsed.text} reveal />}>
          <Clip text={parsed.text} />
        </Section>
      ) : parsed?.kind === "empty" ? (
        <span className={classes.dim}>Empty file</span>
      ) : (
        <Result b={b} label="Content" />
      )}
    </>
  );
}

function Diff({ rows }: { rows: DiffRow[] }) {
  if (rows.length === 0) return <span className={classes.dim}>No changes</span>;
  // Numbers are drawn by CSS (data-n), so copying or searching sees only code.
  return (
    <div className={classes.diff}>
      {numberRows(rows).map((r, k) =>
        r.op === "…" ? (
          <div key={k} className={classes.diffSkip}>
            ⋯ {r.count} unchanged {r.count === 1 ? "line" : "lines"}
          </div>
        ) : (
          <div key={k} className={classes.diffLine} data-op={r.op} data-n={r.n}>
            <span className={classes.diffOp}>{r.op}</span>
            {r.text || " "}
          </div>
        ),
      )}
    </div>
  );
}

function FileHead({ b }: ToolViewProps) {
  const path = toolPath(b.input) ?? "";
  return path ? <code className={classes.path}>{path}</code> : null;
}

function ErrorOnly({ b }: ToolViewProps) {
  return b.result?.isError ? <Result b={b} /> : null;
}

export function EditBody({ b }: ToolViewProps) {
  const diffs = editDiffs(b);
  const path = toolPath(b.input);
  const emptyResult = b.result && !b.result.isError && isEmptyOutput(b.result.output);
  return (
    <>
      <FileHead b={b} />
      {diffs.length === 0 &&
        (b.result ? (
          emptyResult ? (
            <span className={classes.dim}>Applied</span>
          ) : (
            <Result b={b} />
          )
        ) : (
          <span className={classes.dim}>No changes yet</span>
        ))}
      {diffs.map((d, k) => (
        <Fragment key={k}>
          {d.path && d.path !== path && <code className={classes.path}>{d.path}</code>}
          <Diff rows={d.rows} />
        </Fragment>
      ))}
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
  const content = writeContent(b);
  return (
    <>
      <FileHead b={b} />
      {content !== undefined ? (
        content === "" ? (
          <span className={classes.dim}>Empty file</span>
        ) : (
          <Section label="Content" right={<CopyIcon text={content} reveal />}>
            <Clip text={content} />
          </Section>
        )
      ) : (
        b.result && !b.result.isError && isEmptyOutput(b.result.output) && <span className={classes.dim}>Written</span>
      )}
      <ErrorOnly b={b} />
    </>
  );
}

function patchRows(text: string): DiffRow[] {
  return text.split("\n").map((line) => {
    const op = line.startsWith("+") && !line.startsWith("+++") ? "+" : line.startsWith("-") && !line.startsWith("---") ? "-" : " ";
    return { op, text: op === " " ? line : line.slice(1) };
  });
}

/** Unified diff / apply_patch text with +/- colouring, or Codex `changes` map. */
export function PatchBody({ b }: ToolViewProps) {
  const i = inputOf(b);
  const patch = str(i.patch) ?? str(i.input) ?? str(i.diff) ?? (typeof b.input === "string" ? b.input : undefined);
  if (patch) {
    return (
      <>
        <Diff rows={patchRows(patch)} />
        {b.result && (b.result.isError || !isEmptyOutput(b.result.output)) && <Result b={b} />}
      </>
    );
  }
  const changes = patchChanges(b.input);
  if (changes.length > 0) {
    return (
      <>
        {changes.map((c, k) => (
          <Fragment key={k}>
            <code className={classes.path}>{c.kind ? `${c.kind} · ${c.path}` : c.path}</code>
            {c.diff && <Diff rows={patchRows(c.diff)} />}
          </Fragment>
        ))}
        <ErrorOnly b={b} />
      </>
    );
  }
  return <GenericBody b={b} />;
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

export function QuestionBody({ b, onPermission }: ToolViewProps) {
  const qs = questionsOf(b.input);
  if (qs.length === 0) return <GenericBody b={b} />;
  if (onPermission && b.permission?.status === "pending") return <QuestionForm b={b} qs={qs} onPermission={onPermission} />;
  return (
    <>
      {qs.map((q, k) => (
        <div key={k} className={classes.question}>
          <QuestionHead q={q} />
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

function QuestionHead({ q }: { q: Question }) {
  return (
    <div className={classes.questionHead}>
      <MessageCircleQuestion size={14} />
      {q.header && <span className={classes.chip}>{q.header}</span>}
      <span>{q.question}</span>
    </div>
  );
}

/** A pending AskUserQuestion: pick options (or type one), then send. The
 * picks go back as the approved call's `updatedInput.answers`; Skip denies. */
function QuestionForm({ b, qs, onPermission }: { b: ToolBlock; qs: Question[]; onPermission: PermissionHandler }) {
  const [picks, setPicks] = useState<string[][]>(() => qs.map(() => []));
  const [other, setOther] = useState<string[]>(() => qs.map(() => ""));
  const [busy, setBusy] = useState<"send" | "skip" | null>(null);
  const [error, setError] = useState("");
  const answers = questionAnswers(qs, picks, other);
  const at = <T,>(list: T[], i: number, v: T) => list.map((x, k) => (k === i ? v : x));
  const pick = (i: number, label: string) => {
    const q = qs[i]!;
    const cur = picks[i] ?? [];
    const on = cur.includes(label);
    setPicks(at(picks, i, q.multiSelect ? (on ? cur.filter((l) => l !== label) : [...cur, label]) : on ? [] : [label]));
    if (!q.multiSelect && !on) setOther(at(other, i, ""));
  };
  const type = (i: number, text: string) => {
    setOther(at(other, i, text));
    if (!qs[i]!.multiSelect && text.trim()) setPicks(at(picks, i, []));
  };
  const send = async (approved: boolean) => {
    setBusy(approved ? "send" : "skip");
    setError("");
    try {
      await onPermission(b.id, approved, undefined, approved && answers ? { ...inputOf(b), answers } : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  };
  return (
    <form
      className={classes.questionForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (answers && !busy) void send(true);
      }}
    >
      {qs.map((q, i) => (
        <div key={i} className={classes.question}>
          <QuestionHead q={q} />
          <div className={classes.options} role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question}>
            {q.options.map((o, j) => {
              const on = picks[i]?.includes(o.label) ?? false;
              return (
                <UnstyledButton
                  key={j}
                  className={classes.option}
                  data-selected={on || undefined}
                  role={q.multiSelect ? "checkbox" : "radio"}
                  aria-checked={on}
                  disabled={!!busy}
                  onClick={() => pick(i, o.label)}
                >
                  <strong>{o.label}</strong>
                  {o.description && <span className={classes.dim}>{o.description}</span>}
                </UnstyledButton>
              );
            })}
          </div>
          <TextInput
            size="xs"
            placeholder={q.multiSelect ? "Something else (optional)" : "Something else…"}
            aria-label={`Other answer to: ${q.question}`}
            value={other[i] ?? ""}
            disabled={!!busy}
            onChange={(e) => type(i, e.currentTarget.value)}
          />
          {q.multiSelect && <span className={classes.dim}>Pick any</span>}
        </div>
      ))}
      <div className={classes.permActions}>
        {error && <span className={classes.permError}>{error}</span>}
        <Button size="xs" variant="subtle" color="gray" loading={busy === "skip"} disabled={!!busy} onClick={() => void send(false)}>
          Skip
        </Button>
        <Button size="xs" type="submit" loading={busy === "send"} disabled={!answers || !!busy}>
          {qs.length > 1 ? "Send answers" : "Send answer"}
        </Button>
      </div>
    </form>
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
