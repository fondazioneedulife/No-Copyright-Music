async function fetchLibrary(options = {}) {
  if (!options.quiet) {
    setStatus(dom.libraryStatus, "Caricamento catalogo dal backend locale...");
  }

  try {
    const response = await fetch("/api/tracks");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Impossibile leggere il catalogo.");
    }

    tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
    cleanSelectedIds();
    populateFilters();
    renderAll();
    setStatus(dom.libraryStatus, "Catalogo sincronizzato con il backend locale.", "success");
  } catch (error) {
    tracks = [];
    renderAll();
    setStatus(
      dom.libraryStatus,
      error.message || "Il backend non e' raggiungibile. Avvia il server Node.",
      "error"
    );
  }
}

function populateDiscoveryProviderSelect() {
  const current = dom.discoveryProviderSelect.value || "all";
  const rightsMode = dom.discoveryRightsMode.value || "public_domain_only";
  const visibleProviders = discoveryProviders.filter((provider) =>
    Array.isArray(provider.rightsModes) ? provider.rightsModes.includes(rightsMode) : true
  );
  dom.discoveryProviderSelect.innerHTML =
    '<option value="all">YouTube + Jamendo</option>';

  visibleProviders.forEach((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.id === "youtube_curated"
      ? "YouTube"
      : provider.configured
        ? provider.name
        : `${provider.name} (configurazione richiesta)`;
    dom.discoveryProviderSelect.append(option);
  });

  dom.discoveryProviderSelect.value = visibleProviders.some((provider) => provider.id === current)
    ? current
    : "all";
}

function renderProviderPills() {
  if (discoveryProviders.length === 0) {
    dom.providerPills.innerHTML =
      '<p class="selection-empty">Nessun provider discovery disponibile.</p>';
    return;
  }

  dom.providerPills.innerHTML = discoveryProviders
    .map(
      (provider) => `
        <article class="provider-pill">
          <strong>${escapeHtml(provider.name)}</strong>
          <span>${escapeHtml(provider.commercialModel || "")}</span>
          <p>${escapeHtml(provider.note || "")}</p>
          <span class="tag ${provider.configured ? "is-success" : "is-warning"}">
            ${provider.configured ? "Pronto" : "Setup richiesto"}
          </span>
        </article>
      `
    )
    .join("");
}

async function fetchDiscoveryProviders() {
  try {
    const response = await fetch("/api/discovery/providers");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Impossibile leggere i provider esterni.");
    }

    discoveryProviders = Array.isArray(payload.providers) ? payload.providers : [];
    populateDiscoveryProviderSelect();
    renderProviderPills();
  } catch (error) {
    discoveryProviders = [];
    populateDiscoveryProviderSelect();
    renderProviderPills();
    setStatus(
      dom.discoveryStatus,
      error.message || "Provider esterni non disponibili.",
      "error"
    );
  }
}

