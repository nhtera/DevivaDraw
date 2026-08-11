/**
 * Edge-crossing counting for the ordering stage. `rankPairCrossings` counts crossings between two
 * adjacent ranks by listing the lower-rank positions of every segment in upper order (segments from
 * the same upper node sorted by lower position, since those never cross each other) and counting
 * inversions. `countCrossings` sums that over the whole layout. O(E²) per pair — fine at flowchart
 * scale and dependency-free.
 */
export function rankPairCrossings(upper: string[], lower: string[], down: Map<string, string[]>): number {
  const lowerPos = new Map(lower.map((id, i) => [id, i]));
  const seq: number[] = [];
  for (const u of upper) {
    const positions = (down.get(u) ?? [])
      .map((v) => lowerPos.get(v))
      .filter((p): p is number => p !== undefined)
      .sort((a, b) => a - b); // edges from one node don't cross each other
    seq.push(...positions);
  }
  let crossings = 0;
  for (let i = 0; i < seq.length; i++) {
    for (let j = i + 1; j < seq.length; j++) {
      if (seq[i]! > seq[j]!) crossings++;
    }
  }
  return crossings;
}

export function countCrossings(ranks: string[][], down: Map<string, string[]>): number {
  let total = 0;
  for (let r = 0; r < ranks.length - 1; r++) total += rankPairCrossings(ranks[r]!, ranks[r + 1]!, down);
  return total;
}
