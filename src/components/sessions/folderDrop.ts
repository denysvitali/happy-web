import { useState } from "react";

export interface FolderDrop {
  accepts(key: string): boolean;
  drop(key: string): void;
}

export function useFolderDrop(key: string, drop?: FolderDrop, touchOver = false) {
  const [mouseOver, setMouseOver] = useState(false);
  const over = mouseOver || touchOver;
  return {
    "data-folder-drop": drop ? key : undefined,
    "data-drop": over || undefined,
    onDragOver(e: React.DragEvent<HTMLElement>) {
      if (!drop?.accepts(key)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setMouseOver(true);
    },
    onDragLeave(e: React.DragEvent<HTMLElement>) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMouseOver(false);
    },
    onDrop(e: React.DragEvent<HTMLElement>) {
      setMouseOver(false);
      if (!drop?.accepts(key)) return;
      e.preventDefault();
      drop.drop(key);
    },
  };
}
