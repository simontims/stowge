import type { ComponentType } from "react";
import type { WhatsNewNote } from "./types";

/** A guided tour for one What's New note, shown on request ("Show me"). */
export type WhatsNewTour = ComponentType<{ onDone: () => void }>;

export interface WhatsNewDigest {
  /** Notes worth interrupting for, oldest first. */
  interrupts: WhatsNewNote[];
  /** Other unseen notes: only counted, never shown as a card entry. */
  smaller: WhatsNewNote[];
}

/** Split what a user hasn't seen into the card entries and the "smaller changes" count.
 *  The server has already dropped anything a newer unseen note replaced. */
export function buildDigest(unseen: readonly WhatsNewNote[]): WhatsNewDigest {
  return {
    interrupts: unseen.filter((note) => note.severity === "interrupt"),
    smaller: unseen.filter((note) => note.severity !== "interrupt"),
  };
}

export function digestHeading(digest: WhatsNewDigest): string {
  const count = digest.interrupts.length;
  return count === 1 ? "1 thing changed since you were last here" : `${count} things changed since you were last here`;
}

export interface VersionGroup<T extends { version: string }> {
  version: string;
  notes: T[];
}

/** Group notes by release version, keeping the input order (newest first) for both the groups
 *  and the notes inside them. */
export function groupByVersion<T extends { version: string }>(notes: readonly T[]): VersionGroup<T>[] {
  const groups: VersionGroup<T>[] = [];
  for (const note of notes) {
    const last = groups.find((group) => group.version === note.version);
    if (last) last.notes.push(note);
    else groups.push({ version: note.version, notes: [note] });
  }
  return groups;
}
