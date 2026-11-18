// Typed client for grpc-gateway routes. The HTTP verb and path come from each
// method's `google.api.http` annotation, and messages travel as protobuf JSON.
//
// Only routes the server serves through grpc-gateway belong here; most
// session/machine routes are hand-written compat handlers whose JSON is not
// protobuf JSON (see schemas.ts).
import {
  create,
  fromJson,
  getOption,
  toJson,
  type DescMessage,
  type DescMethodUnary,
  type JsonObject,
  type MessageInitShape,
  type MessageShape,
} from "@bufbuild/protobuf";
import { http } from "@/gen/google/api/annotations_pb";
import { requestJson } from "./http";

interface Route {
  verb: "GET" | "POST" | "DELETE";
  template: string;
  body: string;
}

function routeOf(method: DescMethodUnary): Route {
  const rule = getOption(method, http);
  const p = rule.pattern;
  switch (p.case) {
    case "get":
      return { verb: "GET", template: p.value, body: rule.body };
    case "post":
      return { verb: "POST", template: p.value, body: rule.body };
    case "delete":
      return { verb: "DELETE", template: p.value, body: rule.body };
    default:
      throw new Error(`unsupported http rule on ${method.name}`);
  }
}

/** Expands `{field}` path parameters and returns the JSON for the rest. */
export function buildRequest<I extends DescMessage>(
  method: DescMethodUnary<I>,
  input: MessageShape<I>,
): { verb: Route["verb"]; path: string; body?: JsonObject; query?: Record<string, string> } {
  const route = routeOf(method);
  const json = toJson(method.input, input, { useProtoFieldName: false }) as JsonObject;
  const used = new Set<string>();
  const path = route.template.replace(/\{([a-z0-9_.]+)\}/g, (_, name: string) => {
    const field = method.input.fields.find((f) => f.name === name);
    if (!field) throw new Error(`unknown path field ${name}`);
    used.add(field.jsonName);
    const v = json[field.jsonName];
    if (v === undefined || v === null || v === "") throw new Error(`missing path field ${name}`);
    return encodeURIComponent(String(v));
  });
  const rest: JsonObject = {};
  for (const [k, v] of Object.entries(json)) if (!used.has(k)) rest[k] = v;
  if (route.body === "*") return { verb: route.verb, path, body: rest };
  if (route.body !== "") throw new Error(`unsupported body selector ${route.body}`);
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== null && typeof v !== "object") query[k] = String(v);
  }
  return { verb: route.verb, path, query };
}

export async function callGateway<I extends DescMessage, O extends DescMessage>(
  baseUrl: string,
  method: DescMethodUnary<I, O>,
  init: MessageInitShape<I>,
  opts: { token?: string | undefined; signal?: AbortSignal | undefined } = {},
): Promise<MessageShape<O>> {
  const req = buildRequest(method, create(method.input, init));
  const json = await requestJson(baseUrl, req.path, {
    method: req.verb,
    body: req.body,
    query: req.query,
    token: opts.token,
    signal: opts.signal,
  });
  return fromJson(method.output, (json ?? {}) as JsonObject, { ignoreUnknownFields: true });
}
