import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@/lib/sync/account";
import type { RepoBranches, RepoRef } from "@/lib/sync/spawn";

const DEBOUNCE_MS = 450;
const query = { staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false } as const;

export interface BranchLookup {
  /** Reply for the repository currently typed (never a stale one). */
  reply?: RepoBranches | undefined;
  loading: boolean;
  /** Whether `ref` resolves: from the listing, else a debounced ref check. */
  refExists?: boolean | undefined;
}

/** Debounced `repo-branches` lookups, cached per daemon and repository. The
 * listing is fetched once per repo; a ref outside it (a tag, a commit, a
 * branch past the first page) gets its own `{repoUrl, ref}` check. */
export function useRepoBranches(account: Account, machineId: string | undefined, repo: RepoRef | null, ref: string): BranchLookup {
  // Any host: the daemon knows which ones it can look up (GitHub, its
  // Forgejo) and answers the rest with a failure the form shows as a hint.
  const url = repo?.url ?? "";
  const [debouncedUrl] = useDebouncedValue(url, DEBOUNCE_MS);
  const settledUrl = debouncedUrl === url ? url : "";
  const lookup = (r?: string): Promise<RepoBranches> =>
    // The demo account fakes spawn() only; treat anything else as unavailable.
    typeof account.repoBranches === "function"
      ? account.repoBranches(machineId!, settledUrl, r)
      : Promise.resolve({ ok: false, error: "branch lookup unavailable", unavailable: true, notFound: false });

  const list = useQuery({ queryKey: ["repo-branches", machineId, settledUrl], queryFn: () => lookup(), enabled: !!machineId && !!settledUrl, ...query });
  const reply = settledUrl ? list.data : undefined;
  const listed = reply?.ok ? reply : undefined;

  const want = ref.trim();
  const inList = !!listed && listed.branches.includes(want);
  const [debouncedRef] = useDebouncedValue(want, DEBOUNCE_MS);
  const needCheck = !!listed && !!want && !inList;
  const check = useQuery({
    queryKey: ["repo-branches", machineId, settledUrl, debouncedRef],
    queryFn: () => lookup(debouncedRef),
    enabled: needCheck && debouncedRef === want,
    ...query,
  });
  const checked = needCheck && debouncedRef === want && check.data?.ok ? check.data.refExists : undefined;

  return {
    reply,
    loading: (!!url && url !== debouncedUrl) || list.isFetching || (needCheck && (debouncedRef !== want || check.isFetching)),
    refExists: !listed || !want ? undefined : inList ? true : checked,
  };
}
