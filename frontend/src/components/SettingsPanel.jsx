import { useState } from "react";

export function SettingsPanel({ user, onChangePassword, status, statusType = "success" }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const changed = await onChangePassword({ currentPassword, newPassword });
      if (changed) {
        setCurrentPassword("");
        setNewPassword("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Impostazioni</p>
          <h2>Account</h2>
          <p>
            Connesso come <strong>{user?.name || user?.username}</strong>. Puoi cambiare password
            da qui.
          </p>
        </div>
      </div>

      <form className="admin-form" onSubmit={handleSubmit}>
        <label>
          Password attuale
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <label>
          Nuova password
          <input
            type="password"
            value={newPassword}
            minLength={6}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || !currentPassword || newPassword.length < 6}>
          {busy ? "Aggiorno..." : "Cambia password"}
        </button>
      </form>

      {status ? <p className={`status-banner is-${statusType}`}>{status}</p> : null}
    </section>
  );
}
