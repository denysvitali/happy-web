/**
 * Value for Mantine's `data-autofocus`: true on desktop, undefined on touch.
 * Focusing a text field when a sheet opens pops the on-screen keyboard over
 * the sheet before the person has seen it.
 */
export const autofocus = (): true | undefined => (window.matchMedia("(pointer: coarse)").matches ? undefined : true);
