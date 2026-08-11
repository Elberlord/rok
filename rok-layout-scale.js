/* R.O.K Lite v496 · Escala lógica universal y modal principal de carta estable. */
(() => {
  'use strict';
  const DESIGN_WIDTH = 1600;
  const DESIGN_HEIGHT = 900;
  const stage = document.getElementById('rokAppStage');
  if (!stage) return;

  let scale = 1;
  let resizeRaf = 0;
  let fitRaf = 0;

  function computeScale() {
    const w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || DESIGN_WIDTH);
    const h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || DESIGN_HEIGHT);
    return Math.max(0.20, Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT));
  }

  function applyScale() {
    resizeRaf = 0;
    scale = computeScale();
    stage.style.setProperty('--rok-app-scale', String(scale));
    document.documentElement.style.setProperty('--rok-app-scale', String(scale));
    document.body.style.setProperty('--rok-app-scale', String(scale));
    stage.dataset.rokScale = scale.toFixed(6);
    requestModalFit();
  }

  function requestScale() {
    if (!resizeRaf) resizeRaf = requestAnimationFrame(applyScale);
  }

  function getStageRect() {
    return stage.getBoundingClientRect();
  }

  function rectToLogical(rect) {
    const sr = getStageRect();
    const sx = sr.width ? sr.width / DESIGN_WIDTH : scale;
    const sy = sr.height ? sr.height / DESIGN_HEIGHT : scale;
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
    const sx = sr.width ? sr.width / DESIGN_WIDTH : scale;
    const sy = sr.height ? sr.height / DESIGN_HEIGHT : scale;
    return { x: (x - sr.left) / (sx || 1), y: (y - sr.top) / (sy || 1) };
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

    // v495 · El modal principal de carta es un padre lógico estable.
    // Nunca se escala por el contenido de una carta concreta (hechizo,
    // invocación, Kaster, guardián, textos largos, etc.). Solo la escala
    // universal del escenario puede cambiar su tamaño visual. Sus hijos
    // administran el excedente dentro de sus propias áreas.
    if (overlay.id === 'cardInfoOverlay') return;
    const cs = getComputedStyle(overlay);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const availW = Math.max(1, overlay.clientWidth - padX - 24);
    const availH = Math.max(1, overlay.clientHeight - padY - 24);
    const baseW = Math.max(1, card.offsetWidth || 1);
    const baseH = Math.max(1, card.offsetHeight || 1);
    // Un desborde horizontal pequeño suele significar que una fila/botón está
    // intentando cruzar el margen del padre: lo contamos para reducir TODO el grupo.
    const w = Math.max(baseW, Number(card.scrollWidth || 0));
    // Un texto/listado muy largo debe usar su scroll interno; un desborde vertical
    // moderado sí participa del ajuste proporcional del conjunto.
    const scrollH = Math.max(baseH, Number(card.scrollHeight || 0));
    const h = scrollH <= baseH * 1.25 ? scrollH : baseH;
    // El hijo nunca puede forzar al padre. Si no cabe en la zona segura,
    // se reduce el conjunto completo conservando exactamente sus proporciones.
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
  if (window.ResizeObserver) new ResizeObserver(requestModalFit).observe(stage);

  window.addEventListener('resize', requestScale, { passive: true });
  window.addEventListener('orientationchange', requestScale, { passive: true });

  window.ROK_LAYOUT_SCALE = Object.freeze({
    designWidth: DESIGN_WIDTH,
    designHeight: DESIGN_HEIGHT,
    getScale: () => scale,
    getStageRect,
    rectToLogical,
    clientToLogical,
    fitVisibleModals,
    refresh: requestScale,
  });

  applyScale();
})();
