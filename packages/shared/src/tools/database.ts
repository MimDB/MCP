/**
 * @module tools/database
 * MCP tool definitions for MimDB database operations.
 *
 * Registers four tools against an MCP server:
 * - `list_tables` - enumerate all tables in the project database
 * - `get_table_schema` - fetch columns, constraints, and indexes for a table
 * - `execute_sql` - run a SQL query with optional read-only enforcement
 * - `execute_sql_dry_run` - run a SQL query inside a rolled-back transaction
 *
 * All tools follow the same pattern: validate input, call the domain client,
 * format the result for the AI, and surface {@link MimDBApiError} as a
 * structured result rather than letting it propagate.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { MimDBClient } from '../client/index.js'
import { MimDBApiError } from '../client/base.js'
import { formatSqlResult, formatMarkdownTable, wrapSqlOutput } from '../formatters.js'
import { formatToolError, formatValidationError } from '../errors.js'
import { classifySql, SqlClassification } from '../sql-classifier.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed query size in bytes (64 KiB). */
const MAX_QUERY_BYTES = 64 * 1024

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Measures the UTF-8 byte length of a string without Node.js `Buffer`.
 * Uses `TextEncoder` which is available in all ES2022+ and browser runtimes.
 *
 * @param str - The string to measure.
 * @returns Number of bytes when the string is encoded as UTF-8.
 */
function utf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).byteLength
}

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
 * Wraps the result of {@link formatToolError} or {@link formatValidationError}
 * as a {@link CallToolResult} for the MCP protocol.
 *
 * Our local `ToolResult` type is structurally identical to `CallToolResult`
 * but lacks the SDK's index signature. This cast is safe.
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
 * Registers database MCP tools on `server`.
 *
 * All four tools are registered regardless of `readOnly`. The `execute_sql`
 * tool self-enforces the read-only constraint at call time. The
 * `execute_sql_dry_run` tool is always safe because it wraps every query in
 * a rolled-back transaction.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls.
 * @param readOnly - When `true`, `execute_sql` rejects write statements and
 *   prepends `SET TRANSACTION READ ONLY;` to reads.
 */
export function register(server: McpServer, client: MimDBClient, readOnly = false): void {
  // -------------------------------------------------------------------------
  // list_tables
  // -------------------------------------------------------------------------

  server.tool(
    'list_tables',
    'List all tables in the project database, including their schema, column count, and estimated row count.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const tables = await client.database.listTables()
        const tableText = formatMarkdownTable(tables, ['name', 'schema', 'columns', 'estimated_rows'])
        return ok(`Found ${tables.length} tables:\n\n${tableText}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // get_table_schema
  // -------------------------------------------------------------------------

  server.tool(
    'get_table_schema',
    'Get detailed schema information for a table: columns (name, type, nullability, defaults, primary key), constraints (primary key, foreign keys, unique, check), and indexes.',
    {
      table: z.string().describe('Table name, optionally schema-qualified (e.g. "public.users").'),
    },
    async ({ table }): Promise<CallToolResult> => {
      try {
        const schema = await client.database.getTableSchema(table)

        const columnsTable = formatMarkdownTable(schema.columns, [
          'name',
          'type',
          'nullable',
          'default_value',
          'is_primary_key',
        ])

        const constraintsTable =
          schema.constraints.length > 0
            ? formatMarkdownTable(schema.constraints, [
                'name',
                'type',
                'columns',
                'foreign_table',
                'foreign_columns',
              ])
            : 'No constraints.'

        const indexesTable =
          schema.indexes.length > 0
            ? formatMarkdownTable(schema.indexes, ['name', 'columns', 'unique', 'type'])
            : 'No indexes.'

        const text = [
          `## ${schema.schema}.${schema.name}`,
          '',
          '### Columns',
          columnsTable,
          '',
          '### Constraints',
          constraintsTable,
          '',
          '### Indexes',
          indexesTable,
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

  // -------------------------------------------------------------------------
  // execute_sql
  // -------------------------------------------------------------------------

  server.tool(
    'execute_sql',
    'Execute a SQL query against the project database and return the result set as a markdown table. ' +
      (readOnly
        ? 'The server is in read-only mode: write statements are rejected and reads are wrapped in SET TRANSACTION READ ONLY.'
        : 'Supports both read and write statements.'),
    {
      query: z.string().describe('SQL query or statement to execute.'),
      params: z
        .array(z.unknown())
        .optional()
        .describe('Optional positional parameters bound to $1, $2, \u2026 placeholders.'),
    },
    async ({ query, params }): Promise<CallToolResult> => {
      const byteLen = utf8ByteLength(query)
      if (byteLen > MAX_QUERY_BYTES) {
        return errResult(
          formatValidationError(
            `Query exceeds the 64 KiB limit (${byteLen} bytes). Break the query into smaller parts.`,
          ),
        )
      }

      let finalQuery = query

      if (readOnly) {
        const classification = classifySql(query)
        if (classification === SqlClassification.Write) {
          return errResult(
            formatValidationError(
              'Write statements are not allowed in read-only mode. ' +
                'Only SELECT, SHOW, and EXPLAIN queries are permitted. ' +
                'Use execute_sql_dry_run to preview write operations without persisting changes.',
            ),
          )
        }
        // Prepend SET TRANSACTION READ ONLY for the database-level guardrail.
        finalQuery = `SET TRANSACTION READ ONLY; ${query}`
      }

      try {
        const result = await client.database.executeSql(finalQuery, params)
        return ok(wrapSqlOutput(formatSqlResult(result)))
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // execute_sql_dry_run
  // -------------------------------------------------------------------------

  server.tool(
    'execute_sql_dry_run',
    'Execute a SQL query inside a BEGIN READ ONLY \u2026 ROLLBACK block. ' +
      'All changes are rolled back so nothing is persisted. ' +
      'Useful for previewing DML (INSERT, UPDATE, DELETE) or validating query plans. ' +
      'Note: volatile functions (e.g. nextval, gen_random_uuid) may still advance their state even though the transaction is rolled back.',
    {
      query: z.string().describe('SQL query or statement to preview.'),
      params: z
        .array(z.unknown())
        .optional()
        .describe('Optional positional parameters bound to $1, $2, \u2026 placeholders.'),
    },
    async ({ query, params }): Promise<CallToolResult> => {
      const byteLen = utf8ByteLength(query)
      if (byteLen > MAX_QUERY_BYTES) {
        return errResult(
          formatValidationError(
            `Query exceeds the 64 KiB limit (${byteLen} bytes). Break the query into smaller parts.`,
          ),
        )
      }

      const wrappedQuery = `BEGIN READ ONLY; ${query}; ROLLBACK;`

      try {
        const result = await client.database.executeSql(wrappedQuery, params)
        return ok(`[DRY RUN - rolled back]\n${wrapSqlOutput(formatSqlResult(result))}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )
}
