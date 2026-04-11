/**
 * @module tools/keys
 * MCP tool definitions for MimDB API key management.
 *
 * Registers up to two tools against an MCP server:
 * - `get_api_keys` - fetch API key metadata for the current project
 * - `regenerate_api_keys` - rotate all API keys for the current project (write-only)
 *
 * All tools require `MIMDB_PROJECT_REF` to resolve the project UUID via the
 * platform client. The write tool is only registered when `readOnly` is false.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { MimDBClient } from '../client/index.js'
import { MimDBApiError } from '../client/base.js'
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
 * Registers API key management MCP tools on `server`.
 *
 * `get_api_keys` is always registered. `regenerate_api_keys` is only
 * registered when `readOnly` is false.
 *
 * Both tools resolve the project UUID from `client.projectRef` at call time
 * via {@link PlatformClient.resolveRefToId}.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls. Must have `projectRef` set.
 * @param readOnly - When `true`, write tools are not registered.
 */
export function register(server: McpServer, client: MimDBClient, readOnly = false): void {
  /**
   * Resolves the configured project ref to a UUID.
   *
   * @returns The project UUID.
   * @throws {Error} If `MIMDB_PROJECT_REF` is not set on the client.
   */
  const getProjectId = async (): Promise<string> => {
    if (!client.projectRef) throw new Error('Key tools require MIMDB_PROJECT_REF')
    return client.platform.resolveRefToId(client.projectRef)
  }

  // -------------------------------------------------------------------------
  // get_api_keys
  // -------------------------------------------------------------------------

  server.tool(
    'get_api_keys',
    'Get API key metadata for the current project. ' +
      'Returns key names, prefixes, and roles. Raw key values are not shown; ' +
      'use regenerate_api_keys to rotate keys and receive new raw values.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const projectId = await getProjectId()
        const keys = await client.platform.getApiKeys(projectId)
        const lines = [
          'Project API keys:',
          '',
          '| Key | Type |',
          '| --- | --- |',
          `| \`${keys.anon_key.slice(0, 20)}...\` | anon |`,
          `| \`${keys.service_role_key.slice(0, 20)}...\` | service_role |`,
          '',
          '> Full key values are JWT tokens. Use select_project to connect with service_role access.',
        ]
        return ok(lines.join('\n'))
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // Write tools (readOnly=false only)
  // -------------------------------------------------------------------------

  if (readOnly) return

  // -------------------------------------------------------------------------
  // regenerate_api_keys
  // -------------------------------------------------------------------------

  server.tool(
    'regenerate_api_keys',
    'WARNING: Rotate the project signing key. This invalidates ALL existing API keys and tokens immediately. ' +
      'Any clients still using the old keys will receive 401 errors. ' +
      'New raw key values are returned and shown only once — save them securely.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const projectId = await getProjectId()
        const keys = await client.platform.regenerateApiKeys(projectId)
        const text = [
          'API keys rotated. All previous keys and tokens are now **invalid**.',
          '',
          '## New Keys',
          '',
          `**Anon key:** \`${keys.anon_key}\``,
          '',
          `**Service role key:** \`${keys.service_role_key}\``,
          '',
          '> **WARNING:** These keys are generated from the new signing secret.',
          '> Any clients using old keys will receive 401 errors immediately.',
          '> Save these keys in a secure secrets manager.',
        ].join('\n')
        return ok(text)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )
}
