import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase'
import type { Profile } from '@/types'

type AuthContextValue = {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Opens Google consent; returns to `redirectPath` on your site (defaults to `/`). */
  signInWithGoogle: (redirectPath?: string) => Promise<void>
  signOut: () => Promise<void>
  /** Updates profile row and refreshes local `profile`. */
  updateProfile: (patch: Partial<Pick<Profile, 'display_name' | 'payment_account_number'>>) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const user = session?.user ?? null

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) {
      console.error(error)
      setProfile(null)
      return
    }
    setProfile(data as Profile | null)
  }, [])

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session ?? null)
      setLoading(false)
      if (data.session?.user) {
        const uid = data.session.user.id
        void (async () => {
          try {
            await supabase.rpc('ensure_my_profile')
          } catch {
            /* RPC missing until migration 0003 is applied */
          }
          void loadProfile(uid)
        })()
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      if (sess?.user) {
        const uid = sess.user.id
        void (async () => {
          try {
            await supabase.rpc('ensure_my_profile')
          } catch {
            /* RPC missing until migration 0003 is applied */
          }
          void loadProfile(uid)
        })()
      } else {
        setProfile(null)
      }
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signInWithGoogle = useCallback(async (redirectPath = '/') => {
    const path = redirectPath.startsWith('/') ? redirectPath : `/${redirectPath}`
    const redirectTo = new URL(path, window.location.origin).href
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        scopes: 'email profile',
      },
    })
    if (error) throw error
    if (data.url) {
      window.location.assign(data.url)
      return
    }
    throw new Error('Google sign-in did not return a redirect URL')
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const updateProfile = useCallback(
    async (patch: Partial<Pick<Profile, 'display_name' | 'payment_account_number'>>) => {
      if (!user) throw new Error('Not signed in')
      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
      if (error) throw error
      await loadProfile(user.id)
    },
    [user, loadProfile]
  )

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      loading,
      signInWithGoogle,
      signOut,
      updateProfile,
    }),
    [user, session, profile, loading, signInWithGoogle, signOut, updateProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
