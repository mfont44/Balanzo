/**
 * Tally.app – User-friendly auth error messages.
 * Maps Supabase/auth and network errors for in-app alert modals.
 */

export function getAuthErrorMessage(error: Error | null): string {
  if (!error) return 'Something went wrong.';
  const msg = (error as Error & { message?: string }).message ?? '';
  const lower = msg.toLowerCase();
  if (
    lower.includes('invalid login') ||
    lower.includes('invalid credentials') ||
    lower.includes('invalid_credentials')
  ) {
    return 'Invalid credentials. Check your email and password.';
  }
  if (
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('connection') ||
    lower.includes('failed to fetch')
  ) {
    return 'Network error. Check your connection and try again.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }
  if (lower.includes('user already registered') || lower.includes('already registered')) {
    return 'An account with this email already exists. Sign in instead.';
  }
  return msg || 'Something went wrong. Please try again.';
}
