const coverSize = 1024;

const genrePalettes = {
  Ambient: ["#173b46", "#6aa8a1", "#d9bd83", "#fff7e8"],
  Cinematic: ["#19213a", "#c4613f", "#e0b15f", "#fff1d9"],
  Corporate: ["#1c3144", "#2f7f83", "#d7b98e", "#fff6e7"],
  "Drum & Bass": ["#10233f", "#2f7f83", "#d05f3a", "#f5eadc"],
  Electronic: ["#102a3f", "#2f7f83", "#e0b15f", "#f7efe1"],
  "Hip Hop": ["#2a1b18", "#c65f3d", "#e0b15f", "#fff3df"],
  House: ["#153444", "#2f7f83", "#c65f3d", "#fff4e3"],
  Lofi: ["#352926", "#d7a46f", "#789b94", "#fff0d7"],
  Piano: ["#1d2635", "#d7dde8", "#8c7a62", "#fffaf0"],
  Pop: ["#20314a", "#d8644a", "#e7bf69", "#fff7dc"],
  Rock: ["#351713", "#c65f3d", "#b77b45", "#fff0da"],
  Trap: ["#211c34", "#6b6f9c", "#d05f3a", "#f1eaff"],
};

const fallbackPalette = ["#14213d", "#2f7f83", "#c65f3d", "#fff6e7"];

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hashString(value) {
  const text = String(value || "clearwave");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function cleanText(value, fallback) {
  return String(value || fallback || "")
    .replace(/\s+/g, " ")
    .trim();
}

function initials(value) {
  const words = cleanText(value, "CW")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "CW";
}

function splitTitle(value) {
  const title = cleanText(value, "Untitled Track");
  const words = title.split(/\s+/);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 18 && current) {
      lines.push(current);
      current = word;
      return;
    }
    current = next;
  });

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 3);
}

function paletteForGenre(genre) {
  return genrePalettes[cleanText(genre, "Electronic")] || fallbackPalette;
}

function shapeLayer(seed, palette) {
  const rings = Array.from({ length: 8 }, (_, index) => {
    const angle = ((seed >> (index % 12)) + index * 43) % 360;
    const cx = 120 + ((seed * (index + 7)) % 780);
    const cy = 120 + ((seed * (index + 11)) % 780);
    const radius = 70 + ((seed >> (index + 2)) % 190);
    const stroke = palette[index % palette.length];
    const opacity = (0.16 + (index % 4) * 0.05).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${stroke}" stroke-width="${10 + index * 3}" opacity="${opacity}" transform="rotate(${angle} ${cx} ${cy})" />`;
  }).join("");

  const bars = Array.from({ length: 18 }, (_, index) => {
    const x = 54 + index * 55;
    const height = 120 + ((seed >> (index % 16)) % 360);
    const y = 820 - height;
    const opacity = (0.08 + (index % 5) * 0.025).toFixed(3);
    return `<rect x="${x}" y="${y}" width="24" height="${height}" rx="12" fill="${palette[(index + 1) % palette.length]}" opacity="${opacity}" />`;
  }).join("");

  const diagonal = 120 + (seed % 420);
  return `
    <g opacity="0.92">
      ${rings}
      <path d="M -80 ${diagonal} L ${diagonal} -80 L 1110 ${930 - diagonal} L ${930 - diagonal} 1110 Z" fill="${palette[1]}" opacity="0.18" />
      ${bars}
    </g>
  `;
}

function buildTrackCoverSvg(track = {}) {
  const title = cleanText(track.title, "Untitled Track");
  const artist = cleanText(track.creatorName || track.subtitle, "ClearWave Library");
  const genre = cleanText(track.genre, "Electronic");
  const mood = cleanText(track.mood, "Commercial-safe");
  const duration = cleanText(track.duration, "");
  const seed = hashString(`${track.id || ""}|${title}|${artist}|${genre}|${mood}`);
  const palette = paletteForGenre(genre);
  const titleLines = splitTitle(title);
  const titleFontSize = titleLines.length > 2 ? 72 : 84;
  const code = initials(`${title} ${artist}`);
  const grainOpacity = ((seed % 14) + 10) / 100;

  const titleText = titleLines
    .map((line, index) => (
      `<text x="70" y="${652 + index * (titleFontSize + 8)}" font-size="${titleFontSize}" font-weight="900" letter-spacing="-3" fill="${palette[3]}">${escapeXml(line)}</text>`
    ))
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${coverSize}" height="${coverSize}" viewBox="0 0 ${coverSize} ${coverSize}" role="img" aria-label="${escapeXml(title)} cover">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette[0]}" />
      <stop offset="52%" stop-color="${palette[1]}" />
      <stop offset="100%" stop-color="#050607" />
    </linearGradient>
    <radialGradient id="glow" cx="${25 + (seed % 50)}%" cy="${18 + (seed % 44)}%" r="68%">
      <stop offset="0%" stop-color="${palette[2]}" stop-opacity="0.78" />
      <stop offset="54%" stop-color="${palette[1]}" stop-opacity="0.18" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </radialGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="32" stdDeviation="28" flood-color="#000000" flood-opacity="0.38" />
    </filter>
    <pattern id="grain" width="32" height="32" patternUnits="userSpaceOnUse">
      <rect width="32" height="32" fill="#ffffff" opacity="${grainOpacity.toFixed(2)}" />
      <circle cx="8" cy="9" r="1.3" fill="#000000" opacity="0.18" />
      <circle cx="23" cy="18" r="1.1" fill="#000000" opacity="0.14" />
      <circle cx="17" cy="27" r="0.9" fill="#000000" opacity="0.16" />
    </pattern>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)" />
  <rect width="1024" height="1024" fill="url(#glow)" />
  ${shapeLayer(seed, palette)}
  <g filter="url(#softShadow)">
    <rect x="62" y="62" width="900" height="900" rx="58" fill="none" stroke="${palette[3]}" stroke-opacity="0.18" stroke-width="2" />
    <circle cx="${730 - (seed % 140)}" cy="${270 + (seed % 180)}" r="${138 + (seed % 80)}" fill="${palette[2]}" opacity="0.22" />
    <circle cx="${260 + (seed % 150)}" cy="${310 - (seed % 90)}" r="${92 + (seed % 70)}" fill="${palette[3]}" opacity="0.12" />
  </g>
  <rect width="1024" height="1024" fill="url(#grain)" opacity="0.2" />
  <g>
    <text x="70" y="112" font-size="32" font-weight="800" letter-spacing="8" fill="${palette[3]}" opacity="0.82">CLEARWAVE</text>
    <text x="70" y="160" font-size="25" font-weight="700" letter-spacing="4" fill="${palette[3]}" opacity="0.55">${escapeXml(genre.toUpperCase())}</text>
    <rect x="70" y="212" width="154" height="154" rx="34" fill="#000000" opacity="0.28" />
    <text x="147" y="307" text-anchor="middle" font-size="56" font-weight="900" fill="${palette[3]}">${escapeXml(code)}</text>
  </g>
  <g>
    ${titleText}
    <text x="72" y="900" font-size="34" font-weight="750" fill="${palette[3]}" opacity="0.72">${escapeXml(artist).slice(0, 54)}</text>
    <text x="72" y="944" font-size="24" font-weight="700" letter-spacing="5" fill="${palette[3]}" opacity="0.48">${escapeXml([mood, duration].filter(Boolean).join(" / ").toUpperCase())}</text>
  </g>
</svg>`;
}

function coverAltForTrack(track = {}) {
  return `${cleanText(track.title, "Track")} album cover 1024x1024`;
}

function trackCoverPath(track = {}) {
  const params = new URLSearchParams();
  params.set("id", cleanText(track.id, cleanText(track.title, "track")));
  params.set("title", cleanText(track.title, "Untitled Track"));
  params.set("artist", cleanText(track.creatorName || track.subtitle, "ClearWave Library"));
  params.set("genre", cleanText(track.genre, "Electronic"));
  params.set("mood", cleanText(track.mood, "Commercial-safe"));
  params.set("duration", cleanText(track.duration, ""));
  return `/api/covers/generated.svg?${params.toString()}`;
}

module.exports = {
  buildTrackCoverSvg,
  coverAltForTrack,
  trackCoverPath,
};
