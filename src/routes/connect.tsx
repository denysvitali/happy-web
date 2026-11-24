import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAccount } from "@/app/auth";
import { LinkDevice } from "@/components/account/LinkDevice";
import { BackButton, NavBar } from "@/ui/NavBar";
import classes from "./connect.module.css";

/** Where `happy auth login --method web` sends the browser: the terminal's
 * key arrives as `/terminal/connect#key=…`, which main.tsx rewrites to this
 * hash route. Approving still takes a tap; a link alone never links. */
export function ConnectScreen() {
  const account = useAccount();
  const { key } = useSearch({ from: "/authed/terminal/connect" });
  const navigate = useNavigate();
  return (
    <div className={classes.page}>
      <NavBar title="Link a machine" leading={<BackButton />} />
      <div className={classes.body}>
        <LinkDevice account={account} initial={key ? `happy://terminal?${key}` : ""} onDone={() => void navigate({ to: "/" })} />
      </div>
    </div>
  );
}
