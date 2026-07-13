import { createParagraph } from "../ui/ui-dom.js";

export function createAppUi({ state, elements }) {
  const controllers = {};

  function bind(nextControllers = {}) {
    Object.assign(controllers, nextControllers);
  }

  function setSyncStatus(message, status = "") {
    if (!elements.syncStatusEl) return;
    elements.syncStatusEl.textContent = message;
    elements.syncStatusEl.classList.remove("ok", "error");
    if (status) elements.syncStatusEl.classList.add(status);
  }

  function updateLogSummary() {
    if (!elements.logSummary) return;
    const count = state.room.gameState.logs.length;
    elements.logSummary.textContent = count > 0 ? `操作记录（${count}）` : "操作记录";
  }

  function appendLogMessage(message) {
    elements.gameLog?.appendChild(createParagraph(String(message)));
    if (elements.gameLog) elements.gameLog.scrollTop = elements.gameLog.scrollHeight;
  }

  function clearGameLog() {
    elements.gameLog?.replaceChildren();
    state.room.gameState.logs = [];
    updateLogSummary();
  }

  function renderGameLog(logs = []) {
    elements.gameLog?.replaceChildren();
    logs.forEach(appendLogMessage);
    updateLogSummary();
  }

  function updateGameLog(message) {
    const safeMessage = String(message);
    state.room.gameState.logs.push(safeMessage);
    appendLogMessage(safeMessage);
    updateLogSummary();
  }

  function showGameTable() {
    if (elements.setupContainer) elements.setupContainer.style.display = "none";
    if (elements.gameContainer) elements.gameContainer.style.display = "grid";
  }

  function showSetup() {
    if (elements.setupContainer) elements.setupContainer.style.display = "block";
    if (elements.gameContainer) elements.gameContainer.style.display = "none";
  }

  const call = (controller, method, ...args) => controllers[controller]?.[method]?.(...args);

  function refreshInteractiveControls() {
    call("identityToolbar", "renderIdentityControls");
    call("tableScreen", "updatePlayerBoxes");
    call("identityToolbar", "renderTableViewToolbar");
    call("tableScreen", "renderDealPromptPanel");
    call("tableScreen", "renderSettlementPreviewPanel");
    call("tableManager", "renderIfOpen");

    if (state.handStatus === "waitingDeal" || state.handStatus === "settlementPreview") {
      call("tableScreen", "hideShowdownPanel");
      call("tableScreen", "clearHandActions");
    } else if (state.awaitingShowdown) {
      call("tableScreen", "renderShowdownPanel");
    } else if (state.gameOver) {
      call("tableScreen", "renderNextHandButton");
    } else if (state.handStatus === "playing") {
      call("tableScreen", "renderCurrentActionPanel");
    } else {
      call("tableScreen", "clearHandActions");
    }
  }

  function setMutationInProgress(inProgress) {
    state.mutationInProgress = Boolean(inProgress);
    refreshInteractiveControls();
  }

  return {
    bind,
    setSyncStatus,
    clearGameLog,
    renderGameLog,
    updateGameLog,
    showGameTable,
    showSetup,
    refreshInteractiveControls,
    setMutationInProgress,
    getAliasInputValue: () => elements.playerAliasInput?.value || "",
    setAliasInputValue: value => {
      if (elements.playerAliasInput) elements.playerAliasInput.value = value;
    },
    renderIdentityControls: (...args) => call("identityToolbar", "renderIdentityControls", ...args),
    renderTableViewToolbar: (...args) => call("identityToolbar", "renderTableViewToolbar", ...args),
    loadTableViewRotation: (...args) => call("identityToolbar", "loadTableViewRotation", ...args),
    updatePlayerBoxes: (...args) => call("tableScreen", "updatePlayerBoxes", ...args),
    updateGameInfo: (...args) => call("tableScreen", "updateGameInfo", ...args),
    renderCurrentActionPanel: (...args) => call("tableScreen", "renderCurrentActionPanel", ...args),
    renderNextHandButton: (...args) => call("tableScreen", "renderNextHandButton", ...args),
    clearHandActions: (...args) => call("tableScreen", "clearHandActions", ...args),
    showNextHandButton: (...args) => call("tableScreen", "showNextHandButton", ...args),
    hideShowdownPanel: (...args) => call("tableScreen", "hideShowdownPanel", ...args),
    renderShowdownPanel: (...args) => call("tableScreen", "renderShowdownPanel", ...args),
    hideDealPromptPanel: (...args) => call("tableScreen", "hideDealPromptPanel", ...args),
    renderDealPromptPanel: (...args) => call("tableScreen", "renderDealPromptPanel", ...args),
    hideSettlementPreviewPanel: (...args) => call("tableScreen", "hideSettlementPreviewPanel", ...args),
    renderSettlementPreviewPanel: (...args) => call("tableScreen", "renderSettlementPreviewPanel", ...args),
    renderTableManagerIfOpen: (...args) => call("tableManager", "renderIfOpen", ...args),
    openTableManager: (...args) => call("tableManager", "open", ...args),
    closeTableManager: (...args) => call("tableManager", "close", ...args),
    syncTableManagerIdentity: (...args) => call("tableManager", "syncIdentityFromPlayers", ...args),
    renderSetupPlayers: (...args) => call("setupLobby", "renderPlayers", ...args),
    updateSetupActionState: (...args) => call("setupLobby", "updateActionState", ...args)
  };
}
