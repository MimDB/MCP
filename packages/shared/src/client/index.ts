/**
 * @module client
 * Top-level MimDB client facade providing lazy-loaded domain clients.
 *
 * {@link MimDBClient} is the primary entry point for SDK consumers.
 * Each domain area (database, storage, cron, etc.) is instantiated on first
 * access to avoid paying startup cost for unused clients.
 *
 * @example
 * ```ts
 * const client = new MimDBClient({
 *   baseUrl: 'https://api.mimdb.io',
 *   serviceRoleKey: process.env.MIMDB_SERVICE_ROLE_KEY,
 *   projectRef: 'abc123',
 * })
 *
 * // Lazy-loaded on first access:
 * const tables = await client.database.listTables()
 * ```
 */

import { BaseClient, type BaseClientOptions } from './base.js'
import { DatabaseClient } from './database.js'
import { StorageClient } from './storage.js'
import { CronClient } from './cron.js'
import { VectorsClient } from './vectors.js'
import { StatsClient } from './stats.js'
import { PlatformClient } from './platform.js'

// ---------------------------------------------------------------------------
// MimDBClient options
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link MimDBClient}.
 * Extends {@link BaseClientOptions} with an optional project reference.
 */
export interface MimDBClientOptions extends BaseClientOptions {
  /**
   * Short 16-character hex project reference used in API URL paths.
   * Required to access project-scoped domain clients (database, storage,
   * cron, vectors, stats). Omit for platform-only (admin) usage.
   */
  projectRef?: string
}

// ---------------------------------------------------------------------------
// MimDBClient
// ---------------------------------------------------------------------------

/**
 * Facade client that exposes all MimDB domain clients via lazy getters.
 *
 * Project-scoped clients (database, storage, cron, vectors, stats) require
 * `projectRef` to be supplied at construction. The platform client is always
 * available and does not require a project reference.
 */
export class MimDBClient {
  private readonly _base: BaseClient
  private readonly _baseUrl: string
  private readonly ref: string | undefined

  // Lazy-loaded domain client instances
  private _database?: DatabaseClient
  private _storage?: StorageClient
  private _cron?: CronClient
  private _vectors?: VectorsClient
  private _stats?: StatsClient
  private _platform?: PlatformClient

  /**
   * @param options - Client configuration including base URL, credentials,
   *   and optional project reference.
   */
  constructor(options: MimDBClientOptions) {
    const { projectRef, ...baseOptions } = options
    this._base = new BaseClient(baseOptions)
    // Mirror the trailing-slash strip that BaseClient performs internally so
    // the facade exposes a consistent value without reaching into private state.
    this._baseUrl = baseOptions.baseUrl.replace(/\/$/, '')
    this.ref = projectRef
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * The base URL this client was configured with (trailing slash stripped).
   */
  get baseUrl(): string {
    return this._baseUrl
  }

  /**
   * The project reference this client is scoped to, or `undefined` for
   * platform-only clients.
   */
  get projectRef(): string | undefined {
    return this.ref
  }

  // -------------------------------------------------------------------------
  // Domain client lazy getters
  // -------------------------------------------------------------------------

  /**
   * Client for database operations (tables, SQL execution, schema, RLS).
   * Requires `projectRef` to have been provided at construction.
   */
  get database(): DatabaseClient {
    this._database ??= new DatabaseClient(this._base, this.ref!)
    return this._database
  }

  /**
   * Client for storage operations (buckets, object upload/download).
   * Requires `projectRef` to have been provided at construction.
   */
  get storage(): StorageClient {
    this._storage ??= new StorageClient(this._base, this.ref!)
    return this._storage
  }

  /**
   * Client for pg_cron job management (create, list, delete jobs and runs).
   * Requires `projectRef` to have been provided at construction.
   */
  get cron(): CronClient {
    this._cron ??= new CronClient(this._base, this.ref!)
    return this._cron
  }

  /**
   * Client for pgvector operations (vector tables, similarity search).
   * Requires `projectRef` to have been provided at construction.
   */
  get vectors(): VectorsClient {
    this._vectors ??= new VectorsClient(this._base, this.ref!)
    return this._vectors
  }

  /**
   * Client for observability operations (query statistics, log retrieval).
   * Requires `projectRef` to have been provided at construction.
   */
  get stats(): StatsClient {
    this._stats ??= new StatsClient(this._base, this.ref!)
    return this._stats
  }

  /**
   * Client for platform-level admin operations (organisations, projects,
   * API key management). Does not require a project reference.
   */
  get platform(): PlatformClient {
    this._platform ??= new PlatformClient(this._base)
    return this._platform
  }
}
