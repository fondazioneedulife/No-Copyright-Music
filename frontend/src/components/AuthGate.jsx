import { useState } from "react";

export function AuthGate({ onLogin, status }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onLogin({ username, password });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">ClearWave React</p>
        <h1>Accesso alla nuova interfaccia.</h1>
        <p>
          Questa e' la versione React affiancata: usa lo stesso backend, SQLite, catalogo e API
          della web app attuale.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
            />
          </label>
          <label>
            Password
            <input
              value={password}
              type="password"
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
            />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Entro..." : "Entra"}
          </button>
        </form>

        {status ? <p className="status-banner is-error">{status}</p> : null}
      </section>
    </main>
  );
}
