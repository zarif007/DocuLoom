/**
 * API key storage.
 *
 * Keys never go in the database and are never sent to the frontend. On macOS
 * they live in the login keychain; elsewhere they fall back to a 0600 file in
 * the data directory. An environment variable always wins, so CI and
 * throwaway runs need no stored secret at all.
 */
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DATA_DIR } from '../db/index.js'

const run = promisify(execFile)
const SERVICE = 'doculoom'
const isMac = process.platform === 'darwin'

function filePath(account: string) {
  return join(DATA_DIR, `.${account}.key`)
}

export async function readKey(account: string, envVar: string): Promise<string | null> {
  const fromEnv = process.env[envVar]
  if (fromEnv) return fromEnv

  if (isMac) {
    try {
      const { stdout } = await run('security', [
        'find-generic-password',
        '-s',
        SERVICE,
        '-a',
        account,
        '-w',
      ])
      const value = stdout.trim()
      if (value) return value
    } catch {
      // Not in the keychain; fall through to the file.
    }
  }

  const path = filePath(account)
  if (existsSync(path)) {
    const value = readFileSync(path, 'utf8').trim()
    if (value) return value
  }
  return null
}

export async function writeKey(account: string, value: string): Promise<void> {
  if (isMac) {
    try {
      await run('security', [
        'add-generic-password',
        '-U',
        '-s',
        SERVICE,
        '-a',
        account,
        '-w',
        value,
      ])
      return
    } catch {
      // Keychain unavailable (headless session); fall back to the file.
    }
  }
  const path = filePath(account)
  writeFileSync(path, value, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export async function deleteKey(account: string): Promise<void> {
  if (isMac) {
    await run('security', ['delete-generic-password', '-s', SERVICE, '-a', account]).catch(
      () => undefined,
    )
  }
  const path = filePath(account)
  if (existsSync(path)) rmSync(path)
}
