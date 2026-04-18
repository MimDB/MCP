/**
 * @module errors
 * Error classification and formatting utilities for MCP tool handlers.
 *
 * Provides a two-step pattern for surfacing MimDB API errors to MCP clients:
 * 1. {@link classifyError} - determines the category from an HTTP status code
 * 2. {@link formatToolError} - builds an actionable {@link ToolResult} with
 *    category-specific guidance for the MCP client
 *
 * Also provides {@link formatValidationError} for input-validation failures
 * that occur before a network request is made.
 */

import type { ApiError, ToolResult } from './types.js'

// ---------------------------------------------------------------------------
// Error category
// ---------------------------------------------------------------------------

/**
 * High-level error category used to guide the MCP client's response.
 *
 * - `platform` - server-side or network failure; do not retry automatically
 * - `auth` - credentials are missing or insufficient
 * - `operational` - well-formed request rejected for a business reason
 * - `validation` - the tool's input parameters were invalid
 */
export type ErrorCategory = 'platform' | 'auth' | 'operational' | 'validation'

/**
 * Maps an HTTP status code to a broad {@link ErrorCategory}.
 *
 * | Status | Category |
 * |--------|----------|
 * | 401, 403 | `auth` |
 * | 0 (network) | `platform` |
 * | 500+ with structured `apiError.code` | `operational` |
 * | 500+ without structured code | `platform` |
 * | everything else | `operational` |
 *
 * A structured `apiError.code` (e.g. `SQL-0004`) signals that the server
 * produced a deliberate, application-level error rather than crashing or
 * becoming unreachable. Reclassifying those 5xx responses as `operational`
 * prevents the misleading "platform unreachable, do not retry" hint from
 * being shown for what are really query-level failures the user can act on.
 *
 * @param status - HTTP status code, or 0 for network-level failures.
 * @param apiError - Optional structured error envelope from the API response.
 *   When present and `status >= 500`, the response is treated as operational.
 * @returns The appropriate {@link ErrorCategory}.
 *
 * @example
 * ```ts
 * classifyError(401)                                // -> 'auth'
 * classifyError(500)                                // -> 'platform' (no envelope = real outage)
 * classifyError(500, { code: 'SQL-0004', message })// -> 'operational' (server-reported error)
 * classifyError(404)                                // -> 'operational'
 * classifyError(0)                                  // -> 'platform'
 * ```
 */
export function classifyError(status: number, apiError?: ApiError): ErrorCategory {
  if (status === 401 || status === 403) return 'auth'
  if (status === 0) return 'platform'
  if (status >= 500) {
    return apiError?.code ? 'operational' : 'platform'
  }
  return 'operational'
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Builds a category-specific hint sentence for the given status code.
 * @param status - HTTP status code.
 * @param category - Pre-classified error category.
 * @param baseUrl - Optional base URL to include in platform errors.
 */
function buildHint(status: number, category: ErrorCategory, baseUrl?: string): string {
  switch (category) {
    case 'auth':
      return 'Verify that MIMDB_SERVICE_ROLE_KEY is set correctly and has not expired.'

    case 'platform': {
      const urlPart = baseUrl
        ? `Ensure MIMDB_URL (${baseUrl}) is reachable and the server is running.`
        : 'Ensure MIMDB_URL is reachable and the server is running.'
      return `${urlPart} Do not retry automatically.`
    }

    case 'operational': {
      if (status === 404) {
        return 'The requested resource was not found. Use list_tables to discover available tables and verify the resource name.'
      }
      if (status === 408) {
        return 'The request timed out. Consider adding indexes to improve query performance or reduce the result set size.'
      }
      if (status === 429) {
        return 'Rate limit reached. Try again shortly.'
      }
      return 'The request was rejected by the server. Check the error details for guidance.'
    }

    case 'validation':
      // Validation hints are handled separately in formatValidationError.
      return ''
  }
}

/**
 * Formats a MimDB API error into a {@link ToolResult} with an actionable
 * message tagged by its {@link ErrorCategory}.
 *
 * The returned `text` field always starts with `[Error: <category>]` so that
 * MCP clients can parse the category programmatically if needed.
 *
 * @param status - HTTP status code returned by the API (or 0 for network errors).
 * @param apiError - Optional structured error from the API response body.
 * @param baseUrl - Optional base URL included in platform error messages.
 * @returns A {@link ToolResult} with `isError: true`.
 *
 * @example
 * ```ts
 * const result = formatToolError(401, { code: 'ERR_UNAUTHORIZED', message: 'Invalid key' })
 * // result.content[0].text starts with '[Error: auth]'
 * ```
 */
export function formatToolError(
  status: number,
  apiError?: ApiError,
  baseUrl?: string,
): ToolResult {
  const category = classifyError(status, apiError)
  const hint = buildHint(status, category, baseUrl)

  const parts: string[] = [`[Error: ${category}]`]

  if (apiError?.code) {
    parts.push(`(${apiError.code})`)
  }

  if (apiError?.message) {
    parts.push(apiError.message)
  }

  // Server-provided detail (e.g. the real PostgreSQL error message behind
  // a generic "Query execution failed") is the most actionable part of the
  // response, so it goes before the category hint.
  if (apiError?.detail) {
    parts.push(`- ${apiError.detail}`)
  }

  if (hint) {
    parts.push(hint)
  }

  return {
    content: [{ type: 'text', text: parts.join(' ') }],
    isError: true,
  }
}

/**
 * Formats an input-validation failure into a {@link ToolResult}.
 *
 * Use this when tool parameters fail validation before any API call is made.
 * The returned message is prefixed with `[Error: validation]`.
 *
 * @param message - Human-readable description of the validation failure.
 * @returns A {@link ToolResult} with `isError: true`.
 *
 * @example
 * ```ts
 * formatValidationError('table_name must not be empty')
 * // -> { content: [{ type: 'text', text: '[Error: validation] table_name must not be empty' }], isError: true }
 * ```
 */
export function formatValidationError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `[Error: validation] ${message}` }],
    isError: true,
  }
}
