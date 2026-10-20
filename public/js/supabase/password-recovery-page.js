import { isPasswordRecoveryLink } from './password-recovery.js';

// Keep the normal homepage lightweight: only initialize Supabase when the URL
// indicates that the visitor followed a password-recovery link.
if (isPasswordRecoveryLink(window.location.hash, window.location.search)) {
  const { supabase } = await import('./client.js');
  const { applyPasswordReset } = await import('./auth.js');

  function showRecoveryForm() {
    if (document.getElementById('anvesh-password-recovery-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'anvesh-password-recovery-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'anvesh-recovery-title');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.78);display:grid;place-items:center;padding:20px;overflow:auto';
    overlay.innerHTML = `
      <section class="card" style="width:100%;max-width:480px;box-sizing:border-box;background:#fff">
        <h2 id="anvesh-recovery-title">Reset your Anvesh password</h2>
        <p class="muted">Choose a new password of at least 8 characters.</p>
        <form id="anveshRecoveryForm">
          <label for="anveshNewPassword">New password</label>
          <input id="anveshNewPassword" type="password" autocomplete="new-password" minlength="8" required>
          <label for="anveshConfirmPassword">Confirm new password</label>
          <input id="anveshConfirmPassword" type="password" autocomplete="new-password" minlength="8" required>
          <p id="anveshRecoveryStatus" class="alert error hidden" role="status" aria-live="polite"></p>
          <button id="anveshRecoverySubmit" type="submit" style="width:100%;margin-top:12px">Update password</button>
        </form>
      </section>`;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('#anveshRecoveryForm');
    const status = overlay.querySelector('#anveshRecoveryStatus');
    const button = overlay.querySelector('#anveshRecoverySubmit');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.classList.add('hidden');
      button.disabled = true;
      button.textContent = 'Updating…';
      try {
        await applyPasswordReset(
          overlay.querySelector('#anveshNewPassword').value,
          overlay.querySelector('#anveshConfirmPassword').value,
        );
        try { await supabase.auth.signOut(); } catch { /* Password is already updated. */ }
        window.history.replaceState(null, '', window.location.pathname);
        overlay.innerHTML = `
          <section class="card" style="width:100%;max-width:480px;box-sizing:border-box;background:#fff">
            <h2>Password updated</h2>
            <p>Your password has been changed. Sign in using your new password.</p>
            <a class="btn" href="/supabase-login.html">Return to login</a>
          </section>`;
      } catch (error) {
        status.textContent = error.message || 'Could not update the password. Open the newest reset link and try again.';
        status.className = 'alert error';
      } finally {
        button.disabled = false;
        button.textContent = 'Update password';
      }
    });
  }

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showRecoveryForm();
  });
  showRecoveryForm();
}
