/**
 * Byte-range bookkeeping for the download-engine chain.
 *
 * `RangeDownloadState` stores `[start, endExclusive)` pairs; the transport
 * recorder in the chain stores the same shape, so one set of helpers serves
 * both the engine's persisted state and the observed HTTP requests.
 */
export type InclusiveRange = [start: number, endInclusive: number];
export type ExclusiveRange = [start: number, endExclusive: number];

/** Sorts and merges overlapping/adjacent exclusive ranges. */
export const mergeExclusiveRanges = (
  ranges: readonly ExclusiveRange[]
): ExclusiveRange[] => {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged: ExclusiveRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
};

/** Whether `ranges` exactly tile `[0, total)` with no gap and no overlap. */
export const coversWholeFileExactly = (
  ranges: readonly ExclusiveRange[],
  total: number
): boolean => {
  const merged = mergeExclusiveRanges(ranges);
  return merged.length === 1 && merged[0][0] === 0 && merged[0][1] === total;
};

/**
 * Whether every range in `requests` lies fully inside one of the `holes`
 * (no byte outside the missing set is ever re-requested) — the resume stage
 * uses this to prove the engine only downloads what the persisted state says
 * is missing.
 */
export const everyRequestFitsInsideAHole = (
  requests: readonly ExclusiveRange[],
  holes: readonly ExclusiveRange[]
): boolean =>
  requests.every((request) =>
    holes.some((hole) => request[0] >= hole[0] && request[1] <= hole[1])
  );

/** Whether the requests pairwise share no byte (no duplicated ranges). */
export const requestsAreDisjoint = (
  requests: readonly ExclusiveRange[]
): boolean => mergeExclusiveRanges(requests).length === requests.length;
