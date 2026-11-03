/** Old bookmarks and PWA links filtered the list with `?collection=Name`. Collections are tags now,
 *  so the same link keeps working: `collection` becomes `tag` (`__none` stays `__none`), and every
 *  other parameter is kept. Returns the upgraded query string, or null when there is nothing to do. */
export function upgradeLegacyCollectionLink(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has("collection")) return null;
  const legacy = params.get("collection")?.trim() ?? "";
  params.delete("collection");
  if (legacy && !params.get("tag")?.trim()) params.set("tag", legacy);
  const next = params.toString();
  return next ? `?${next}` : "";
}
