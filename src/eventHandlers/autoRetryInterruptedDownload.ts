/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import type { DomainEventHandler } from '#domain/eventPublisher'
import type { Notifier } from '#domain/notifier'
import type { IDownloadRecordRepository } from '#domain/repositories/downloadRecord'
import type { ISettingsRepository } from '#domain/repositories/settings'
import type { DownloadMediaFileUseCaseBuilder } from '#domain/useCases/downloadMediaFile'
import type { DownloadSettings } from '#schema'
import type { Notifications } from 'webextension-polyfill'
import { notifyDownloadInterrupted } from './notifyDownloadInterrupted'
import { retryFailedDownload } from './retryFailedDownload'

const MAX_RETRY = 3
const RETRY_DELAYS = [3_000, 8_000, 15_000]

/**
 * Automatic retry for interrupted downloads (e.g. a network blip or switching a
 * VPN node). After {@link MAX_RETRY} failed attempts it falls back to the
 * regular "download failed" notification with its manual Retry button.
 *
 * Attempts are counted per download target (keyed by url) so the counter
 * survives the new download id each retry gets. Retries happen within seconds,
 * so a plain in-memory map is sufficient.
 */
const attemptsByTarget = new Map<string, number>()

export const autoRetryInterruptedDownload =
  (
    notifier: Notifier<Notifications.CreateNotificationOptions>,
    downloadSettingsRepo: ISettingsRepository<DownloadSettings>,
    recordRepo: IDownloadRecordRepository,
    buildDownloader: DownloadMediaFileUseCaseBuilder
  ): DomainEventHandler<DownloadInterruptedEvent> =>
  async (event, publisher) => {
    // A user cancellation should never be retried.
    if (event.reason === 'USER_CANCELED') return

    const { value: record, error } = await recordRepo.getById(event.downloadId)
    if (error) return

    const key = record
      .mapBy(props => props.downloadConfig)
      .mapBy(props => props.url)
    const tried = attemptsByTarget.get(key) ?? 0

    if (tried < MAX_RETRY) {
      attemptsByTarget.set(key, tried + 1)
      const delay = RETRY_DELAYS[Math.min(tried, RETRY_DELAYS.length - 1)]
      // eslint-disable-next-line no-console
      console.log(
        `[MediaHarvest] Auto-retry ${tried + 1}/${MAX_RETRY} in ${delay}ms`
      )

      setTimeout(() => {
        void retryFailedDownload(downloadSettingsRepo, recordRepo, buildDownloader)(
          event,
          publisher
        )
      }, delay)
      return
    }

    attemptsByTarget.delete(key)
    await notifyDownloadInterrupted(notifier, recordRepo)(event, publisher)
  }
