import type { Session } from '@supabase/supabase-js'

export const AUTH_RESTORE_TIMEOUT_MS = 10_000

// A refresh can keep retrying while the backend is asleep. Keep the saved
// session intact, but give the user a way out of the loading screen.
export function watchSessionRestore(
  restore: () => Promise<{ data: { session: Session | null }; error: { message: string } | null }>,
  onSession: (session: Session | null) => void,
  onFailure: (message: string) => void,
  timeoutMs = AUTH_RESTORE_TIMEOUT_MS,
) {
  let active = true
  const timer = setTimeout(() => {
    if (active) onFailure('Cloud sign-in is taking longer than expected. Your saved session and flight records have not been cleared.')
  }, timeoutMs)
  void Promise.resolve().then(restore).then(({ data, error }) => {
    if (!active) return
    clearTimeout(timer)
    if (error) onFailure(error.message)
    else onSession(data.session)
  }).catch((error: unknown) => {
    if (!active) return
    clearTimeout(timer)
    onFailure(error instanceof Error ? error.message : 'Unable to restore your cloud session. Please try again.')
  })
  return () => { active = false; clearTimeout(timer) }
}
