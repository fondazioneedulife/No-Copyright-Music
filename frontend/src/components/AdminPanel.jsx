import { useState } from "react";

export function AdminPanel({
  users,
  currentUser,
  onCreateUser,
  onDeleteUser,
  onResetUserPassword,
  status,
  statusType = "success",
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [busy, setBusy] = useState(false);
  const [deletingUsername, setDeletingUsername] = useState("");
  const [resettingUsername, setResettingUsername] = useState("");
  const [pendingDeleteUser, setPendingDeleteUser] = useState(null);

  async function handleCreate(event) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      return;
    }

    setBusy(true);
    try {
      const created = await onCreateUser({ name: cleanName, username: cleanName, role });
      if (created) {
        setName("");
        setRole("user");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(user) {
    if (user.username === currentUser?.username) {
      return;
    }

    setDeletingUsername(user.username);
    try {
      await onDeleteUser(user.username);
    } finally {
      setDeletingUsername("");
      setPendingDeleteUser(null);
    }
  }

  async function handleResetPassword(user) {
    if (user.username === currentUser?.username) {
      return;
    }

    setResettingUsername(user.username);
    try {
      await onResetUserPassword(user.username);
    } finally {
      setResettingUsername("");
    }
  }

  return (
    <section className="panel admin-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Gestione utenti</h2>
          <p>La creazione utenti usa il database SQLite gia' presente nel backend.</p>
        </div>
      </div>

      <form className="admin-form" onSubmit={handleCreate}>
        <label>
          Nome utente
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="es. postazione-bar"
          />
        </label>
        <label>
          Ruolo
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="user">Utente normale</option>
            <option value="admin">Amministratore</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creo..." : "Crea utente"}
        </button>
      </form>

      {status ? <p className={`status-banner is-${statusType}`}>{status}</p> : null}

      <div className="user-list">
        {users.length === 0 ? <p className="empty-state">Nessun utente presente.</p> : null}
        {users.map((user) => (
          <article key={user.username}>
            <div>
              <strong>{user.name}</strong>
              <span>@{user.username}</span>
            </div>
            <div className="user-actions">
              <span className="role-pill">{user.role}</span>
              {user.mustChangePassword ? <span className="role-pill is-warning">temp</span> : null}
              <button
                type="button"
                className="secondary-button"
                disabled={user.username === currentUser?.username || resettingUsername === user.username}
                onClick={() => handleResetPassword(user)}
              >
                {resettingUsername === user.username ? "Reset..." : "Reset"}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={user.username === currentUser?.username || deletingUsername === user.username}
                onClick={() => setPendingDeleteUser(user)}
              >
                {deletingUsername === user.username ? "Elimino..." : "Elimina"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {pendingDeleteUser ? (
        <div className="app-modal-backdrop" role="presentation" onClick={() => setPendingDeleteUser(null)}>
          <section
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-user-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Conferma</p>
            <h3 id="delete-user-title">Eliminare utente?</h3>
            <p>
              Stai per eliminare <strong>{pendingDeleteUser.name}</strong> (@{pendingDeleteUser.username}).
              L'utente non potra' piu' accedere con questa sessione.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setPendingDeleteUser(null)}>
                Annulla
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={deletingUsername === pendingDeleteUser.username}
                onClick={() => handleDelete(pendingDeleteUser)}
              >
                {deletingUsername === pendingDeleteUser.username ? "Elimino..." : "Elimina utente"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
