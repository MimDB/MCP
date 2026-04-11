/**
 * @module types
 * Shared TypeScript interfaces for all MimDB API response shapes.
 * These types are consumed by MCP tool handlers to provide structured
 * access to MimDB platform resources.
 */

// ---------------------------------------------------------------------------
// API Envelope
// ---------------------------------------------------------------------------

/**
 * Standard error object returned inside an {@link ApiResponse}.
 */
export interface ApiError {
  /** Platform-defined error code (e.g. "ERR_NOT_FOUND"). */
  code: string
  /** Human-readable error message. */
  message: string
  /** Optional additional detail or context about the error. */
  detail?: string
}

/**
 * Generic API response envelope used by all MimDB endpoints.
 * @template T - The shape of the successful response payload.
 */
export interface ApiResponse<T> {
  /** Response payload, or null on error. */
  data: T | null
  /** Error information, or null on success. */
  error: ApiError | null
  /** Metadata attached to every response. */
  meta: {
    /** Unique identifier for the request (useful for support tracing). */
    request_id: string
    /** Cursor for fetching the next page of results. */
    next_cursor?: string
    /** Whether more pages exist after this one. */
    has_more?: boolean
  }
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/**
 * Metadata for a single column returned by a SQL query.
 */
export interface SqlColumn {
  /** Column name as returned by the database. */
  name: string
  /** PostgreSQL type name (e.g. "text", "int4", "timestamptz"). */
  type: string
}

/**
 * Result set returned by {@link execute_sql} and similar SQL-execution tools.
 */
export interface SqlResult {
  /** Ordered list of columns in each row. */
  columns: SqlColumn[]
  /** Row data - may be positional arrays or keyed objects depending on API version. */
  rows: (unknown[] | Record<string, unknown>)[]
  /** Total number of rows returned (not affected rows). */
  row_count: number
  /** Wall-clock query duration reported by the server, in milliseconds. */
  execution_time_ms: number
}

// ---------------------------------------------------------------------------
// Tables / Schema
// ---------------------------------------------------------------------------

/**
 * Lightweight summary of a database table, used in list responses.
 */
export interface TableSummary {
  /** Unqualified table name. */
  name: string
  /** PostgreSQL schema that owns the table (e.g. "public"). */
  schema: string
  /** Planner statistics estimate of the number of rows. */
  row_estimate: number
  /** Whether the row count is an exact count (true for small tables). */
  row_count_exact: boolean
  /** Table size in bytes (including indexes and TOAST). */
  size_bytes: number
}

/**
 * Detailed metadata for a single column within a table schema.
 */
export interface ColumnInfo {
  /** Column name. */
  name: string
  /** PostgreSQL type name. */
  type: string
  /** Whether the column accepts NULL values. */
  nullable: boolean
  /** Default expression, or null if none is defined. */
  default_value: string | null
  /** Whether the column is part of the table's primary key. */
  is_primary_key: boolean
}

/**
 * Metadata for a single table constraint (PK, FK, UNIQUE, CHECK).
 */
export interface ConstraintInfo {
  /** Constraint name as stored in pg_constraint. */
  name: string
  /** Constraint kind: "PRIMARY KEY", "FOREIGN KEY", "UNIQUE", or "CHECK". */
  type: string
  /** Columns that participate in this constraint. */
  columns: string[]
  /** Target table for FOREIGN KEY constraints. */
  foreign_table?: string
  /** Target columns for FOREIGN KEY constraints. */
  foreign_columns?: string[]
}

/**
 * Metadata for a single index on a table.
 */
export interface IndexInfo {
  /** Index name as stored in pg_index. */
  name: string
  /** Columns covered by the index. */
  columns: string[]
  /** Whether the index enforces uniqueness. */
  unique: boolean
  /** Index access method (e.g. "btree", "gin", "ivfflat"). */
  type: string
}

/**
 * Full schema description for a database table, including columns,
 * constraints, and indexes.
 */
export interface TableSchema {
  /** Unqualified table name. */
  name: string
  /** PostgreSQL schema that owns the table. */
  schema: string
  /** Column definitions. */
  columns: ColumnInfo[]
  /** Constraint definitions. */
  constraints: ConstraintInfo[]
  /** Index definitions. */
  indexes: IndexInfo[]
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * A MimDB storage bucket.
 */
export interface Bucket {
  /** Bucket name (globally unique within a project). */
  name: string
  /** Whether the bucket allows unauthenticated read access. */
  public: boolean
  /** Maximum allowed file size in bytes, or null for unlimited. */
  file_size_limit: number | null
  /** Allowed MIME types, or null to permit all types. */
  allowed_types: string[] | null
  /** ISO 8601 timestamp when the bucket was created. */
  created_at: string
  /** ISO 8601 timestamp of the last bucket modification. */
  updated_at: string
}

/**
 * A single object stored inside a MimDB storage bucket.
 */
export interface StorageObject {
  /** Object name (path within the bucket). */
  name: string
  /** Name of the bucket that owns this object. */
  bucket: string
  /** File size in bytes. */
  size: number
  /** MIME type of the stored file. */
  content_type: string
  /** ISO 8601 timestamp when the object was uploaded. */
  created_at: string
  /** ISO 8601 timestamp of the last object modification. */
  updated_at: string
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

/**
 * A pg_cron job definition.
 */
export interface CronJob {
  /** Unique numeric job identifier assigned by pg_cron. */
  id: number
  /** Human-readable job name. */
  name: string
  /** Cron expression (e.g. "0 * * * *" for hourly). */
  schedule: string
  /** SQL command executed on each trigger. */
  command: string
  /** Whether the job is currently enabled. */
  active: boolean
  /** ISO 8601 timestamp when the job was created. */
  created_at: string
  /** ISO 8601 timestamp of the last job modification. */
  updated_at: string
}

/**
 * A single execution record for a pg_cron job.
 */
export interface CronJobRun {
  /** Unique run identifier. */
  run_id: number
  /** The job this run belongs to. */
  job_id: number
  /** Execution outcome (e.g. "succeeded", "failed", "started"). */
  status: string
  /** ISO 8601 timestamp when execution began. */
  started_at: string
  /** ISO 8601 timestamp when execution ended, or null if still running. */
  finished_at: string | null
  /** Message returned by the executed command, or null if none. */
  return_message: string | null
}

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

/**
 * Summary of a pgvector-enabled table managed by MimDB.
 */
export interface VectorTable {
  /** Table name. */
  name: string
  /** Number of dimensions in the vector column. */
  dimensions: number
  /** Distance metric used for similarity search (e.g. "cosine", "l2"). */
  metric: string
  /** Current number of rows in the table. */
  row_count: number
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

/**
 * Aggregated query performance statistics from pg_stat_statements.
 */
export interface QueryStat {
  /** Normalized SQL query text. */
  query: string
  /** Total number of times the query was executed. */
  calls: number
  /** Cumulative wall-clock time for all executions, in milliseconds. */
  total_time: number
  /** Average wall-clock time per execution, in milliseconds. */
  mean_time: number
  /** Total number of rows returned or affected across all executions. */
  rows: number
}

/**
 * A single structured log entry from the MimDB platform.
 */
export interface LogEntry {
  /** Unique log entry identifier. */
  id: string
  /** ISO 8601 timestamp when the event occurred. */
  timestamp: string
  /** Severity level (e.g. "info", "warn", "error"). */
  level: string
  /** Service or subsystem that generated the log (e.g. "api", "storage"). */
  service: string
  /** HTTP method of the originating request (e.g. "GET", "POST"). */
  method: string
  /** Request path. */
  path: string
  /** HTTP response status code. */
  status: number
  /** Request duration in milliseconds. */
  duration_ms: number
  /** Human-readable log message. */
  message: string
}

// ---------------------------------------------------------------------------
// Platform (Admin)
// ---------------------------------------------------------------------------

/**
 * A MimDB organization that owns one or more projects.
 */
export interface Organization {
  /** Unique organization UUID. */
  id: string
  /** Display name. */
  name: string
  /** URL-safe slug (unique across all organizations). */
  slug: string
  /** ISO 8601 timestamp when the organization was created. */
  created_at: string
}

/**
 * A MimDB project belonging to an {@link Organization}.
 */
export interface Project {
  /** Unique project UUID. */
  id: string
  /** UUID of the owning organization. */
  org_id: string
  /** Display name of the project. */
  name: string
  /** Short 16-character hex identifier used in API URLs. */
  ref: string
  /** Current lifecycle status (e.g. "active", "paused", "provisioning"). */
  status: string
  /** ISO 8601 timestamp when the project was created. */
  created_at: string
  /** ISO 8601 timestamp of the last project modification. */
  updated_at: string
}

/**
 * A {@link Project} with its API keys included.
 * Returned only by privileged admin endpoints.
 */
export interface ProjectWithKeys extends Project {
  /** Public anonymous key for client-side access. */
  anon_key: string
  /** Service role key with elevated privileges. */
  service_role_key: string
}

/**
 * Current API key JWTs for a project, as returned by the platform API.
 * These are full, usable JWT tokens (not just prefixes).
 */
export interface ProjectKeys {
  /** Public anonymous key JWT for client-side access. */
  anon_key: string
  /** Service role key JWT with elevated privileges (bypasses RLS). */
  service_role_key: string
}

/**
 * Metadata for a project-scoped API key.
 */
export interface ApiKeyInfo {
  /** Unique key identifier (UUID). */
  id: string
  /** UUID of the project that owns this key. */
  project_id: string
  /** Human-readable name for the key. */
  name: string
  /** Non-secret prefix shown in the dashboard (e.g. "sk_live_"). */
  key_prefix: string
  /** Permission role assigned to this key (e.g. "anon", "service_role"). */
  role: string
  /**
   * The raw key value. Only present immediately after creation;
   * not stored by the platform thereafter.
   */
  raw_key?: string
}

// ---------------------------------------------------------------------------
// Row-Level Security
// ---------------------------------------------------------------------------

/**
 * A PostgreSQL Row-Level Security (RLS) policy.
 */
export interface RlsPolicy {
  /** Policy name as stored in pg_policy. */
  name: string
  /** Table the policy is attached to. */
  table: string
  /** SQL command the policy applies to: "SELECT", "INSERT", "UPDATE", "DELETE", or "ALL". */
  command: string
  /** Whether the policy is PERMISSIVE (true) or RESTRICTIVE (false). */
  permissive: boolean
  /** Roles the policy applies to. */
  roles: string[]
  /** USING expression (row-level filter), or null if not specified. */
  using: string | null
  /** WITH CHECK expression (write filter), or null if not specified. */
  check: string | null
}

// ---------------------------------------------------------------------------
// MCP Tool Result
// ---------------------------------------------------------------------------

/**
 * A single piece of content within a {@link ToolResult}.
 * Currently only text content is supported.
 */
export interface ToolContent {
  /** Content type discriminant. */
  type: 'text'
  /** The text payload returned to the MCP client. */
  text: string
}

/**
 * The return value from an MCP tool handler.
 * Follows the MCP protocol shape expected by the SDK's `CallToolResult`.
 */
export interface ToolResult {
  /** Ordered list of content items to present to the client. */
  content: ToolContent[]
  /** When true, signals that the tool encountered an error. */
  isError?: boolean
}
