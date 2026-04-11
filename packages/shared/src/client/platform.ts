/**
 * @module client/platform
 * Domain client for MimDB platform/admin operations.
 *
 * All methods on this client use `{ useAdmin: true }` which causes the
 * base client to send `Authorization: Bearer {adminSecret}`. An admin
 * secret must be configured on the underlying {@link BaseClient}.
 *
 * Covered resources:
 * - Organizations (list, get, create)
 * - Projects (list, list by org, get, create)
 * - API keys (get, regenerate)
 * - Row-Level Security policies (list, create, update, delete)
 * - Structured logs (get with filters)
 */

import type { BaseClient } from './base.js'
import type {
  Organization,
  Project,
  ProjectWithKeys,
  ProjectKeys,
  RlsPolicy,
  LogEntry,
} from '../types.js'

// ---------------------------------------------------------------------------
// PlatformClient
// ---------------------------------------------------------------------------

/**
 * Admin client for MimDB platform-level operations.
 *
 * Every method requires admin credentials (configured via `adminSecret` on the
 * base client). All requests are sent with `Authorization: Bearer <adminSecret>`.
 *
 * @example
 * ```ts
 * const client = new MimDBClient({
 *   baseUrl: 'https://api.mimdb.io',
 *   adminSecret: process.env.MIMDB_ADMIN_SECRET,
 * })
 * const orgs = await client.platform.listOrganizations()
 * ```
 */
export class PlatformClient {
  /**
   * @param base - Configured base HTTP client.
   */
  constructor(private readonly base: BaseClient) {}

  // -------------------------------------------------------------------------
  // Organizations
  // -------------------------------------------------------------------------

  /**
   * Lists all organizations on the platform.
   *
   * @returns An array of all {@link Organization} records.
   * @throws {MimDBApiError} On API or network failure.
   */
  async listOrganizations(): Promise<Organization[]> {
    return this.base.get('/v1/platform/organizations', { useAdmin: true })
  }

  /**
   * Fetches a single organization by its UUID.
   *
   * @param orgId - UUID of the organization to retrieve.
   * @returns The matching {@link Organization}.
   * @throws {MimDBApiError} On 404 or other API failure.
   */
  async getOrganization(orgId: string): Promise<Organization> {
    return this.base.get(`/v1/platform/organizations/${orgId}`, { useAdmin: true })
  }

  /**
   * Creates a new organization.
   *
   * @param name - Display name for the new organization.
   * @param slug - URL-safe slug (must be unique across all organizations).
   * @returns The newly created {@link Organization}.
   * @throws {MimDBApiError} On validation failure or API error.
   */
  async createOrganization(name: string, slug: string): Promise<Organization> {
    return this.base.post('/v1/platform/organizations', { name, slug }, { useAdmin: true })
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  /**
   * Lists all projects across all organizations.
   *
   * @returns An array of all {@link Project} records.
   * @throws {MimDBApiError} On API or network failure.
   */
  async listProjects(): Promise<Project[]> {
    return this.base.get('/v1/platform/projects', { useAdmin: true })
  }

  /**
   * Lists all projects belonging to a specific organization.
   *
   * @param orgId - UUID of the organization.
   * @returns An array of {@link Project} records owned by the organization.
   * @throws {MimDBApiError} On 404 or other API failure.
   */
  async listOrgProjects(orgId: string): Promise<Project[]> {
    return this.base.get(`/v1/platform/organizations/${orgId}/projects`, { useAdmin: true })
  }

  /**
   * Fetches a single project by its UUID.
   *
   * @param projectId - UUID of the project to retrieve.
   * @returns The matching {@link Project}.
   * @throws {MimDBApiError} On 404 or other API failure.
   */
  async getProject(projectId: string): Promise<Project> {
    return this.base.get(`/v1/platform/projects/${projectId}`, { useAdmin: true })
  }

  /**
   * Creates a new project within an organization.
   *
   * @param orgId - UUID of the owning organization.
   * @param name - Display name for the project.
   * @returns The newly created {@link ProjectWithKeys}, including API keys.
   *   The `service_role_key` is only present in this response and is not
   *   stored by the platform thereafter.
   * @throws {MimDBApiError} On validation failure or API error.
   */
  async createProject(orgId: string, name: string): Promise<ProjectWithKeys> {
    return this.base.post('/v1/platform/projects', { org_id: orgId, name }, { useAdmin: true })
  }

  // -------------------------------------------------------------------------
  // Ref resolution
  // -------------------------------------------------------------------------

  /**
   * Resolves a short project reference (ref) to its full UUID.
   *
   * Fetches all projects and finds the first one whose `ref` field matches.
   * Use this to translate a `MIMDB_PROJECT_REF` environment variable into
   * a project UUID required by some admin endpoints.
   *
   * @param ref - Short 16-character hex project reference.
   * @returns The project UUID corresponding to the given ref.
   * @throws {Error} If no project with the given ref exists.
   * @throws {MimDBApiError} On API or network failure.
   */
  async resolveRefToId(ref: string): Promise<string> {
    const projects = await this.listProjects()
    const project = projects.find((p) => p.ref === ref)
    if (!project) throw new Error(`Project with ref "${ref}" not found`)
    return project.id
  }

  // -------------------------------------------------------------------------
  // API Keys
  // -------------------------------------------------------------------------

  /**
   * Returns the API key metadata for a project.
   *
   * Raw key values are not included; use this to inspect key names, prefixes,
   * and roles. To retrieve raw keys, regenerate them via {@link regenerateApiKeys}.
   *
   * @param projectId - UUID of the project.
   * @returns {@link ProjectKeys} containing fresh anon and service_role JWTs.
   * @throws {MimDBApiError} On 404 or other API failure.
   */
  async getApiKeys(projectId: string): Promise<ProjectKeys> {
    return this.base.get(`/v1/platform/projects/${projectId}/api-keys`, { useAdmin: true })
  }

  /**
   * Rotates all API keys for a project.
   *
   * WARNING: This invalidates ALL existing API keys and JWT tokens immediately.
   * Any clients still using the old keys will start receiving 401 errors.
   *
   * @param projectId - UUID of the project.
   * @returns {@link ProjectKeys} containing the new anon and service_role JWTs.
   * @throws {MimDBApiError} On 404 or other API failure.
   */
  async regenerateApiKeys(projectId: string): Promise<ProjectKeys> {
    return this.base.post(
      `/v1/platform/projects/${projectId}/api-keys/regenerate`,
      {},
      { useAdmin: true },
    )
  }

  // -------------------------------------------------------------------------
  // RLS Policies
  // -------------------------------------------------------------------------

  /**
   * Lists all RLS policies defined on a table within a project.
   *
   * @param projectId - UUID of the project.
   * @param table - Table name (optionally schema-qualified).
   * @returns An array of {@link RlsPolicy} records.
   * @throws {MimDBApiError} On 404 or other API failure.
   */
  async listPolicies(projectId: string, table: string): Promise<RlsPolicy[]> {
    return this.base.get(
      `/v1/platform/projects/${projectId}/rls/tables/${encodeURIComponent(table)}/policies`,
      { useAdmin: true },
    )
  }

  /**
   * Creates a new RLS policy on a table.
   *
   * @param projectId - UUID of the project.
   * @param table - Table name (optionally schema-qualified).
   * @param policy - Policy definition fields.
   * @param policy.name - Policy name (unique per table).
   * @param policy.command - SQL command scope: "SELECT", "INSERT", "UPDATE", "DELETE", or "ALL".
   * @param policy.permissive - Whether the policy is PERMISSIVE (true) or RESTRICTIVE (false).
   * @param policy.roles - Roles the policy applies to.
   * @param policy.using - USING expression for row-level filtering.
   * @param policy.check - WITH CHECK expression for write filtering.
   * @returns The newly created {@link RlsPolicy}.
   * @throws {MimDBApiError} On validation failure or API error.
   */
  async createPolicy(
    projectId: string,
    table: string,
    policy: {
      name: string
      command?: string
      permissive?: boolean
      roles?: string[]
      using?: string
      check?: string
    },
  ): Promise<RlsPolicy> {
    return this.base.post(
      `/v1/platform/projects/${projectId}/rls/tables/${encodeURIComponent(table)}/policies`,
      policy,
      { useAdmin: true },
    )
  }

  /**
   * Updates an existing RLS policy on a table.
   *
   * @param projectId - UUID of the project.
   * @param table - Table name (optionally schema-qualified).
   * @param name - Current name of the policy to update.
   * @param updates - Fields to update on the policy.
   * @param updates.roles - New roles the policy should apply to.
   * @param updates.using - New USING expression.
   * @param updates.check - New WITH CHECK expression.
   * @returns The updated {@link RlsPolicy}.
   * @throws {MimDBApiError} On 404 or other API failure.
   */
  async updatePolicy(
    projectId: string,
    table: string,
    name: string,
    updates: {
      roles?: string[]
      using?: string
      check?: string
    },
  ): Promise<RlsPolicy> {
    return this.base.patch(
      `/v1/platform/projects/${projectId}/rls/tables/${encodeURIComponent(table)}/policies/${encodeURIComponent(name)}`,
      updates,
      { useAdmin: true },
    )
  }

  /**
   * Deletes an RLS policy from a table.
   *
   * @param projectId - UUID of the project.
   * @param table - Table name (optionally schema-qualified).
   * @param name - Name of the policy to delete.
   * @throws {MimDBApiError} On 404 or other API failure.
   */
  async deletePolicy(projectId: string, table: string, name: string): Promise<void> {
    await this.base.delete(
      `/v1/platform/projects/${projectId}/rls/tables/${encodeURIComponent(table)}/policies/${encodeURIComponent(name)}`,
      { useAdmin: true },
    )
  }

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  /**
   * Retrieves structured log entries for a project with optional filtering.
   *
   * @param projectId - UUID of the project.
   * @param params - Optional query filters.
   * @param params.level - Severity filter: "error", "warn", or "info".
   * @param params.service - Service or subsystem name to filter by.
   * @param params.method - HTTP method to filter by (e.g. "GET", "POST").
   * @param params.status_min - Minimum HTTP status code (inclusive).
   * @param params.status_max - Maximum HTTP status code (inclusive).
   * @param params.since - ISO 8601 start timestamp (inclusive).
   * @param params.until - ISO 8601 end timestamp (inclusive).
   * @param params.limit - Maximum number of log entries to return (1-1000).
   * @returns An array of {@link LogEntry} records matching the filters.
   * @throws {MimDBApiError} On API or network failure.
   */
  async getLogs(
    projectId: string,
    params?: {
      level?: string
      service?: string
      method?: string
      status_min?: number
      status_max?: number
      since?: string
      until?: string
      limit?: number
    },
  ): Promise<LogEntry[]> {
    return this.base.get(`/v1/platform/projects/${projectId}/logs`, {
      useAdmin: true,
      query: params as Record<string, string | number>,
    })
  }
}
