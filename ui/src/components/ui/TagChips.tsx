import clsx from "clsx";
import { TablerIcon } from "./TablerIcon";
import type { ItemTag } from "../../lib/types";

interface TagChipProps {
  tag: Pick<ItemTag, "name" | "icon" | "color">;
  small?: boolean;
  /** Renders a remove button after the name (used in the picker). */
  onRemove?: () => void;
}

/** One tag as a small chip: its icon (if it has one) in its colour, then the name. */
export function TagChip({ tag, small = false, onRemove }: TagChipProps) {
  return (
    <span
      data-testid="tag-chip"
      className={clsx(
        "inline-flex max-w-full items-center gap-1 rounded border border-border-strong bg-surface-2 text-secondary",
        small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs",
      )}
    >
      {tag.icon && <TablerIcon name={tag.icon} size={small ? 10 : 12} color={tag.color} />}
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag.name}`}
          className="-mr-0.5 ml-0.5 rounded px-0.5 text-subtle hover:text-heading"
        >
          ×
        </button>
      )}
    </span>
  );
}

interface TagChipsProps {
  tags: ItemTag[] | null | undefined;
  /** Shown when there are no tags. */
  emptyLabel?: string;
  small?: boolean;
}

/** Read-only list of an item's tags. */
export function TagChips({ tags, emptyLabel = "No tags", small = false }: TagChipsProps) {
  if (!tags || tags.length === 0) {
    return <span className="text-xs text-faint">{emptyLabel}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} small={small} />
      ))}
    </span>
  );
}
