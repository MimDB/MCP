/**
 * @module client/database
 * Domain client for MimDB database operations: table discovery, schema
 * introspection, and SQL execution.
 *
 * This client is a thin HTTP wrapper. All request routing and auth header
 * injection is handled by the injected {@link BaseClient}.
 *
 * @example
 * ```ts
 * const tables = await client.database.listTables()
 * const schema = await client.database.getTableSchema('public.users')
 * const result = await client.database.executeSql('SELECT count(*) FROM users')
 * ```
 */

import type { BaseClient } from './base.js'
import type { TableSummary, TableSchema, SqlResult } from '../types.js'

/**
 * HTTP client for MimDB database introspection and SQL execution endpoints.
 *
 * Instantiated lazily by {@link MimDBClient} and scoped to a single project
 * reference. Consumers should access this via `client.database` rather than
 * constructing it directly.
 */
export class DatabaseClient {
  /**
   * @param base - Shared HTTP transport used for all requests.
   * @param ref - Short 16-character hex project reference used in URL paths.
   */
  constructor(private readonly base: BaseClient, private readonly ref: string) {}

  /**
   * Returns a lightweight summary of every table visible in the project's
   * database, including schema, column count, and planner row estimates.
   *
   * @returns Array of {@link TableSummary} objects, one per table.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async listTables(): Promise<TableSummary[]> {
    return this.base.get<TableSummary[]>(`/v1/introspect/${this.ref}/tables`)
  }

  /**
   * Returns the full schema for a single table: columns, constraints, and
   * indexes.
   *
   * @param table - Table name, optionally schema-qualified (e.g. `"public.users"`).
   *   The value is URL-encoded before being placed in the path.
   * @returns A {@link TableSchema} describing the table's structure.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async getTableSchema(table: string): Promise<TableSchema> {
    // Strip schema prefix if provided (e.g. "public.users" -> "users")
    // The API expects just the table name, not schema-qualified.
    const tableName = table.includes('.') ? table.split('.').pop()! : table
    return this.base.get<TableSchema>(
      `/v1/introspect/${this.ref}/tables/${encodeURIComponent(tableName)}`,
    )
  }

  /**
   * Executes a SQL query (or statement) against the project database and
   * returns the result set.
   *
   * @param query - The SQL query string to execute.
   * @param params - Optional positional parameters bound to `$1`, `$2`, …
   *   placeholders in the query.
   * @returns A {@link SqlResult} containing columns, rows, and timing metadata.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async executeSql(query: string, params?: unknown[]): Promise<SqlResult> {
    return this.base.post<SqlResult>(`/v1/sql/${this.ref}/execute`, { query, params })
  }
}
