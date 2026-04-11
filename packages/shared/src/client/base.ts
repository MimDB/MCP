/**
 * @module client/base
 * Base HTTP client providing typed fetch wrappers for the MimDB REST API.
 *
 * All domain clients (database, storage, cron, etc.) extend or compose
 * {@link BaseClient}. The client handles:
 * - URL construction with query-string serialisation
 * - Auth header injection (`apikey` vs `Authorization: Bearer`)
 * - Envelope unwrapping (`ApiResponse<T>` -> `T`)
 * - Consistent error surfacing via {@link MimDBApiError}
 */

import type { ApiError, ApiResponse } from '../types.js'

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link BaseClient} whenever the server returns a non-OK status
 * or a network-level failure prevents the request from completing.
 *
 * @example
 * ```ts
 * try {
 *   await client.get('/v1/tables')
 * } catch (err) {
 *   if (err instanceof MimDBApiError) {
 *     console.error(err.status, err.apiError?.code)
 *   }
 * }
 * ```
 */
export class MimDBApiError extends Error {
  /** HTTP status code, or 0 for network-level failures. */
  readonly status: number
  /** Structured error from the API response body, if available. */
  readonly apiError?: ApiError
  /** Platform-assigned request ID for support tracing. */
  readonly requestId?: string

  /**
   * @param message - Human-readable error description.
   * @param status - HTTP status code (0 = network error).
   * @param apiError - Parsed error from the API response envelope.
   * @param requestId - Request ID from the response `meta` field.
   */
  constructor(message: string, status: number, apiError?: ApiError, requestId?: string) {
    super(message)
    this.name = 'MimDBApiError'
    this.status = status
    this.apiError = apiError
    this.requestId = requestId
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link BaseClient}.
 */
export interface BaseClientOptions {
  /** Base URL of the MimDB API (e.g. `https://api.mimdb.io`). */
  baseUrl: string
  /**
   * Service-role API key for project-scoped requests.
   * Sent as `apikey: <value>` unless {@link RequestOptions.useAdmin} is true.
   */
  serviceRoleKey?: string
  /**
   * Admin secret for platform-level requests.
   * Sent as `Authorization: Bearer <value>` when {@link RequestOptions.useAdmin} is true.
   */
  adminSecret?: string
}

/**
 * Per-request options accepted by all {@link BaseClient} methods.
 */
export interface RequestOptions {
  /**
   * When true, sends `Authorization: Bearer {adminSecret}` instead of
   * `apikey: {serviceRoleKey}`. Requires `adminSecret` to be configured.
   */
  useAdmin?: boolean
  /**
   * Key-value pairs to append as query-string parameters.
   * `undefined` values are omitted from the URL.
   */
  query?: Record<string, string | number | boolean | undefined>
}

// ---------------------------------------------------------------------------
// BaseClient
// ---------------------------------------------------------------------------

/**
 * Thin, typed fetch wrapper for the MimDB REST API.
 *
 * Handles auth header injection, URL construction, and response unwrapping.
 * Domain clients use this as their HTTP transport.
 *
 * @example
 * ```ts
 * const client = new BaseClient({
 *   baseUrl: 'https://api.mimdb.io',
 *   serviceRoleKey: process.env.MIMDB_SERVICE_ROLE_KEY,
 * })
 * const data = await client.get<TableSummary[]>('/v1/abc123/tables')
 * ```
 */
export class BaseClient {
  private readonly baseUrl: string
  private readonly serviceRoleKey?: string
  private readonly adminSecret?: string

  /**
   * @param options - Client configuration options.
   */
  constructor(options: BaseClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.adminSecret = options.adminSecret
  }

  // -------------------------------------------------------------------------
  // Public HTTP methods
  // -------------------------------------------------------------------------

  /**
   * Performs a GET request and returns the unwrapped response data.
   *
   * @param path - API path (e.g. `/v1/abc123/tables`).
   * @param options - Optional request configuration.
   * @returns The `data` field from the `ApiResponse<T>` envelope.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options)
  }

  /**
   * Performs a POST request and returns the unwrapped response data.
   *
   * @param path - API path.
   * @param body - JSON-serialisable request body.
   * @param options - Optional request configuration.
   * @returns The `data` field from the `ApiResponse<T>` envelope.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options)
  }

  /**
   * Performs a PATCH request and returns the unwrapped response data.
   *
   * @param path - API path.
   * @param body - JSON-serialisable request body.
   * @param options - Optional request configuration.
   * @returns The `data` field from the `ApiResponse<T>` envelope.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options)
  }

  /**
   * Performs a DELETE request and returns the unwrapped response data.
   *
   * @param path - API path.
   * @param options - Optional request configuration.
   * @returns The `data` field from the `ApiResponse<T>` envelope, or
   *   `undefined` for 204 No Content responses.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options)
  }

  /**
   * Performs a GET request and returns the raw {@link Response} object.
   * Useful for streaming downloads or when you need access to headers.
   *
   * @param path - API path.
   * @param options - Optional request configuration.
   * @returns The native `Response` object from `fetch`.
   * @throws {MimDBApiError} On network failure.
   */
  async getRaw(path: string, options?: RequestOptions): Promise<Response> {
    const url = this.buildUrl(path, options?.query)
    const headers = this.buildHeaders(options?.useAdmin)
    try {
      return await fetch(url, { method: 'GET', headers })
    } catch (err) {
      throw new MimDBApiError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        0,
      )
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Core request implementation shared by all typed HTTP methods.
   *
   * @param method - HTTP method verb.
   * @param path - API path.
   * @param body - Optional JSON body.
   * @param options - Per-request configuration.
   * @returns Unwrapped `data` from the `ApiResponse<T>` envelope.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path, options?.query)
    const headers = this.buildHeaders(options?.useAdmin)
    const init: RequestInit = { method, headers }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    let response: Response
    try {
      response = await fetch(url, init)
    } catch (err) {
      throw new MimDBApiError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        0,
      )
    }

    // 204 No Content - nothing to parse
    if (response.status === 204) {
      return undefined as unknown as T
    }

    // Attempt to parse the API envelope for both success and error cases
    let envelope: ApiResponse<T>
    try {
      envelope = (await response.json()) as ApiResponse<T>
    } catch {
      throw new MimDBApiError(
        `Failed to parse response body (status ${response.status})`,
        response.status,
      )
    }

    if (!response.ok) {
      throw new MimDBApiError(
        envelope.error?.message ?? `Request failed with status ${response.status}`,
        response.status,
        envelope.error ?? undefined,
        envelope.meta?.request_id,
      )
    }

    return envelope.data as T
  }

  /**
   * Builds the fully-qualified request URL with optional query parameters.
   * `undefined` values in the query map are skipped.
   *
   * @param path - API path to append to `baseUrl`.
   * @param query - Optional key-value query parameters.
   * @returns The constructed URL string.
   */
  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = `${this.baseUrl}${path}`
    if (!query) return url

    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.set(key, String(value))
      }
    }

    const qs = params.toString()
    return qs ? `${url}?${qs}` : url
  }

  /**
   * Builds the request headers map based on the auth mode.
   *
   * When `useAdmin` is true, sends `Authorization: Bearer {adminSecret}`.
   * Otherwise sends `apikey: {serviceRoleKey}`.
   *
   * @param useAdmin - Whether to use admin credentials.
   * @returns A plain headers object ready to pass to `fetch`.
   */
  private buildHeaders(useAdmin?: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (useAdmin && this.adminSecret) {
      headers['Authorization'] = `Bearer ${this.adminSecret}`
    } else if (this.serviceRoleKey) {
      headers['apikey'] = this.serviceRoleKey
    }

    return headers
  }
}
