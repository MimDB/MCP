/**
 * @module tools/debugging
 * MCP tool definitions for MimDB debugging utilities.
 *
 * Registers one tool against an MCP server:
 * - `get_query_stats` - surface top queries from `pg_stat_statements`
 *
 * The tool is always registered (read-only and safe to expose in all modes).
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { MimDBClient } from '../client/index.js'
import { MimDBApiError } from '../client/base.js'
import { formatMarkdownTable } from '../formatters.js'
import { formatToolError } from '../errors.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wraps pre-formatted text in a single-element {@link CallToolResult}.
 *
 * @param text - Pre-formatted text to return to the MCP client.
 * @returns A non-error {@link CallToolResult}.
 */
function ok(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

/**
 * Casts a local `ToolResult`-shaped object to {@link CallToolResult}.
 *
 * The local type lacks the SDK's index signature; this cast is safe because
 * the structures are compatible.
 *
 * @param result - A `ToolResult` from the errors module.
 * @returns The same value typed as {@link CallToolResult}.
 */
function errResult(result: { content: { type: 'text'; text: string }[]; isError?: boolean }): CallToolResult {
  return result as CallToolResult
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

/**
 * Registers debugging MCP tools on `server`.
 *
 * All tools are registered unconditionally because they are read-only and do
 * not modify any server state.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls.
 */
export function register(server: McpServer, client: MimDBClient): void {
  // -------------------------------------------------------------------------
  // get_query_stats
  // -------------------------------------------------------------------------

  server.tool(
    'get_query_stats',
    'Retrieve aggregated query performance statistics from pg_stat_statements. ' +
      'Shows the top queries by the selected metric so you can identify slow or ' +
      'frequently executed queries.',
    {
      order_by: z
        .enum(['total_time', 'mean_time', 'calls', 'rows'])
        .optional()
        .describe(
          'Metric to sort results by. ' +
            '"total_time" finds queries consuming the most cumulative time. ' +
            '"mean_time" finds the slowest individual queries. ' +
            '"calls" finds the most frequently executed queries. ' +
            '"rows" finds queries returning or affecting the most rows.',
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of query entries to return. Defaults to server-side default when omitted.'),
    },
    async ({ order_by, limit }): Promise<CallToolResult> => {
      try {
        const { queries, total_queries, stats_reset } = await client.stats.getQueryStats(order_by, limit)

        const headerParts: string[] = [`Total tracked queries: ${total_queries}`]
        if (stats_reset) {
          headerParts.push(`Stats reset: ${stats_reset}`)
        }
        const header = headerParts.join(' | ')

        if (queries.length === 0) {
          return ok(`${header}\n\nNo query statistics available.`)
        }

        const table = formatMarkdownTable(queries, ['query', 'calls', 'total_time', 'mean_time', 'rows'])
        return ok(`${header}\n\n${table}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )
}
