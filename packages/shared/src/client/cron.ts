/**
 * @module client/cron
 * Domain client for MimDB pg_cron job management.
 *
 * Provides typed wrappers for listing, creating, retrieving, deleting, and
 * inspecting the run history of pg_cron jobs. All endpoints require a
 * ServiceRoleKey; auth is handled by the injected {@link BaseClient}.
 *
 * @example
 * ```ts
 * const jobs = await client.cron.listJobs()
 * const job  = await client.cron.createJob('nightly-vacuum', '0 3 * * *', 'VACUUM ANALYZE;')
 * const hist = await client.cron.getJobHistory(job.id, 10)
 * await client.cron.deleteJob(job.id)
 * ```
 */

import type { BaseClient } from './base.js'
import type { CronJob, CronJobRun } from '../types.js'

/**
 * HTTP client for MimDB pg_cron job management endpoints.
 *
 * Instantiated lazily by {@link MimDBClient} and scoped to a single project
 * reference. Consumers should access this via `client.cron` rather than
 * constructing it directly.
 */
export class CronClient {
  /**
   * @param base - Shared HTTP transport used for all requests.
   * @param ref - Short 16-character hex project reference used in URL paths.
   */
  constructor(private readonly base: BaseClient, private readonly ref: string) {}

  /**
   * Returns all pg_cron jobs defined in the project, along with quota metadata.
   *
   * @returns An object containing the job list, total count, and max allowed jobs.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async listJobs(): Promise<{ jobs: CronJob[]; total: number; max_allowed: number }> {
    return this.base.get(`/v1/cron/${this.ref}/jobs`)
  }

  /**
   * Creates a new pg_cron job with the given schedule and SQL command.
   *
   * @param name - Human-readable job name (must be unique within the project).
   * @param schedule - Cron expression (e.g. `"0 * * * *"` for hourly).
   * @param command - SQL statement executed on each trigger.
   * @returns The newly created {@link CronJob}.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async createJob(name: string, schedule: string, command: string): Promise<CronJob> {
    return this.base.post(`/v1/cron/${this.ref}/jobs`, { name, schedule, command })
  }

  /**
   * Returns the full definition for a single pg_cron job.
   *
   * @param id - Numeric job ID assigned by pg_cron.
   * @returns The {@link CronJob} with the given ID.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async getJob(id: number): Promise<CronJob> {
    return this.base.get(`/v1/cron/${this.ref}/jobs/${id}`)
  }

  /**
   * Deletes a pg_cron job by ID. The job will no longer be scheduled.
   *
   * @param id - Numeric job ID to delete.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async deleteJob(id: number): Promise<void> {
    await this.base.delete(`/v1/cron/${this.ref}/jobs/${id}`)
  }

  /**
   * Returns the execution history for a single pg_cron job.
   *
   * @param id - Numeric job ID whose history to retrieve.
   * @param limit - Optional maximum number of run records to return.
   * @returns An object containing the run list and total count.
   * @throws {MimDBApiError} On non-OK response or network failure.
   */
  async getJobHistory(id: number, limit?: number): Promise<{ history: CronJobRun[]; total: number }> {
    return this.base.get(`/v1/cron/${this.ref}/jobs/${id}/history`, { query: { limit } })
  }
}
