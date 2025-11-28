import { SourcePeriod } from "../../../types";
/**
 * Fetches a source period document by its period ID
 *
 * Source periods are the single source of truth for period definitions.
 * Examples: "2025-M11", "2025-W45", "2025-BM11-A"
 *
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @returns The SourcePeriod document
 * @throws Error if the source period is not found
 */
export declare function fetchSourcePeriod(sourcePeriodId: string): Promise<SourcePeriod>;
//# sourceMappingURL=fetchSourcePeriod.d.ts.map