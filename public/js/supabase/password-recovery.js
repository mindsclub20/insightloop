// Small, dependency-injected helpers so auth recovery behavior can be tested without a browser.
export function getPasswordRecoveryRedirectTo(origin) {
  if (!origin || typeof origin !== 'string') throw new Error('Password recovery site origin is missing.');
  return new URL('/', origin).toString();
}

export async function requestPasswordReset(supabase, email, redirectTo) {
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  if (!normalizedEmail) throw new Error('Enter your email address first.');
  if (!redirectTo || typeof redirectTo !== 'string') {
    throw new Error('Password recovery redirect URL is missing.');
  }

  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
  if (error) throw error;
  return { ok: true };
}

export async function applyPasswordReset(supabase, password, confirmPassword) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Your new password must be at least 8 characters long.');
  }
  if (password !== confirmPassword) throw new Error('The passwords do not match.');

  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

export function isMissingAuthSessionError(error) {
  if (!error) return false;
  return error.name === 'AuthSessionMissingError'
    || /auth session missing/i.test(String(error.message || ''));
}
