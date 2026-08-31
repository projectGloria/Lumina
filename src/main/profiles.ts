/**
 * In-app user profiles: a name, an optional passlock, and one vault.
 *
 * The passlock is a UI gate, not encryption — a vault is an ordinary folder of
 * `.md` files by design (see CLAUDE.md), so a locked profile still leaves its
 * notes readable to anything with filesystem access. Only a scrypt hash of the
 * password is ever persisted or crosses the IPC boundary; the plaintext never
 * leaves the single `verifyProfilePassword` call that checks it.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import type { Profile } from '@shared/types'
import { loadAppState, saveAppState } from './settings'

const AVATAR_COLORS = ['#d97757', '#5b9bd5', '#70ad47', '#a273d6', '#e0a458', '#4bb3a3']

function pickColor(existing: Profile[]): string {
  return AVATAR_COLORS[existing.length % AVATAR_COLORS.length]
}

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * Every profile, migrating a pre-profiles install's `lastVault` into a default
 * profile the first time this is called, so upgrading does not strand anyone
 * on an empty picker.
 */
export async function listProfiles(): Promise<Profile[]> {
  const state = await loadAppState()
  if (state.profiles.length > 0 || !state.lastVault) return state.profiles

  const migrated: Profile = {
    id: randomUUID(),
    name: path.basename(state.lastVault),
    vaultPath: state.lastVault,
    passwordHash: null,
    color: pickColor([])
  }
  await saveAppState({ profiles: [migrated], activeProfileId: null })
  return [migrated]
}

export async function getActiveProfileId(): Promise<string | null> {
  return (await loadAppState()).activeProfileId
}

export async function createProfile(name: string): Promise<Profile> {
  const state = await loadAppState()
  const profile: Profile = {
    id: randomUUID(),
    name,
    vaultPath: null,
    passwordHash: null,
    color: pickColor(state.profiles)
  }
  await saveAppState({ profiles: [...state.profiles, profile] })
  return profile
}

export async function renameProfile(id: string, name: string): Promise<void> {
  const state = await loadAppState()
  const profiles = state.profiles.map((p) => (p.id === id ? { ...p, name } : p))
  await saveAppState({ profiles })
}

export async function deleteProfile(id: string): Promise<void> {
  const state = await loadAppState()
  const profiles = state.profiles.filter((p) => p.id !== id)
  await saveAppState({
    profiles,
    activeProfileId: state.activeProfileId === id ? null : state.activeProfileId
  })
}

export async function setProfileVault(id: string, vaultPath: string): Promise<void> {
  const state = await loadAppState()
  const profiles = state.profiles.map((p) => (p.id === id ? { ...p, vaultPath } : p))
  await saveAppState({ profiles })
}

/** Pass `password: null` to remove the passlock. */
export async function setProfilePassword(id: string, password: string | null): Promise<void> {
  const state = await loadAppState()
  const profiles = state.profiles.map((p) =>
    p.id === id ? { ...p, passwordHash: password ? hashPassword(password) : null } : p
  )
  await saveAppState({ profiles })
}

/** True (and switches the active profile) when the profile has no passlock or `password` matches it. */
export async function unlockProfile(id: string, password: string): Promise<boolean> {
  const state = await loadAppState()
  const profile = state.profiles.find((p) => p.id === id)
  if (!profile) return false
  if (profile.passwordHash && !verifyPassword(password, profile.passwordHash)) return false
  await saveAppState({ activeProfileId: id })
  return true
}

/** Switch to a profile that has no passlock; unlocked profiles use `unlockProfile` instead. */
export async function switchProfile(id: string): Promise<boolean> {
  const state = await loadAppState()
  const profile = state.profiles.find((p) => p.id === id)
  if (!profile || profile.passwordHash) return false
  await saveAppState({ activeProfileId: id })
  return true
}

export async function signOutProfile(): Promise<void> {
  await saveAppState({ activeProfileId: null })
}
