/**
 * @module client/vectors
 * Domain client for MimDB vector search operations (pgvector tables).
 *
 * Provides typed wrappers for all pgvector endpoints:
 * - Listing and creating vector tables
 * - Deleting tables (with cascade support)
 * - Creating HNSW indexes
 * - Running similarity search queries
 *
 * All methods throw {@link MimDBApiError} on non-OK responses.
 *
 * @example
 * ```ts
 * const tables = await client.vectors.listTables()
 * const results = await client.vectors.search('embeddings', {
 *   vector: [0.1, 0.2, 0.3],
 *   limit: 10,
 *   metric: 'cosine',
 * })
 * ```
 */

import type { BaseClient } from './base.js'
import type { VectorTable } from '../types.js'

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

/**
 * Definition for an additional column to include in a vector table alongside
 * the primary vector column.
 */
export interface VectorColumnDef {
  /** Column name. */
  name: string
  /** PostgreSQL type (e.g. "text", "int4", "jsonb"). */
  type: string
  /** Optional default expression for the column. */
  default?: string
}

/**
 * HNSW index tuning parameters shared by table creation and explicit index creation.
 */
export interface HnswIndexParams {
  /**
   * HNSW `m` parameter - number of bi-directional links per node.
   * Higher values improve recall at the cost of memory and build time.
   */
  m?: number
  /**
   * HNSW `ef_construction` parameter - candidate list size during index build.
   * Higher values improve quality at the cost of build time.
   */
  ef_construction?: number
  /**
   * When true, the index is built concurrently without locking the table.
   * Slower to build but does not block reads or writes.
   */
  concurrent?: boolean
}

/**
 * Parameters for creating a new vector table.
 */
export interface CreateVectorTableParams {
  /** Name of the vector table to create. */
  name: string
  /** Number of dimensions in the vector column. Must be a positive integer. */
  dimensions: number
  /** Distance metric used for similarity search. Defaults to "cosine". */
  metric?: string
  /** Optional additional columns to include alongside the vector column. */
  columns?: VectorColumnDef[]
  /**
   * When true, skips automatic HNSW index creation on the vector column.
   * Useful when you plan to bulk-load data before indexing.
   */
  skip_index?: boolean
  /** Optional HNSW index tuning parameters applied during table creation. */
  index?: HnswIndexParams
}

/**
 * Parameters for running a similarity search query against a vector table.
 */
export interface VectorSearchParams {
  /** Query vector to search against stored embeddings. */
  vector: number[]
  /** Maximum number of results to return. Defaults to the server default. */
  limit?: number
  /** Minimum similarity threshold; results below this are excluded. */
  threshold?: number
  /** Distance metric to use for this query; overrides the table default. */
  metric?: string
  /** Subset of columns to return. Returns all columns when omitted. */
  select?: string[]
  /** Key-value filter applied to non-vector columns before similarity ranking. */
  filter?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// VectorsClient
// ---------------------------------------------------------------------------

/**
 * Domain client for MimDB pgvector operations.
 *
 * Instantiated by the {@link MimDBClient} facade and accessed via
 * `client.vectors`. All methods are project-scoped to `ref`.
 */
export class VectorsClient {
  /**
   * @param base - Underlying HTTP client for making API requests.
   * @param ref - Project short reference used in all URL paths.
   */
  constructor(private readonly base: BaseClient, private readonly ref: string) {}

  /**
   * Lists all vector tables in the project.
   *
   * @returns Array of {@link VectorTable} summaries.
   * @throws {MimDBApiError} On non-OK API response.
   */
  async listTables(): Promise<VectorTable[]> {
    return this.base.get(`/v1/vectors/${this.ref}/tables`)
  }

  /**
   * Creates a new pgvector-enabled table in the project.
   *
   * @param params - Table definition including name, dimensions, metric, and
   *   optional extra columns and index configuration.
   * @throws {MimDBApiError} On non-OK API response.
   */
  async createTable(params: CreateVectorTableParams): Promise<void> {
    await this.base.post(`/v1/vectors/${this.ref}/tables`, params)
  }

  /**
   * Deletes a vector table from the project.
   *
   * @param table - Name of the table to delete.
   * @param confirm - Must equal `table` as a deletion confirmation guard.
   * @param cascade - When true, drops dependent objects (views, foreign keys).
   * @throws {MimDBApiError} On non-OK API response.
   */
  async deleteTable(table: string, confirm: string, cascade?: boolean): Promise<void> {
    await this.base.delete(`/v1/vectors/${this.ref}/tables/${encodeURIComponent(table)}`, {
      query: { confirm, cascade },
    })
  }

  /**
   * Creates an HNSW index on an existing vector table's vector column.
   *
   * @param table - Name of the vector table to index.
   * @param params - Optional HNSW tuning parameters.
   * @throws {MimDBApiError} On non-OK API response.
   */
  async createIndex(table: string, params?: HnswIndexParams): Promise<void> {
    await this.base.post(`/v1/vectors/${this.ref}/${encodeURIComponent(table)}/index`, params ?? {})
  }

  /**
   * Runs a similarity search against a vector table and returns matching rows.
   *
   * Results include a similarity score alongside any selected columns.
   * The response shape is table-dependent so the return type is `unknown[]`.
   *
   * @param table - Name of the vector table to search.
   * @param params - Search parameters including query vector and optional filters.
   * @returns Array of matching rows ordered by similarity score.
   * @throws {MimDBApiError} On non-OK API response.
   */
  async search(table: string, params: VectorSearchParams): Promise<unknown[]> {
    return this.base.post(`/v1/vectors/${this.ref}/${encodeURIComponent(table)}/search`, params)
  }
}
