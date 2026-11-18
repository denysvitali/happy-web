import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getServerUrl } from "@/lib/config";
import { deriveAccountKeys } from "@/lib/crypto/keys";
import { forgetDevice, loadCredentials, saveCredentials } from "@/lib/auth/storage";
import type { LinkResult } from "@/lib/auth/link";
import { Account } from "@/lib/sync/account";

type AuthState =
  | { status: "loading" }
  | { status: "unlinked"; note?: string }
  | { status: "linked"; account: Account };

interface AuthApi {
  state: AuthState;
  completeLink(result: LinkResult): Promise<void>;
  forget(): Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const activate = useCallback(
    async (serverUrl: string, token: string, secret: Uint8Array) => {
      const keys = await deriveAccountKeys(secret);
      const account = new Account(serverUrl, token, keys, qc);
      account.start();
      setState({ status: "linked", account });
    },
    [qc],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const creds = await loadCredentials();
        if (cancelled) return;
        if (!creds) return setState({ status: "unlinked" });
        if (creds.serverUrl !== getServerUrl()) {
          return setState({ status: "unlinked", note: `This device was linked to ${creds.serverUrl}. Link again for the current server.` });
        }
        await activate(creds.serverUrl, creds.token, creds.secret);
      } catch {
        if (!cancelled) setState({ status: "unlinked", note: "Could not read this device's stored credentials." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activate]);

  useEffect(() => {
    if (state.status !== "linked") return;
    return () => state.account.stop();
  }, [state]);

  const api = useMemo<AuthApi>(
    () => ({
      state,
      async completeLink(r) {
        const serverUrl = getServerUrl();
        await saveCredentials({ serverUrl, token: r.token, secret: r.secret });
        await activate(serverUrl, r.token, r.secret);
      },
      async forget() {
        if (state.status === "linked") state.account.stop();
        await forgetDevice();
        qc.clear();
        setState({ status: "unlinked" });
      },
    }),
    [state, activate, qc],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

export function useAccount(): Account {
  const { state } = useAuth();
  if (state.status !== "linked") throw new Error("not linked");
  return state.account;
}
