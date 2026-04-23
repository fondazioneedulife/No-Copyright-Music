function bindControls() {
  dom.searchInput.value = state.search;
  if (dom.sourceSelect) {
    dom.sourceSelect.value = state.source || "all";
  }
  dom.attributionToggle.checked = state.attributionOnly;
  dom.projectName.value = state.projectName;
  dom.projectUsage.value = state.projectUsage;
  dom.playerVolumeRange.value = String(Math.round(state.playerVolume * 100));
  renderAccountPanel();

  dom.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    state.catalogPage = 1;
    saveState();
    renderTrackGrid();
  });

  dom.genreSelect.addEventListener("change", (event) => {
    state.genre = event.target.value;
    state.catalogPage = 1;
    saveState();
    renderTrackGrid();
  });

  dom.sourceSelect?.addEventListener("change", (event) => {
    state.source = event.target.value;
    state.catalogPage = 1;
    saveState();
    renderTrackGrid();
  });

  dom.moodSelect.addEventListener("change", (event) => {
    state.mood = event.target.value;
    saveState();
    renderTrackGrid();
  });

  dom.licenseSelect.addEventListener("change", (event) => {
    state.license = event.target.value;
    saveState();
    renderTrackGrid();
  });

  dom.useCaseSelect.addEventListener("change", (event) => {
    state.useCase = event.target.value;
    saveState();
    renderTrackGrid();
  });

  dom.attributionToggle.addEventListener("change", (event) => {
    state.attributionOnly = event.target.checked;
    saveState();
    renderTrackGrid();
  });

  dom.projectName.addEventListener("input", (event) => {
    state.projectName = event.target.value;
    saveState();
    renderReport();
  });

  dom.projectUsage.addEventListener("change", (event) => {
    state.projectUsage = event.target.value;
    saveState();
    renderReport();
  });

  dom.trackGrid.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    if (action === "select") {
      toggleSelection(id);
      return;
    }

    if (action === "favorite") {
      toggleFavorite(id);
      return;
    }

    if (action === "queue") {
      toggleQueue(id);
      return;
    }

    if (action === "delete-track") {
      void deleteTrackById(id);
      return;
    }

    if (action === "preview") {
      await togglePreview(id);
    }
  });

  dom.trackGrid.addEventListener("contextmenu", (event) => {
    const cover = event.target.closest(".track-cover");
    if (!cover) {
      return;
    }

    const card = cover.closest(".track-card");
    const trackId = card?.querySelector("[data-action='preview']")?.dataset.id || "";
    if (!trackId) {
      return;
    }

    event.preventDefault();
    showTrackContextMenu(trackId, event.clientX, event.clientY);
  });

  dom.catalogPagination?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-page]");
    if (!button) {
      return;
    }

    state.catalogPage = Number(button.dataset.page) || 1;
    saveState();
    renderTrackGrid();
    document.querySelector("#catalogo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  dom.playlistGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='playlist']");
    if (!button) {
      return;
    }

    state.activePlaylistId = button.dataset.id || "real-songs";
    state.genre = playlistToFilter(state.activePlaylistId);
    dom.genreSelect.value = state.genre;
    if (dom.sourceSelect) {
      dom.sourceSelect.value = state.source;
    }
    saveState();
    renderTrackGrid();
    renderPlaylists();
    renderPlayer();
    document.querySelector("#catalogo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  dom.playlistTrackRow.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    if (action === "select") {
      toggleSelection(id);
      return;
    }

    if (action === "favorite") {
      toggleFavorite(id);
      return;
    }

    if (action === "queue") {
      toggleQueue(id);
      return;
    }

    if (action === "preview") {
      await togglePreview(id);
    }
  });

  dom.queueList?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    if (action === "queue") {
      toggleQueue(id);
      return;
    }

    if (action === "preview") {
      await togglePreview(id);
    }
  });

  dom.discoveryResults.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    if (action === "import-discovery") {
      const track = discoveryResults.find((entry) => entry.id === id);
      if (track?.canImport === false) {
        setStatus(
          dom.discoveryStatus,
          "Questo provider e' solo metadata/riferimento: non e' importabile come traccia commercial-safe.",
          "error"
        );
        return;
      }

      await importDiscoveryTrackById(id);
      return;
    }

    if (action === "preview-discovery") {
      const track = discoveryResults.find((entry) => entry.id === id);
      if (track?.canPreview === false) {
        return;
      }

      await togglePreview(id);
    }
  });

  dom.selectionList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='remove']");
    if (!button) {
      return;
    }

    toggleSelection(button.dataset.id);
  });

  dom.copyReportButton.addEventListener("click", copyReport);

  dom.clearSelectionButton.addEventListener("click", () => {
    state.selectedIds = [];
    saveState();
    renderAll();
  });

  dom.uploadForm.addEventListener("submit", handleUploadSubmit);
  dom.accountSelect?.addEventListener("change", (event) => {
    switchAccount(event.target.value);
  });
  dom.createAccountButton?.addEventListener("click", () => {
    void createAccount();
  });
  dom.removeAccountButton?.addEventListener("click", removeCurrentAccount);
  dom.accountsList?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    if (action === "switch-account") {
      switchAccount(id);
      return;
    }

    if (action === "remove-account") {
      removeAccountById(id);
    }
  });
  dom.themeToggleButton?.addEventListener("click", toggleTheme);
  dom.openAuthButton?.addEventListener("click", () => showAuthGate());
  dom.sidebarLogoutButton?.addEventListener("click", () => {
    void logoutUser();
  });
  dom.topbarLogoutButton?.addEventListener("click", () => {
    void logoutUser();
  });
  dom.loginButton?.addEventListener("click", () => {
    void loginUser();
  });
  dom.logoutButton?.addEventListener("click", () => {
    void logoutUser();
  });
  dom.loginPassword?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void loginUser();
    }
  });
  dom.changePasswordButton?.addEventListener("click", () => {
    void changeOwnPassword();
  });
  dom.contextQueueButton?.addEventListener("click", () => {
    if (contextMenuTrackId) {
      toggleQueue(contextMenuTrackId);
    }
    hideTrackContextMenu();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#trackContextMenu")) {
      hideTrackContextMenu();
    }
  });
  dom.clearQueueButton?.addEventListener("click", clearQueue);
  dom.playerPrevButton.addEventListener("click", () => {
    void playAdjacentTrack(-1);
  });
  dom.playerToggleButton.addEventListener("click", () => {
    void toggleGlobalPlayback();
  });
  dom.playerShuffleButton.addEventListener("click", toggleShuffle);
  dom.playerRepeatButton.addEventListener("click", cycleRepeatMode);
  dom.playerNextButton.addEventListener("click", () => {
    void playAdjacentTrack(1);
  });
  dom.embeddedCloseButton.addEventListener("click", () => {
    pausePlayback();
  });
  dom.playerVolumeRange.addEventListener("input", (event) => {
    updatePlayerVolume(event.target.value);
  });
  dom.playerSeekRange.addEventListener("input", (event) => {
    seekPlayer(event.target.value);
  });
  dom.embeddedPlayerFrame.addEventListener("load", applyEmbeddedVolume);
  dom.externalRiskConfirmButton.addEventListener("click", async () => {
    const trackId = pendingExternalTrackId;
    externalRiskAccepted = true;
    hideExternalRiskWarning();
    if (trackId) {
      await playTrackById(trackId);
    }
  });
  dom.externalRiskCancelButton.addEventListener("click", hideExternalRiskWarning);
  dom.sessionLoginButton.addEventListener("click", loginSessionUser);
  dom.sessionLogoutButton.addEventListener("click", logoutSessionUser);
  dom.sessionImportButton.addEventListener("click", () => {
    void importSessionPlaylistFromLink();
  });
  dom.sessionUserInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loginSessionUser();
    }
  });
  dom.discoverySearchButton.addEventListener("click", searchDiscovery);
  dom.bulkImportButton.addEventListener("click", bulkImportLibrary);
  dom.importLinkButton.addEventListener("click", importFromLink);
  dom.importLinkInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void importFromLink();
    }
  });
  dom.discoveryRightsMode.addEventListener("change", () => {
    populateDiscoveryProviderSelect();
  });
  dom.discoverySearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void searchDiscovery();
    }
  });
}

