import { Combobox, Loader, Text, useCombobox } from "@mantine/core";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { DEFAULT_MODEL, effortLabel, parseSelection, selectionLabel } from "@/lib/sync/models";
import type { SessionSwitch } from "./hooks";
import classes from "./session.module.css";

const EFFORT_PREFIX = "effort\u0000";

/** Model picker grouped by model, with effort variants as chips under each
 * model. The pick rides on the next user message. */
export function ModelPicker({ sw }: { sw: SessionSwitch }) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const { catalog } = sw;
  const label = selectionLabel(catalog, sw.model);
  const efforts = catalog.efforts ?? [];
  const effortText = sw.kind === "prime" && sw.effort ? (efforts.find((e) => e.value === sw.effort)?.label ?? sw.effort) : undefined;
  const picked = parseSelection(sw.model);
  // "Default" cannot be restored through message meta once another model is
  // active (the agent keeps its model); only a respawn resets it.
  const defaultLocked = sw.activeModel !== DEFAULT_MODEL;

  if (catalog.groups.length === 0 && !sw.catalogLoading) {
    if (sw.model === DEFAULT_MODEL) return null;
    return (
      <span className={classes.chip} style={{ cursor: "default" }} title="This agent does not advertise a model list">
        <Sparkles size={14} className={classes.chipIcon} />
        <span className={classes.chipLabel}>{label}</span>
      </span>
    );
  }

  return (
    <Combobox
      store={combobox}
      withinPortal
      position="top-start"
      width={300}
      shadow="md"
      radius="md"
      onOptionSubmit={(v) => {
        if (v.startsWith(EFFORT_PREFIX)) sw.setEffort(v.slice(EFFORT_PREFIX.length));
        else sw.setModel(v);
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target targetType="button">
        <button
          type="button"
          className={classes.chip}
          data-open={combobox.dropdownOpened || undefined}
          data-pending={sw.pending || undefined}
          onClick={() => combobox.toggleDropdown()}
          aria-label={`Model: ${label}`}
          title={sw.pending ? "Switches with your next message" : undefined}
        >
          <Sparkles size={14} className={classes.chipIcon} />
          <span className={classes.chipLabel}>
            {label}
            {effortText ? ` · ${effortText}` : ""}
          </span>
          <ChevronDown size={12} className={classes.chevron} />
        </button>
      </Combobox.Target>
      <Combobox.Dropdown p={0}>
        <Combobox.Options className={classes.options} aria-label="Models">
          {sw.pending && <div className={classes.optionsNote}>Switches with your next message</div>}
          {sw.catalogLoading && catalog.groups.length === 0 && (
            <Combobox.Empty>
              <Loader size="xs" />
            </Combobox.Empty>
          )}
          {catalog.groups.map((g) => {
            const isDefault = g.id === DEFAULT_MODEL;
            const disabled = isDefault && defaultLocked;
            const active = isDefault ? sw.model === DEFAULT_MODEL : picked.base === g.id;
            const hint = disabled ? "Restart the session to go back to the default" : g.description;
            const variants = g.choices.slice(1);
            return (
              <div key={g.id}>
                <Combobox.Option value={g.id} disabled={disabled} active={active && !picked.effort}>
                  <div className={classes.option}>
                    {active ? <Check size={14} className={classes.check} /> : <span className={classes.checkSlot} />}
                    <div className={classes.optionText}>
                      <span className={classes.optionLabel}>{g.label}</span>
                      {hint && <span className={classes.optionHint}>{hint}</span>}
                    </div>
                  </div>
                </Combobox.Option>
                {variants.length > 0 && (
                  <div className={classes.efforts} role="group" aria-label={`${g.label} effort`}>
                    {variants.map((c) => {
                      const e = parseSelection(c.value).effort ?? c.value;
                      return (
                        <Combobox.Option key={c.value} value={c.value} className={classes.effort} data-active={sw.model === c.value || undefined} aria-label={c.label}>
                          {effortLabel(e)}
                        </Combobox.Option>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {efforts.length > 0 && (
            <>
              <Text size="xs" c="dimmed" fw={600} px="sm" pt="xs">
                Reasoning effort
              </Text>
              <div className={classes.efforts} style={{ paddingLeft: 8 }} role="group" aria-label="Reasoning effort">
                {efforts.map((e) => (
                  <Combobox.Option key={e.value} value={EFFORT_PREFIX + e.value} className={classes.effort} data-active={sw.effort === e.value || undefined}>
                    {e.label}
                  </Combobox.Option>
                ))}
              </div>
            </>
          )}
          {catalog.notice && (
            <Text size="xs" c="dimmed" px="sm" py={6}>
              {catalog.notice}
            </Text>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
