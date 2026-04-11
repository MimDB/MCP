/**
 * @module client/storage
 * Domain client for MimDB storage operations: bucket management and object
 * upload, download, listing, and URL generation.
 *
 * This client is a thin HTTP wrapper. All request routing and auth header
 * injection is handled by the injected {@link BaseClient}.
 *
 * @example
 * ```ts
 * const buckets = await client.storage.listBuckets()
 * await client.storage.createBucket('avatars', true)
 * const objects = await client.storage.listObjects('avatars', { prefix: 'users/' })
 * ```
 */

import type { BaseClient } from './base.js'
import type { Bucket, StorageObject } from '../types.js'

// ---------------------------------------------------------------------------
// Option types
// ---------------------------------------------------------------------------

/**
 * Pagination and ordering options shared by list endpoints.
 */
export interface ListOptions {
  /** Opaque cursor returned by a previous request; omit to start from the beginning. */
  cursor?: string
  /** Maximum number of items to return per page. */
  limit?: number
  /** Sort order for the returned items (e.g. `"asc"` or `"desc"`). */
  order?: string
}

/**
 * Options for {@link StorageClient.listObjects}.
 */
export interface ListObjectsOptions extends ListOptions {
  /** Only return objects whose name begins with this prefix. */
  prefix?: string
}

/**
 * Mutable fields that can be updated on an existing bucket.
 */
export interface BucketUpdates {
  /** Whether to allow unauthenticated read access. */
  public?: boolean
  /** Maximum file size in bytes; pass `null` to remove the limit. */
  file_size_limit?: number
  /** Allowed MIME types; pass `null` to permit all types. */
  allowed_types?: string[]
}

// ---------------------------------------------------------------------------
// StorageClient
// ---------------------------------------------------------------------------

/**
 * HTTP client for MimDB storage (bucket and object) endpoints.
 *
 * Instantiated lazily by {@link MimDBClient} and scoped to a single project
 * reference. Consumers should access this via `client.storage` rather than
 * constructing it directly.
 */
export class StorageClient {
  /**
   * @param base - Shared HTTP transport used for all requests.
   * @param ref - Short 16-character hex project reference used in URL paths.
   */
  constructor(private readonly base: BaseClient, private readonly ref: string) {}

  // -------------------------------------------------------------------------
  // Bucket operations
  // -------------------------------------------------------------------------

  /**
   * Returns all buckets in the project, with optional pagination.
   *
   * @param opts - Pagination and ordering options.
   * @returns Array of {@link Bucket} objects.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async listBuckets(opts?: ListOptions): Promise<Bucket[]> {
    return this.base.get<Bucket[]>(`/v1/storage/${this.ref}/buckets`, {
      query: {
        cursor: opts?.cursor,
        limit: opts?.limit,
        order: opts?.order,
      },
    })
  }

  /**
   * Creates a new storage bucket in the project.
   *
   * @param name - Bucket name (must be unique within the project).
   * @param isPublic - When `true`, allows unauthenticated read access. Defaults to `false`.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async createBucket(name: string, isPublic = false): Promise<void> {
    await this.base.post<void>(`/v1/storage/${this.ref}/buckets`, {
      name,
      public: isPublic,
    })
  }

  /**
   * Updates mutable properties on an existing bucket.
   *
   * @param name - Name of the bucket to update.
   * @param updates - Fields to change; omitted fields are left unchanged.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async updateBucket(name: string, updates: BucketUpdates): Promise<void> {
    await this.base.patch<void>(
      `/v1/storage/${this.ref}/buckets/${encodeURIComponent(name)}`,
      updates,
    )
  }

  /**
   * Permanently deletes a bucket and all objects it contains.
   *
   * @param name - Name of the bucket to delete.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async deleteBucket(name: string): Promise<void> {
    await this.base.delete<void>(
      `/v1/storage/${this.ref}/buckets/${encodeURIComponent(name)}`,
    )
  }

  // -------------------------------------------------------------------------
  // Object operations
  // -------------------------------------------------------------------------

  /**
   * Returns objects stored inside a bucket, with optional prefix filtering
   * and pagination.
   *
   * @param bucket - Name of the bucket to list.
   * @param opts - Prefix filter and pagination options.
   * @returns Array of {@link StorageObject} descriptors.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async listObjects(bucket: string, opts?: ListObjectsOptions): Promise<StorageObject[]> {
    return this.base.get<StorageObject[]>(
      `/v1/storage/${this.ref}/object/${encodeURIComponent(bucket)}`,
      {
        query: {
          prefix: opts?.prefix,
          cursor: opts?.cursor,
          limit: opts?.limit,
          order: opts?.order,
        },
      },
    )
  }

  /**
   * Uploads a binary object to the specified bucket path.
   *
   * Bypasses {@link BaseClient}'s JSON serialisation so that the raw binary
   * body is sent with the correct `Content-Type` header.
   *
   * @param bucket - Destination bucket name.
   * @param path - Object path within the bucket (e.g. `"avatars/user-1.png"`).
   * @param content - Raw file content as a `Buffer`.
   * @param contentType - MIME type of the file (e.g. `"image/png"`). Defaults to
   *   `"application/octet-stream"`.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async uploadObject(
    bucket: string,
    path: string,
    content: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    // Access private fields via cast to make the raw fetch call with binary body.
    const anyBase = this.base as unknown as { baseUrl: string; serviceRoleKey?: string }
    const url = `${anyBase.baseUrl}/v1/storage/${this.ref}/object/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`

    const headers: Record<string, string> = { 'Content-Type': contentType }
    if (anyBase.serviceRoleKey) {
      headers['apikey'] = anyBase.serviceRoleKey
    }

    let response: Response
    try {
      response = await fetch(url, { method: 'POST', headers, body: content as unknown as BodyInit })
    } catch (err) {
      const { MimDBApiError } = await import('./base.js')
      throw new MimDBApiError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        0,
      )
    }

    if (!response.ok) {
      const { MimDBApiError } = await import('./base.js')
      throw new MimDBApiError(
        `Upload failed with status ${response.status}`,
        response.status,
      )
    }
  }

  /**
   * Downloads an object from a bucket, returning the raw `Response` for
   * flexible content handling (text, binary, streaming).
   *
   * @param bucket - Source bucket name.
   * @param path - Object path within the bucket.
   * @returns The native `Response` object from `fetch`.
   * @throws {MimDBApiError} On network failure.
   */
  async downloadObject(bucket: string, path: string): Promise<Response> {
    return this.base.getRaw(
      `/v1/storage/${this.ref}/object/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`,
    )
  }

  /**
   * Permanently deletes a single object from a bucket.
   *
   * @param bucket - Bucket that owns the object.
   * @param path - Object path within the bucket.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async deleteObject(bucket: string, path: string): Promise<void> {
    await this.base.delete<void>(
      `/v1/storage/${this.ref}/object/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`,
    )
  }

  /**
   * Generates a time-limited signed URL that allows temporary public access
   * to a private object.
   *
   * @param bucket - Bucket that owns the object.
   * @param path - Object path within the bucket.
   * @returns The signed URL string.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async getSignedUrl(bucket: string, path: string): Promise<string> {
    const response = await this.base.post<{ signedURL: string }>(
      `/v1/storage/${this.ref}/sign/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`,
    )
    return response.signedURL
  }

  /**
   * Computes the public URL for an object in a public bucket.
   * This is a pure string computation — no HTTP call is made.
   *
   * @param bucket - Bucket that owns the object.
   * @param path - Object path within the bucket.
   * @param baseUrl - Base URL of the MimDB API (e.g. `"https://api.mimdb.io"`).
   * @returns The public URL string for the object.
   */
  getPublicUrl(bucket: string, path: string, baseUrl: string): string {
    const base = baseUrl.replace(/\/$/, '')
    return `${base}/v1/storage/${this.ref}/public/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`
  }
}
