/* R.O.K Lite v8.60 / RT-08.8 · Escala lógica adaptable al viewport. */
(() => {
  'use strict';

  const BASE_WIDTH = 1600;
  const BASE_HEIGHT = 900;
  const stage = document.getElementById('rokAppStage');
  if (!stage) return;

  let scale = 1;
  let logicalWidth = BASE_WIDTH;
  let logicalHeight = BASE_HEIGHT;
  let resizeRaf = 0;
  let fitRaf = 0;

  function viewportSize() {
    const vv = window.visualViewport;
    return {
      width: Math.max(1, Number(vv?.width || window.innerWidth || document.documentElement.clientWidth || BASE_WIDTH)),
      height: Math.max(1, Number(vv?.height || window.innerHeight || document.documentElement.clientHeight || BASE_HEIGHT)),
    };
  }

  function shouldExpandBattleStage() {
    return document.body.classList.contains('rok-battle-mode');
  }

  function computeLayout() {
    const viewport = viewportSize();

    // La escala siempre es uniforme: no se estira el arte ni se deforman las
    // casillas. En combate, la dimensión lógica sobrante se expande para llenar
    // la relación de aspecto física completa en lugar de dejar bandas vacías.
    const fitScale = Math.max(
      0.05,
      Math.min(viewport.width / BASE_WIDTH, viewport.height / BASE_HEIGHT),
    );

    if (!shouldExpandBattleStage()) {
      return {
        scale: fitScale,
        logicalWidth: BASE_WIDTH,
        logicalHeight: BASE_HEIGHT,
      };
    }

    return {
      scale: fitScale,
      logicalWidth: Math.max(BASE_WIDTH, viewport.width / fitScale),
      logicalHeight: Math.max(BASE_HEIGHT, viewport.height / fitScale),
    };
  }

  function applyScale() {
    resizeRaf = 0;
    const next = computeLayout();
    scale = next.scale;
    logicalWidth = next.logicalWidth;
    logicalHeight = next.logicalHeight;

    stage.style.width = `${logicalWidth}px`;
    stage.style.height = `${logicalHeight}px`;
    stage.style.setProperty('--rok-app-scale', String(scale));
    stage.style.setProperty('--rok-stage-logical-width', `${logicalWidth}px`);
    stage.style.setProperty('--rok-stage-logical-height', `${logicalHeight}px`);

    document.documentElement.style.setProperty('--rok-app-scale', String(scale));
    document.body.style.setProperty('--rok-app-scale', String(scale));
    document.documentElement.style.setProperty('--rok-stage-logical-width', `${logicalWidth}px`);
    document.documentElement.style.setProperty('--rok-stage-logical-height', `${logicalHeight}px`);

    stage.dataset.rokScale = scale.toFixed(6);
    stage.dataset.rokLogicalWidth = logicalWidth.toFixed(2);
    stage.dataset.rokLogicalHeight = logicalHeight.toFixed(2);

    requestModalFit();
    try { window.dispatchEvent(new CustomEvent('rok-layout-resized', { detail: {
      scale, logicalWidth, logicalHeight,
    }})); } catch (_) {}
  }

  function requestScale() {
    if (!resizeRaf) resizeRaf = requestAnimationFrame(applyScale);
  }

  function getStageRect() {
    return stage.getBoundingClientRect();
  }

  function rectToLogical(rect) {
    const sr = getStageRect();
    const sx = sr.width ? sr.width / logicalWidth : scale;
    const sy = sr.height ? sr.height / logicalHeight : scale;
    return {
      left: (rect.left - sr.left) / (sx || 1),
      top: (rect.top - sr.top) / (sy || 1),
      width: rect.width / (sx || 1),
      height: rect.height / (sy || 1),
      right: (rect.right - sr.left) / (sx || 1),
      bottom: (rect.bottom - sr.top) / (sy || 1),
    };
  }

  function clientToLogical(x, y) {
    const sr = getStageRect();
    const sx = sr.width ? sr.width / logicalWidth : scale;
    const sy = sr.height ? sr.height / logicalHeight : scale;
    return {
      x: (x - sr.left) / (sx || 1),
      y: (y - sr.top) / (sy || 1),
    };
  }

  const modalPairs = [
    ['#accountAuthOverlay', '.account-auth-card'],
    ['#botMatchModeModal', '.bot-match-mode-card'],
    ['#matchSpellbookSelectModal', '.match-spellbook-select-card'],
    ['#profileCenterOverlay', '.profile-center-card'],
    ['#friendsOverlay', '.friends-card'],
    ['#onlineLobbyOverlay', '.online-lobby-card'],
    ['#casterChangeModal', '.spellbook-name-card'],
    ['#spellbookNameModal', '.spellbook-name-card'],
    ['#spellbookElementsModal', '.spellbook-name-card'],
    ['#spellbookElementWarningModal', '.spellbook-name-card'],
    ['#cardInfoOverlay', '.card-info-box'],
    ['#gioshoninSupplyOverlay', '.random-cost-box'],
    ['#randomCostOverlay', '.random-cost-box'],
    ['#cardMetaInfoOverlay', '.meta-info-box'],
    ['#powerImagePreviewOverlay', '.power-image-preview-box'],
    ['#quickReactionModal', '.quick-reaction-modal-shell'],
    ['#opponentActionNotice', '.opponent-action-notice-shell'],
    ['#gameMenuOverlay', '.game-menu-card'],
    ['#patchInfoOverlay', '.patch-info-card'],
    ['#kurokagiDropChoiceModal', '.kurokagi-drop-choice-card'],
    ['#hattoriAbilityOverlay', '.hattori-ability-shell'],
    ['#tokugawaAbilityOverlay', '.tokugawa-ability-shell'],
    ['#kurokagiWeaponModal', '.kurokagi-weapon-modal-card'],
    ['#yasuganaPowerModal', '.yasugana-power-modal-card'],
    ['#kouutenRecastOverlay', '.kouuten-recast-modal'],
    ['#tacticaGuerraSelectionOverlay', '.tactica-guerra-selection-shell'],
    ['#emboscadaSelectionOverlay', '.tactica-guerra-selection-shell'],
    ['#interceptarSelectionOverlay', '.tactica-guerra-selection-shell'],
    ['#matchResultOverlay', '.match-result-card'],
  ];

  function visible(node) {
    if (!node?.isConnected) return false;
    const cs = getComputedStyle(node);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) !== 0;
  }

  function fitPair(overlay, card) {
    if (!visible(overlay) || !card) return;
    card.style.setProperty('--rok-modal-fit-scale', '1');
    if (overlay.id === 'cardInfoOverlay') return;

    const cs = getComputedStyle(overlay);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const availW = Math.max(1, overlay.clientWidth - padX - 24);
    const availH = Math.max(1, overlay.clientHeight - padY - 24);
    const baseW = Math.max(1, card.offsetWidth || 1);
    const baseH = Math.max(1, card.offsetHeight || 1);
    const w = Math.max(baseW, Number(card.scrollWidth || 0));
    const scrollH = Math.max(baseH, Number(card.scrollHeight || 0));
    const h = scrollH <= baseH * 1.25 ? scrollH : baseH;
    const fit = Math.max(0.20, Math.min(1, availW / w, availH / h));
    card.style.setProperty('--rok-modal-fit-scale', fit.toFixed(4));
  }

  function fitVisibleModals() {
    for (const [outerSel, innerSel] of modalPairs) {
      const overlay = document.querySelector(outerSel);
      const card = overlay?.querySelector(innerSel);
      if (overlay && card) fitPair(overlay, card);
    }
  }

  function requestModalFit() {
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(() => {
      fitRaf = 0;
      fitVisibleModals();
    });
  }

  new MutationObserver(requestModalFit).observe(stage, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
  });

  // Entrar/salir de combate cambia si el lienzo debe expandirse.
  new MutationObserver(mutations => {
    if (mutations.some(m => m.attributeName === 'class')) requestScale();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  if (window.ResizeObserver) new ResizeObserver(requestModalFit).observe(stage);

  window.addEventListener('resize', requestScale, { passive: true });
  window.addEventListener('orientationchange', requestScale, { passive: true });
  window.visualViewport?.addEventListener?.('resize', requestScale, { passive: true });

  const api = {
    get designWidth() { return logicalWidth; },
    get designHeight() { return logicalHeight; },
    baseWidth: BASE_WIDTH,
    baseHeight: BASE_HEIGHT,
    getScale: () => scale,
    getLogicalSize: () => ({ width: logicalWidth, height: logicalHeight }),
    getStageRect,
    rectToLogical,
    clientToLogical,
    fitVisibleModals,
    refresh: requestScale,
  };

  window.ROK_LAYOUT_SCALE = Object.freeze(api);
  applyScale();
})();
