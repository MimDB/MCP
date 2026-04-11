/**
 * @module tools/development
 * MCP tool definitions for MimDB development helpers.
 *
 * Registers two tools against an MCP server:
 * - `get_project_url` - return the project base URL and reference
 * - `generate_types` - generate TypeScript interfaces from the live schema
 *
 * Both tools are always registered (read-only and safe to expose in all modes).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { MimDBClient } from '../client/index.js'
import { MimDBApiError } from '../client/base.js'
import { formatToolError } from '../errors.js'

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

/**
 * Maps a PostgreSQL type name to the corresponding TypeScript type string.
 *
 * Covers the most common PG types. Any unrecognised type falls back to `unknown`.
 *
 * @param pgType - PostgreSQL type name as returned by the schema API.
 * @returns The TypeScript type string to emit.
 */
function pgTypeToTs(pgType: string): string {
  switch (pgType) {
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
      return 'number'

    case 'text':
    case 'varchar':
    case 'char':
    case 'name':
    case 'uuid':
    case 'bytea':
      return 'string'

    case 'bool':
      return 'boolean'

    case 'timestamp':
    case 'timestamptz':
    case 'date':
    case 'time':
      return 'string'

    case 'json':
    case 'jsonb':
      return 'unknown'

    default:
      return 'unknown'
  }
}

/**
 * Converts a snake_case or space/dash-separated table name to PascalCase.
 *
 * @param name - Raw table name (e.g. `"user_profiles"`, `"order-items"`).
 * @returns PascalCase interface name (e.g. `"UserProfiles"`, `"OrderItems"`).
 */
function toPascalCase(name: string): string {
  return name
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

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
 * Registers development MCP tools on `server`.
 *
 * All tools are registered unconditionally because they are read-only and do
 * not modify any server state.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls.
 */
export function register(server: McpServer, client: MimDBClient): void {
  // -------------------------------------------------------------------------
  // get_project_url
  // -------------------------------------------------------------------------

  server.tool(
    'get_project_url',
    'Return the base URL and short project reference (ref) for the current MimDB project. ' +
      'Useful for constructing API endpoints, connection strings, or sharing project identifiers.',
    {},
    async (): Promise<CallToolResult> => {
      const baseUrl = client.baseUrl
      const ref = client.projectRef ?? '(not set)'
      return ok(`Base URL: ${baseUrl}\nProject ref: ${ref}`)
    },
  )

  // -------------------------------------------------------------------------
  // generate_types
  // -------------------------------------------------------------------------

  server.tool(
    'generate_types',
    'Generate TypeScript interfaces for all tables in the project database. ' +
      'Introspects the live schema and maps PostgreSQL column types to TypeScript types. ' +
      'Nullable columns are typed as `T | null`.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const tables = await client.database.listTables()

        if (tables.length === 0) {
          return ok('// No tables found in the project database.')
        }

        const isoDate = new Date().toISOString()
        const lines: string[] = [
          '// Generated from MimDB project schema',
          `// ${isoDate}`,
        ]

        for (const table of tables) {
          try {
            const schema = await client.database.getTableSchema(table.name)

            lines.push('')
            lines.push(`export interface ${toPascalCase(schema.name)} {`)

            for (const col of schema.columns) {
              const tsType = pgTypeToTs(col.type)
              const typeAnnotation = col.nullable ? `${tsType} | null` : tsType
              lines.push(`  ${col.name}: ${typeAnnotation}`)
            }

            lines.push('}')
          } catch (err) {
            if (err instanceof MimDBApiError) {
              // Surface the per-table error as a comment and continue.
              lines.push('')
              lines.push(`// Error fetching schema for table "${table.name}": ${err.message}`)
            } else {
              throw err
            }
          }
        }

        return ok(lines.join('\n'))
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )
}
