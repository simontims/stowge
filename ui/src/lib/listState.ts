/** The one "Loading" text used where there is no noun to put in it (counts, forms, small notes). */
export const LOADING_TEXT = "Loading…";

/** Text for a list that has nothing to show, and for its count. One rule for every list in the app:
 *  Loading first, then a load error, and only then "none". "None" is a claim about the server's
 *  answer, so it is never the default: until a load has succeeded the list is unknown, not empty. */
export function emptyListMessage({
  loading,
  error = "",
  search = "",
  noun,
  none,
  noMatch = `No ${noun} match your search.`,
}: {
  /** True until the answer to the query on screen has arrived (or failed). */
  loading: boolean;
  error?: string;
  search?: string;
  /** Plural, as written in the messages: "tags", "AI hints". */
  noun: string;
  /** Shown when the load succeeded and returned nothing. */
  none: string;
  noMatch?: string;
}): string {
  if (loading) return `Loading ${noun}...`;
  if (error) return error;
  return search.trim() ? noMatch : none;
}

/** "Loading…", or "3 tags" / "1 tag". */
export function countLabel(loading: boolean, count: number, singular: string, plural = `${singular}s`): string {
  if (loading) return LOADING_TEXT;
  return `${count} ${count === 1 ? singular : plural}`;
}
