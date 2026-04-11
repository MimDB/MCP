/**
 * @module client/stats
 * Domain client for MimDB observability operations.
 *
 * Wraps the `/v1/stats/{ref}/queries` endpoint and surfaces query performance
 * data from `pg_stat_statements` via a typed, promise-based interface.
 */

import type { BaseClient } from './base.js'
import type { QueryStat } from '../types.js'

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/**
 * Response returned by the query stats endpoint.
 */
interface QueryStatsResponse {
  /** Aggregated statistics for each unique normalized query. */
  queries: QueryStat[]
  /** Total number of unique queries tracked since stats were last reset. */
  total_queries: number
  /** ISO 8601 timestamp of the last stats reset, or null if never reset. */
  stats_reset: string | null
}

// ---------------------------------------------------------------------------
// StatsClient
// ---------------------------------------------------------------------------

/**
 * Client for MimDB observability operations.
 *
 * Provides access to `pg_stat_statements` query performance metrics.
 * Obtain an instance via {@link MimDBClient.stats}.
 *
 * @example
 * ```ts
 * const { queries, total_queries } = await client.stats.getQueryStats('total_time', 20)
 * ```
 */
export class StatsClient {
  /**
   * @param base - Shared HTTP transport used for all API calls.
   * @param ref - Short project reference included in API URL paths.
   */
  constructor(private readonly base: BaseClient, private readonly ref: string) {}

  /**
   * Fetches aggregated query statistics from `pg_stat_statements`.
   *
   * @param orderBy - Column to sort by: `'total_time'`, `'mean_time'`,
   *   `'calls'`, or `'rows'`. Defaults to server-side default when omitted.
   * @param limit - Maximum number of query entries to return.
   * @returns Query stats list with metadata including total count and reset timestamp.
   * @throws {MimDBApiError} On non-OK HTTP response or network failure.
   */
  async getQueryStats(
    orderBy?: string,
    limit?: number,
  ): Promise<QueryStatsResponse> {
    return this.base.get<QueryStatsResponse>(`/v1/stats/${this.ref}/queries`, {
      query: { order_by: orderBy, limit },
    })
  }
}
