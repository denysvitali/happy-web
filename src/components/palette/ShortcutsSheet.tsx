import { Kbd } from "@mantine/core";
import { FormSection, FormRow } from "@/ui/FormSection";
import { openSheet, SheetBody } from "@/ui/Sheet";
import { SHORTCUT_GROUPS } from "./shortcuts";
import classes from "./palette.module.css";

export function openShortcuts(): void {
  openSheet({
    title: "Keyboard shortcuts",
    size: 460,
    children: () => (
      <SheetBody>
        {SHORTCUT_GROUPS.map((g) => (
          <FormSection key={g.title} title={g.title}>
            {g.items.map((it) => (
              <FormRow key={it.label} label={it.label} trailing>
                <span className={classes.keys}>
                  {it.keys.map((k, i) => (
                    <span key={k} className={classes.keyGroup}>
                      {i > 0 && it.keys.length === 2 && it.keys[0] === "G" && (
                        <span className={classes.then}>then</span>
                      )}
                      <Kbd>{k}</Kbd>
                    </span>
                  ))}
                </span>
              </FormRow>
            ))}
          </FormSection>
        ))}
      </SheetBody>
    ),
  });
}
