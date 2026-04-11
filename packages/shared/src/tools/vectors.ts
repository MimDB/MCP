/**
 * @module tools/vectors
 * MCP tool definitions for MimDB pgvector operations (vector tables, similarity search).
 *
 * Registers five tools against an MCP server:
 * - `list_vector_tables` - enumerate all pgvector-enabled tables in the project
 * - `vector_search` - run a similarity search against a vector table
 * - `create_vector_table` - create a new pgvector-enabled table (write-mode only)
 * - `delete_vector_table` - delete a vector table (write-mode only)
 * - `create_vector_index` - create an HNSW index on a vector table (write-mode only)
 *
 * Read-only tools (`list_vector_tables`, `vector_search`) are always registered.
 * Write tools are only registered when `readOnly` is `false`.
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
import { formatMarkdownTable } from '../formatters.js'
import { formatToolError, formatValidationError } from '../errors.js'

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
// Shared schemas
// ---------------------------------------------------------------------------

/** Enum schema for the three supported pgvector distance metrics. */
const metricSchema = z.enum(['cosine', 'l2', 'inner_product'])

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

/**
 * Registers vector MCP tools on `server`.
 *
 * `list_vector_tables` and `vector_search` are always registered because they
 * are read-only operations. The three write tools (`create_vector_table`,
 * `delete_vector_table`, `create_vector_index`) are only registered when
 * `readOnly` is `false`.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls.
 * @param readOnly - When `true`, only read tools are registered.
 */
export function register(server: McpServer, client: MimDBClient, readOnly = false): void {
  // -------------------------------------------------------------------------
  // list_vector_tables
  // -------------------------------------------------------------------------

  server.tool(
    'list_vector_tables',
    'List all pgvector-enabled tables in the project, including their dimensions, distance metric, and current row count.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const tables = await client.vectors.listTables()
        const tableText = formatMarkdownTable(tables, ['name', 'dimensions', 'metric', 'row_count'])
        return ok(`Found ${tables.length} vector tables:\n\n${tableText}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // vector_search
  // -------------------------------------------------------------------------

  server.tool(
    'vector_search',
    'Run a similarity search against a pgvector table. Returns matching rows ordered by similarity score. ' +
      'Results are returned as JSON because each row includes a similarity score alongside user-defined columns.',
    {
      table: z.string().describe('Name of the vector table to search.'),
      vector: z.array(z.number()).describe('Query vector. Must have the same number of dimensions as the table.'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of results to return.'),
      threshold: z
        .number()
        .optional()
        .describe('Minimum similarity threshold. Results below this score are excluded.'),
      metric: metricSchema
        .optional()
        .describe('Distance metric for this query. Overrides the table default when specified.'),
      select: z
        .array(z.string())
        .optional()
        .describe('Subset of columns to return. Returns all columns when omitted.'),
      filter: z
        .record(z.unknown())
        .optional()
        .describe('Key-value filter applied to non-vector columns before similarity ranking.'),
    },
    async ({ table, vector, limit, threshold, metric, select, filter }): Promise<CallToolResult> => {
      try {
        const results = await client.vectors.search(table, {
          vector,
          limit,
          threshold,
          metric,
          select,
          filter,
        })
        const json = JSON.stringify(results, null, 2)
        return ok(`Found ${results.length} results:\n\n\`\`\`json\n${json}\n\`\`\``)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  if (readOnly) return

  // -------------------------------------------------------------------------
  // create_vector_table
  // -------------------------------------------------------------------------

  server.tool(
    'create_vector_table',
    'Create a new pgvector-enabled table in the project. An HNSW index is created automatically unless skip_index is set.',
    {
      name: z.string().describe('Name of the vector table to create.'),
      dimensions: z
        .number()
        .int()
        .positive()
        .describe('Number of dimensions in the vector column. Must match the embedding model output size.'),
      metric: metricSchema
        .optional()
        .describe('Distance metric for similarity search. Defaults to "cosine".'),
      columns: z
        .array(
          z.object({
            name: z.string().describe('Column name.'),
            type: z.string().describe('PostgreSQL type (e.g. "text", "int4", "jsonb").'),
            default: z.string().optional().describe('Optional default expression for the column.'),
          }),
        )
        .optional()
        .describe('Additional columns to include alongside the vector column.'),
    },
    async ({ name, dimensions, metric, columns }): Promise<CallToolResult> => {
      try {
        await client.vectors.createTable({ name, dimensions, metric, columns })
        return ok(`Vector table "${name}" created successfully with ${dimensions} dimensions.`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // delete_vector_table
  // -------------------------------------------------------------------------

  server.tool(
    'delete_vector_table',
    'Delete a pgvector table from the project. This is irreversible. ' +
      'The `confirm` parameter must exactly match the `table` name to prevent accidental deletion.',
    {
      table: z.string().describe('Name of the vector table to delete.'),
      confirm: z
        .string()
        .describe('Must exactly match `table`. Acts as a confirmation guard against accidental deletion.'),
      cascade: z
        .boolean()
        .optional()
        .describe('When true, also drops dependent objects such as views and foreign keys.'),
    },
    async ({ table, confirm, cascade }): Promise<CallToolResult> => {
      if (confirm !== table) {
        return errResult(
          formatValidationError(
            `Confirmation mismatch: "confirm" must exactly match the table name "${table}". ` +
              `Received "${confirm}". Re-issue the call with confirm set to "${table}".`,
          ),
        )
      }

      try {
        await client.vectors.deleteTable(table, confirm, cascade)
        return ok(`Vector table "${table}" deleted successfully.`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // create_vector_index
  // -------------------------------------------------------------------------

  server.tool(
    'create_vector_index',
    'Create an HNSW index on an existing vector table. ' +
      'Use this when a table was created with skip_index, or to replace an index with different parameters. ' +
      'Use concurrent: true to build the index without blocking reads or writes.',
    {
      table: z.string().describe('Name of the vector table to index.'),
      m: z
        .number()
        .int()
        .optional()
        .describe(
          'HNSW m parameter: number of bi-directional links per node. Higher values improve recall at the cost of memory.',
        ),
      ef_construction: z
        .number()
        .int()
        .optional()
        .describe(
          'HNSW ef_construction parameter: candidate list size during build. Higher values improve quality at the cost of build time.',
        ),
      concurrent: z
        .boolean()
        .optional()
        .describe('When true, builds the index concurrently without locking the table.'),
    },
    async ({ table, m, ef_construction, concurrent }): Promise<CallToolResult> => {
      try {
        await client.vectors.createIndex(table, { m, ef_construction, concurrent })
        return ok(`HNSW index created successfully on vector table "${table}".`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )
}
