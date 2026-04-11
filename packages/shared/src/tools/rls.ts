/**
 * @module tools/rls
 * MCP tool definitions for MimDB Row-Level Security (RLS) policy management.
 *
 * Registers up to four tools against an MCP server:
 * - `list_policies` - enumerate all RLS policies on a table
 * - `create_policy` - create a new RLS policy on a table (write-only)
 * - `update_policy` - update an existing RLS policy (write-only)
 * - `delete_policy` - delete an RLS policy from a table (write-only)
 *
 * All tools require `MIMDB_PROJECT_REF` to resolve the project UUID via the
 * platform client. Write tools are only registered when `readOnly` is false.
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
 * Registers RLS policy MCP tools on `server`.
 *
 * `list_policies` is always registered. Write tools (`create_policy`,
 * `update_policy`, `delete_policy`) are only registered when `readOnly` is false.
 *
 * All tools resolve the project UUID from `client.projectRef` at call time via
 * {@link PlatformClient.resolveRefToId}.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls. Must have `projectRef` set.
 * @param readOnly - When `true`, write tools are not registered.
 */
export function register(server: McpServer, client: MimDBClient, readOnly = false): void {
  /**
   * Resolves the configured project ref to a UUID.
   * Throws a descriptive error if no ref is configured.
   *
   * @returns The project UUID.
   * @throws {Error} If `MIMDB_PROJECT_REF` is not set on the client.
   */
  const getProjectId = async (): Promise<string> => {
    if (!client.projectRef) throw new Error('RLS tools require MIMDB_PROJECT_REF')
    return client.platform.resolveRefToId(client.projectRef)
  }

  // -------------------------------------------------------------------------
  // list_policies
  // -------------------------------------------------------------------------

  server.tool(
    'list_policies',
    'List all Row-Level Security (RLS) policies defined on a database table.',
    {
      table: z
        .string()
        .describe('Table name, optionally schema-qualified (e.g. "public.users").'),
    },
    async ({ table }): Promise<CallToolResult> => {
      try {
        const projectId = await getProjectId()
        const policies = await client.platform.listPolicies(projectId, table)
        const tableText = formatMarkdownTable(policies, [
          'name',
          'command',
          'permissive',
          'roles',
          'using',
          'check',
        ])
        return ok(`Found ${policies.length} RLS policy(ies) on "${table}":\n\n${tableText}`)
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
  // create_policy
  // -------------------------------------------------------------------------

  server.tool(
    'create_policy',
    'Create a new Row-Level Security (RLS) policy on a database table.',
    {
      table: z
        .string()
        .describe('Table name, optionally schema-qualified (e.g. "public.users").'),
      name: z.string().describe('Policy name (must be unique within the table).'),
      command: z
        .enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL'])
        .optional()
        .describe('SQL command the policy applies to. Defaults to "ALL" if omitted.'),
      permissive: z
        .boolean()
        .optional()
        .describe(
          'Whether the policy is PERMISSIVE (true, default) or RESTRICTIVE (false). ' +
            'Permissive policies are combined with OR; restrictive policies are combined with AND.',
        ),
      roles: z
        .array(z.string())
        .optional()
        .describe('Roles the policy applies to. Omit to apply to all roles.'),
      using: z
        .string()
        .optional()
        .describe('USING expression: a boolean SQL expression that filters rows for reads.'),
      check: z
        .string()
        .optional()
        .describe(
          'WITH CHECK expression: a boolean SQL expression that validates rows for writes.',
        ),
    },
    async ({ table, name, command, permissive, roles, using, check }): Promise<CallToolResult> => {
      try {
        const projectId = await getProjectId()
        const policy = await client.platform.createPolicy(projectId, table, {
          name,
          command,
          permissive,
          roles,
          using,
          check,
        })
        const tableText = formatMarkdownTable([policy], [
          'name',
          'command',
          'permissive',
          'roles',
          'using',
          'check',
        ])
        return ok(`RLS policy "${name}" created on "${table}":\n\n${tableText}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // update_policy
  // -------------------------------------------------------------------------

  server.tool(
    'update_policy',
    'Update an existing Row-Level Security (RLS) policy on a database table.',
    {
      table: z
        .string()
        .describe('Table name, optionally schema-qualified (e.g. "public.users").'),
      name: z.string().describe('Name of the policy to update.'),
      roles: z
        .array(z.string())
        .optional()
        .describe('New roles the policy should apply to.'),
      using: z.string().optional().describe('New USING expression for row-level read filtering.'),
      check: z
        .string()
        .optional()
        .describe('New WITH CHECK expression for write validation.'),
    },
    async ({ table, name, roles, using, check }): Promise<CallToolResult> => {
      try {
        const projectId = await getProjectId()
        const policy = await client.platform.updatePolicy(projectId, table, name, {
          roles,
          using,
          check,
        })
        const tableText = formatMarkdownTable([policy], [
          'name',
          'command',
          'permissive',
          'roles',
          'using',
          'check',
        ])
        return ok(`RLS policy "${name}" on "${table}" updated:\n\n${tableText}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // delete_policy
  // -------------------------------------------------------------------------

  server.tool(
    'delete_policy',
    'Delete a Row-Level Security (RLS) policy from a database table.',
    {
      table: z
        .string()
        .describe('Table name, optionally schema-qualified (e.g. "public.users").'),
      name: z.string().describe('Name of the policy to delete.'),
    },
    async ({ table, name }): Promise<CallToolResult> => {
      try {
        const projectId = await getProjectId()
        await client.platform.deletePolicy(projectId, table, name)
        return ok(`RLS policy "${name}" deleted from "${table}".`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )
}
