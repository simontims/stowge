import { useMemo, useState } from "react";
import { TagChip } from "./TagChips";
import type { Tag } from "../../lib/types";

interface TagPickerProps {
  /** Every tag that can be picked. Tags are made on the Tags page, never here. */
  tags: Tag[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
}

/** Multi-select tag chips with a type-ahead search. Picking adds a chip; the x on a chip removes it. */
export function TagPicker({ tags, selectedIds, onChange, disabled = false, label = "Tags" }: TagPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => selectedIds.map((id) => tags.find((tag) => tag.id === id)).filter((tag): tag is Tag => Boolean(tag)),
    [selectedIds, tags],
  );

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return tags.filter((tag) => !selectedIds.includes(tag.id) && (!term || tag.name.toLowerCase().includes(term)));
  }, [query, selectedIds, tags]);

  function add(tag: Tag) {
    onChange([...selectedIds, tag.id]);
    setQuery("");
  }

  function remove(id: string) {
    onChange(selectedIds.filter((existing) => existing !== id));
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 focus-within:border-neutral-500"
      >
        {selected.map((tag) => (
          <TagChip key={tag.id} tag={tag} onRemove={disabled ? undefined : () => remove(tag.id)} />
        ))}
        <input
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          value={query}
          placeholder={selected.length === 0 ? "Add tags…" : ""}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (matches[0]) add(matches[0]);
            } else if (event.key === "Backspace" && !query && selectedIds.length > 0) {
              remove(selectedIds[selectedIds.length - 1]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          className="min-w-[6rem] flex-1 bg-transparent py-0.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
        />
      </div>

      {open && !disabled && (
        <ul
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-500">
              {tags.length === 0 ? "No tags yet. Make them on the Tags page." : "No matching tags."}
            </li>
          ) : (
            matches.map((tag) => (
              <li
                key={tag.id}
                role="option"
                aria-selected="false"
                // mousedown fires before the input's blur closes the list, so the pick lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  add(tag);
                }}
                className="cursor-pointer px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                {tag.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
