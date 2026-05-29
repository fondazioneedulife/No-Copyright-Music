document.addEventListener('DOMContentLoaded', () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const adminPasswordInput = document.getElementById('adminPassword');
  const syncBtn = document.getElementById('syncBtn');
  const statusDiv = document.getElementById('status');

  // Carica i dati salvati
  chrome.storage.local.get(['serverUrl', 'adminPassword'], (result) => {
    if (result.serverUrl) serverUrlInput.value = result.serverUrl;
    if (result.adminPassword) adminPasswordInput.value = result.adminPassword;
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status-${type}`;
  }

  syncBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
    const adminPassword = adminPasswordInput.value;

    if (!serverUrl || !adminPassword) {
      showStatus('Inserisci indirizzo e password.', 'error');
      return;
    }

    // Salva le impostazioni
    chrome.storage.local.set({ serverUrl, adminPassword });

    syncBtn.disabled = true;
    showStatus('Sincronizzazione in corso...', 'info');

    // Manda il messaggio al background script per fare il lavoro sporco
    chrome.runtime.sendMessage(
      { action: 'syncCookies', serverUrl, adminPassword },
      (response) => {
        syncBtn.disabled = false;
        if (chrome.runtime.lastError) {
          showStatus('Errore di comunicazione interna.', 'error');
          return;
        }

        if (response.success) {
          showStatus(response.message || 'Cookie sincronizzati con successo!', 'success');
        } else {
          showStatus(response.message || 'Errore durante la sincronizzazione.', 'error');
        }
      }
    );
  });
});
