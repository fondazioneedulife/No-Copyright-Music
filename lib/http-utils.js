const path = require("node:path");

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, options = {}) {
  return new Promise((resolve, reject) => {
    const limit = options.limit || 25 * 1024 * 1024;
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, "Payload troppo grande. Riduci dimensione dei file."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, "JSON non valido."));
      }
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

function isPathInsideDirectory(directory, targetPath) {
  const relative = path.relative(directory, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function contentDisposition(downloadName, fallbackName = "clearwave-track.wav") {
  const safeName = String(downloadName || fallbackName)
    .replace(/["\\]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .slice(0, 140);
  return `attachment; filename="${safeName || fallbackName}"`;
}

function downloadText(res, downloadName, contentType, text) {
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Disposition": contentDisposition(downloadName),
    "Content-Type": contentType,
  });
  res.end(text);
}

function csvValue(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

function exportStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

module.exports = {
  contentDisposition,
  csvValue,
  downloadText,
  exportStamp,
  httpError,
  isPathInsideDirectory,
  json,
  readJsonBody,
};
