// Bootstrap della UI legacy: inizializza tema/eventi e poi sincronizza auth, catalogo e provider.
// La logica reale e' suddivisa nei moduli dentro src/ per evitare un unico app.js enorme.
applyTheme();
bindControls();

async function bootClearWave() {
  await verifyAuthSession();
  await fetchLibrary();
  await fetchDiscoveryProviders();
}

void bootClearWave();
