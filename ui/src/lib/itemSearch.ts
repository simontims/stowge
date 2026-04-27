export interface MatchSegment {
  text: string;
  matched: boolean;
}

export function normalizeSearchTerm(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function splitMatchSegments(value: string, query: string): MatchSegment[] {
  if (!value) return [];

  const normalizedQuery = normalizeSearchTerm(query);
  if (!normalizedQuery) return [{ text: value, matched: false }];

  const normalizedValue = value.toLocaleLowerCase();
  const segments: MatchSegment[] = [];
  let start = 0;

  while (start < value.length) {
    const matchIndex = normalizedValue.indexOf(normalizedQuery, start);
    if (matchIndex === -1) {
      segments.push({ text: value.slice(start), matched: false });
      break;
    }
    if (matchIndex > start) {
      segments.push({ text: value.slice(start, matchIndex), matched: false });
    }
    const end = matchIndex + normalizedQuery.length;
    segments.push({ text: value.slice(matchIndex, end), matched: true });
    start = end;
  }

  return segments;
}

export function buildCenteredExcerpt(value: string | null | undefined, query: string, targetLength: number): string | null {
  const normalizedQuery = normalizeSearchTerm(query);
  const compactValue = (value || "").replace(/\s+/g, " ").trim();
  if (!compactValue || !normalizedQuery) return null;

  const normalizedValue = compactValue.toLocaleLowerCase();
  const matchIndex = normalizedValue.indexOf(normalizedQuery);
  if (matchIndex === -1) return null;

  if (compactValue.length <= targetLength) return compactValue;

  const matchCenter = matchIndex + Math.floor(normalizedQuery.length / 2);
  let start = Math.max(0, matchCenter - Math.floor(targetLength / 2));
  let end = Math.min(compactValue.length, start + targetLength);
  start = Math.max(0, end - targetLength);

  const prefix = start > 0 ? "..." : "";
  const suffix = end < compactValue.length ? "..." : "";

  return `${prefix}${compactValue.slice(start, end).trim()}${suffix}`;
}