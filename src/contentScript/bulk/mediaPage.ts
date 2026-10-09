/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { DownloadTweetMediaMessage, sendMessage } from '#libs/webExtMessage'
import { getScreenNameFromLink, getTweetIdFromLink } from '../utils/article'

const MEDIA_PAGE_REGEX = /^\/[^/]+\/media\/?$/

const BUTTON_ID = 'mh-download-all-images-button'
const SCROLL_INTERVAL_MS = 1200
const MAX_SCROLL_ROUNDS = 500
const STABLE_ROUNDS = 5
const SEND_INTERVAL_MS = 300

type TweetInfo = { tweetId: string; screenName: string }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Whether the current page is a user's media tab (e.g. `/user/media`). */
export const isUserMediaPage = () =>
  MEDIA_PAGE_REGEX.test(window.location.pathname)

/**
 * Collect the tweet infos of every media cell currently rendered in the
 * primary column. The media grid links each cell to `/<user>/status/<id>/photo/N`.
 */
export const collectMediaTweetInfos = (): Map<string, TweetInfo> => {
  const found = new Map<string, TweetInfo>()
  const anchors = document.querySelectorAll<HTMLAnchorElement>(
    '[data-testid="primaryColumn"] a[href*="/status/"]'
  )

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') ?? ''
    const tweetId = getTweetIdFromLink(href)
    const screenName = getScreenNameFromLink(href)
    if (tweetId && screenName) found.set(tweetId, { tweetId, screenName })
  }

  return found
}

const makeButton = (): HTMLButtonElement => {
  const button = document.createElement('button')
  button.id = BUTTON_ID
  button.type = 'button'
  button.textContent = 'Download all images'
  button.setAttribute(
    'style',
    [
      'position: fixed',
      'right: 20px',
      'bottom: 20px',
      'z-index: 2147483647',
      'padding: 10px 16px',
      'border: none',
      'border-radius: 9999px',
      'background: #1d9bf0',
      'color: #fff',
      'font-size: 14px',
      'font-weight: 600',
      'cursor: pointer',
      'box-shadow: rgba(0,0,0,0.2) 0 2px 8px',
    ].join(';')
  )
  return button
}

const setBusy = (button: HTMLButtonElement, busy: boolean) => {
  button.disabled = busy
  button.style.opacity = busy ? '0.7' : '1'
  button.style.cursor = busy ? 'default' : 'pointer'
}

const runBulk = async (button: HTMLButtonElement) => {
  setBusy(button, true)
  button.textContent = 'Scanning...'

  const found: Map<string, TweetInfo> = new Map()
  let lastCount = -1
  let stable = 0

  for (let i = 0; i < MAX_SCROLL_ROUNDS && stable < STABLE_ROUNDS; i++) {
    for (const [id, info] of collectMediaTweetInfos()) found.set(id, info)
    button.textContent = `Scanning... found ${found.size}`
    window.scrollTo(0, document.documentElement.scrollHeight)
    await sleep(SCROLL_INTERVAL_MS)
    for (const [id, info] of collectMediaTweetInfos()) found.set(id, info)

    if (found.size === lastCount) stable += 1
    else {
      stable = 0
      lastCount = found.size
    }
  }

  window.scrollTo(0, 0)

  const list = [...found.values()]
  let done = 0
  for (const info of list) {
    button.textContent = `Downloading images... ${done}/${list.length}`
    try {
      await sendMessage(
        new DownloadTweetMediaMessage({ ...info, imagesOnly: true })
      )
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[MediaHarvest] bulk download failed', info, error)
    }
    done += 1
    await sleep(SEND_INTERVAL_MS)
  }

  button.textContent = `Done: ${done} tweet(s)`
  setBusy(button, false)
  setTimeout(() => {
    button.textContent = 'Download all images'
  }, 4000)
}

const ensureButton = () => {
  if (document.getElementById(BUTTON_ID)) return
  const button = makeButton()
  button.addEventListener('click', () => void runBulk(button))
  document.body.appendChild(button)
}

const removeButton = () => document.getElementById(BUTTON_ID)?.remove()

/**
 * Mount the "Download all images" button on a user's media page. Re-checks the
 * current path on an interval so it survives X's SPA navigation.
 */
export const mountMediaPageBulk = () => {
  const tick = () => (isUserMediaPage() ? ensureButton() : removeButton())
  tick()
  window.setInterval(tick, 1000)
}
