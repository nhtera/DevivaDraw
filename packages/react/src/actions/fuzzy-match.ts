/**
 * Pure fuzzy-substring matcher for the command palette: `query`'s characters must all appear in
 * `text`, in order, case-insensitively — not necessarily contiguous (so `"rct"` matches `"Rectangle"`).
 * Deliberately simple (no scoring/ranking beyond "matched or not", results kept in registration
 * order): the action list is small enough (a few dozen entries) that a ranked fuzzy-score algorithm
 * would be YAGNI here.
 */
export function fuzzyMatch(query: string, text: string): boolean {
  if (query.length === 0) return true;
  const normalizedQuery = query.toLowerCase();
  const normalizedText = text.toLowerCase();
  let textIndex = 0;
  for (const char of normalizedQuery) {
    const found = normalizedText.indexOf(char, textIndex);
    if (found === -1) return false;
    textIndex = found + 1;
  }
  return true;
}
