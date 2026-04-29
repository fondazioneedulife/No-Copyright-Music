const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function slugifyAccount(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function makeTempPassword() {
  return `CW-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHash] = String(storedHash || "").split(":");
  if (!salt || !expectedHash) {
    return false;
  }
  const actualHash = hashPassword(password, salt).split(":")[1];
  if (actualHash.length !== expectedHash.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

function createAuthService({ authDbFile, initialAdminPassword = "admin123" }) {
  const authSessions = new Map();

  function openAuthDb() {
    return new DatabaseSync(authDbFile);
  }

  function publicUser(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      name: row.name,
      role: row.role === "admin" ? "admin" : "user",
      mustChangePassword: Boolean(row.must_change_password),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function ensureAuthDatabase() {
    const db = openAuthDb();
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
          password_hash TEXT NOT NULL,
          must_change_password INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      const countRow = db.prepare("SELECT COUNT(*) AS count FROM users").get();
      if (Number(countRow?.count || 0) === 0) {
        db.prepare(
          `INSERT INTO users
            (id, username, name, role, password_hash, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          "admin",
          "admin",
          "Amministratore",
          "admin",
          hashPassword(initialAdminPassword),
          1,
          nowIso(),
          nowIso()
        );
      }
    } finally {
      db.close();
    }
  }

  function getBearerToken(req) {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : "";
  }

  function authUserFromRequest(req) {
    const token = getBearerToken(req);
    if (!token) {
      return null;
    }
    return authSessions.get(token) || null;
  }

  function isAdminRequest(req) {
    const sessionUser = authUserFromRequest(req);
    return sessionUser?.role === "admin";
  }

  function requireAdminRequest(req) {
    if (!isAdminRequest(req)) {
      throw httpError(403, "Solo l'amministratore puo' modificare il catalogo.");
    }
  }

  function requireAuthRequest(req) {
    const user = authUserFromRequest(req);
    if (!user) {
      throw httpError(401, "Accesso richiesto.");
    }
    return user;
  }

  function findUserByUsername(username) {
    const db = openAuthDb();
    try {
      return db.prepare("SELECT * FROM users WHERE username = ?").get(username) || null;
    } finally {
      db.close();
    }
  }

  function listAuthUsers() {
    const db = openAuthDb();
    try {
      return db
        .prepare("SELECT id, username, name, role, must_change_password, created_at, updated_at FROM users ORDER BY role, name")
        .all()
        .map(publicUser);
    } finally {
      db.close();
    }
  }

  function createAuthUser(payload) {
    const name = String(payload?.name || payload?.username || "").trim();
    const username = slugifyAccount(payload?.username || name);
    const role = payload?.role === "admin" ? "admin" : "user";
    if (!name || !username) {
      throw httpError(400, "Nome utente non valido.");
    }
    if (findUserByUsername(username)) {
      throw httpError(409, "Questo username esiste gia'.");
    }

    const tempPassword = makeTempPassword();
    const createdAt = nowIso();
    const db = openAuthDb();
    try {
      db.prepare(
        `INSERT INTO users
          (id, username, name, role, password_hash, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        username,
        username,
        name,
        role,
        hashPassword(tempPassword),
        1,
        createdAt,
        createdAt
      );
    } finally {
      db.close();
    }

    return {
      user: publicUser(findUserByUsername(username)),
      tempPassword,
    };
  }

  function deleteAuthUser(req, usernameParam) {
    const sessionUser = authUserFromRequest(req);
    const username = slugifyAccount(usernameParam);
    if (!username) {
      throw httpError(400, "Username non valido.");
    }
    if (sessionUser?.username === username) {
      throw httpError(400, "Non puoi eliminare l'utente con cui sei collegato.");
    }

    const row = findUserByUsername(username);
    if (!row) {
      throw httpError(404, "Utente non trovato.");
    }

    const db = openAuthDb();
    try {
      if (row.role === "admin") {
        const admins = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'").get();
        if (Number(admins?.total || 0) <= 1) {
          throw httpError(400, "Deve restare almeno un amministratore.");
        }
      }
      db.prepare("DELETE FROM users WHERE username = ?").run(username);
    } finally {
      db.close();
    }

    for (const [token, user] of authSessions.entries()) {
      if (user?.username === username) {
        authSessions.delete(token);
      }
    }
    return publicUser(row);
  }

  function resetAuthUserPassword(req, usernameParam) {
    const sessionUser = authUserFromRequest(req);
    const username = slugifyAccount(usernameParam);
    if (!username) {
      throw httpError(400, "Username non valido.");
    }
    if (sessionUser?.username === username) {
      throw httpError(400, "Usa Impostazioni per cambiare la tua password.");
    }

    const row = findUserByUsername(username);
    if (!row) {
      throw httpError(404, "Utente non trovato.");
    }

    const tempPassword = makeTempPassword();
    const updatedAt = nowIso();
    const db = openAuthDb();
    try {
      db.prepare(
        "UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE username = ?"
      ).run(hashPassword(tempPassword), updatedAt, username);
    } finally {
      db.close();
    }

    for (const [token, user] of authSessions.entries()) {
      if (user?.username === username) {
        authSessions.delete(token);
      }
    }

    return {
      user: publicUser(findUserByUsername(username)),
      tempPassword,
    };
  }

  function loginAuthUser(payload) {
    const username = slugifyAccount(payload?.username || "");
    const password = String(payload?.password || "");
    if (!username || !password) {
      throw httpError(400, "Inserisci username e password.");
    }

    const row = findUserByUsername(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw httpError(401, "Credenziali non valide.");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const user = publicUser(row);
    authSessions.set(token, user);
    return { token, user };
  }

  function changeAuthPassword(req, payload) {
    const sessionUser = requireAuthRequest(req);
    const currentPassword = String(payload?.currentPassword || "");
    const newPassword = String(payload?.newPassword || "");
    if (newPassword.length < 6) {
      throw httpError(400, "La nuova password deve avere almeno 6 caratteri.");
    }

    const row = findUserByUsername(sessionUser.username);
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      throw httpError(401, "Password attuale non valida.");
    }

    const updatedAt = nowIso();
    const db = openAuthDb();
    try {
      db.prepare(
        "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE username = ?"
      ).run(hashPassword(newPassword), updatedAt, sessionUser.username);
    } finally {
      db.close();
    }

    const updatedUser = publicUser(findUserByUsername(sessionUser.username));
    const token = getBearerToken(req);
    if (token) {
      authSessions.set(token, updatedUser);
    }
    return updatedUser;
  }

  function logoutAuthToken(token) {
    if (token) {
      authSessions.delete(token);
    }
  }

  return {
    authUserFromRequest,
    changeAuthPassword,
    createAuthUser,
    deleteAuthUser,
    ensureAuthDatabase,
    getBearerToken,
    isAdminRequest,
    listAuthUsers,
    loginAuthUser,
    logoutAuthToken,
    requireAdminRequest,
    requireAuthRequest,
    resetAuthUserPassword,
  };
}

module.exports = {
  createAuthService,
};
