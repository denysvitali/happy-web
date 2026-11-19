import { Button } from "@mantine/core";
import { Compass } from "lucide-react";
import { EmptyState } from "@/ui/EmptyState";
import classes from "./not-found.module.css";

/** Unknown route. Wire as `notFoundComponent` on the router (inside the shell, so the sidebar stays). */
export function NotFoundScreen() {
  return (
    <div className={classes.page}>
      <EmptyState
        size="lg"
        tone="gray"
        icon={<Compass size={26} strokeWidth={1.6} />}
        title="Page not found"
        message="That address doesn't lead anywhere. The link may be old, or the session may have been deleted."
        action={
          <Button component="a" href="#/" radius="xl">
            Back to sessions
          </Button>
        }
      />
    </div>
  );
}
