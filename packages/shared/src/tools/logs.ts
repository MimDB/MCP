/**
 * @module tools/logs
 * MCP tool definitions for MimDB structured log retrieval.
 *
 * Registers one tool against an MCP server:
 * - `get_logs` - fetch structured log entries for the current project with
 *   optional filtering by level, service, HTTP method, status code range,
 *   and time window.
 *
 * The tool requires `MIMDB_PROJECT_REF` to resolve the project UUID via the
 * platform client. It is always registered (read-only safe).
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
 * Wraps formatted text in a single-element {@link CallToolResult}.
 *
 * @param text - Pre-formatted text to return to the MCP client.
 * @returns A non-error {@link CallToolResult}.
 */
function ok(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

/**
 * Wraps a ToolResult-shaped object as a {@link CallToolResult}.
 *
 * @param result - A ToolResult from the errors module.
 * @returns The same value typed as {@link CallToolResult}.
 */
function errResult(result: { content: { type: 'text'; text: string }[]; isError?: boolean }): CallToolResult {
  return result as CallToolResult
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

/**
 * Registers log retrieval MCP tools on `server`.
 *
 * `get_logs` is always registered regardless of the `readOnly` flag because
 * log retrieval is a read-only operation.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls. Must have `projectRef` set.
 * @param _readOnly - Unused; included for interface consistency with other tool modules.
 */
export function register(server: McpServer, client: MimDBClient, _readOnly = false): void {
  /**
   * Resolves the configured project ref to a UUID.
   *
   * @returns The project UUID.
   * @throws {Error} If `MIMDB_PROJECT_REF` is not set on the client.
   */
  const getProjectId = async (): Promise<string> => {
    if (!client.projectRef) throw new Error('Logs tools require MIMDB_PROJECT_REF')
    return client.platform.resolveRefToId(client.projectRef)
  }

  // -------------------------------------------------------------------------
  // get_logs
  // -------------------------------------------------------------------------

  server.tool(
    'get_logs',
    'Retrieve structured log entries for the current project. ' +
      'Supports filtering by severity level, service, HTTP method, status code range, and time window.',
    {
      level: z
        .enum(['error', 'warn', 'info'])
        .optional()
        .describe('Severity level to filter by: "error", "warn", or "info".'),
      service: z
        .string()
        .optional()
        .describe('Service or subsystem name to filter by (e.g. "api", "storage").'),
      method: z
        .string()
        .optional()
        .describe('HTTP method to filter by (e.g. "GET", "POST").'),
      status_min: z
        .number()
        .int()
        .optional()
        .describe('Minimum HTTP response status code (inclusive). E.g. 400 to see client errors.'),
      status_max: z
        .number()
        .int()
        .optional()
        .describe('Maximum HTTP response status code (inclusive). E.g. 499 to cap at client errors.'),
      since: z
        .string()
        .optional()
        .describe('ISO 8601 start timestamp, inclusive (e.g. "2024-01-01T00:00:00Z").'),
      until: z
        .string()
        .optional()
        .describe('ISO 8601 end timestamp, inclusive (e.g. "2024-01-02T00:00:00Z").'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe('Maximum number of log entries to return (1-1000).'),
    },
    async ({
      level,
      service,
      method,
      status_min,
      status_max,
      since,
      until,
      limit,
    }): Promise<CallToolResult> => {
      try {
        const projectId = await getProjectId()
        const entries = await client.platform.getLogs(projectId, {
          level,
          service,
          method,
          status_min,
          status_max,
          since,
          until,
          limit,
        })
        const tableText = formatMarkdownTable(entries, [
          'timestamp',
          'level',
          'method',
          'path',
          'status',
          'duration_ms',
          'message',
        ])
        return ok(`Found ${entries.length} log entry(ies):\n\n${tableText}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )
}
