/* =========================================================
   R.O.K Lite · PvP privado con Firebase Realtime Database
   - Jugador 1 crea la sala.
   - Jugador 2 entra con el código.
   - El estado de batalla se sincroniza por revisiones.
   - Cada navegador solo ejecuta las fases de su propio jugador.
   ========================================================= */
(function () {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCapopKSADRBnhk7wZVWKcnFG__zl3TYnw',
    authDomain: 'rok-rise-of-caster.firebaseapp.com',
    databaseURL: 'https://rok-rise-of-caster-default-rtdb.firebaseio.com',
    projectId: 'rok-rise-of-caster',
    storageBucket: 'rok-rise-of-caster.firebasestorage.app',
    messagingSenderId: '147189629810',
    appId: '1:147189629810:web:3bebec7a294902545d93eb',
  };

  const FIREBASE_VERSION = '12.16.0';
  const ROOM_ROOT = 'rooms';
  const ROOM_SCHEMA_VERSION = 2;
  const ROOM_CODE_LENGTH = 6;
  const SYNC_INTERVAL_MS = 220;
  const LOCAL_ACTION_GRACE_MS = 5000;
  const REMOTE_DEFENSE_TIMEOUT_MS = 45000;
  const SESSION_STORAGE_KEY = 'rok_online_room_session_v2';
  const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const SNAPSHOT_KEYS = [
    'activePlayer',
    'phaseIndex',
    'turnSerial',
    'gameOver',
    'matchWins',
    'phaseUndo',
    'resolutionUndoReturn',
    'resolutionActionTaken',
    'turnActionByPlayer',
    'resolutionSerial',
    'arenaEntrySerial',
    'smokeZones',
    'pendingGuardianStrikes',
    'kaguyaChargedShots',
    'pendingTimedAbilityResolutions',
    'extractedThisPhase',
    'players',
  ];

  const ui = {};
  let firebaseApiPromise = null;
  let auth = null;
  let db = null;
  let uid = '';
  let roomCode = '';
  let roomPath = '';
  let playerSlot = 0;
  let roomUnsubscribe = null;
  let presenceDisconnect = null;
  let syncTimer = null;
  let publishTimer = null;
  let roomCache = null;
  let lastKnownRevision = 0;
  let lastSnapshotText = '';
  let lastObservedPhaseKey = '';
  let localIntentUntil = 0;
  let applyingRemoteSnapshot = false;
  let publishingSnapshot = false;
  let startingOnlineBattle = false;
  let handledInteractionId = '';
  let leavingRoom = false;
  let localStateReady = false;

  function cacheUi() {
    ui.overlay = document.getElementById('onlineLobbyOverlay');
    ui.closeBtn = document.getElementById('onlineLobbyCloseBtn');
    ui.createBtn = document.getElementById('onlineCreateRoomBtn');
    ui.joinBtn = document.getElementById('onlineJoinRoomBtn');
    ui.codeInput = document.getElementById('onlineRoomCodeInput');
    ui.codeBox = document.getElementById('onlineRoomCodeBox');
    ui.codeValue = document.getElementById('onlineRoomCodeValue');
    ui.copyBtn = document.getElementById('onlineCopyCodeBtn');
    ui.status = document.getElementById('onlineLobbyStatus');
    ui.startBtn = document.getElementById('onlineStartMatchBtn');
    ui.badge = document.getElementById('onlineMatchBadge');
    ui.badgeText = document.getElementById('onlineMatchBadgeText');
    ui.leaveBtn = document.getElementById('onlineLeaveRoomBtn');
  }

  function setStatus(message, kind = '') {
    if (!ui.status) return;
    ui.status.textContent = String(message || '');
    ui.status.classList.remove('ok', 'error', 'working');
    if (kind) ui.status.classList.add(kind);
  }

  function setLobbyBusy(busy) {
    const disabled = Boolean(busy);
    if (ui.createBtn) ui.createBtn.disabled = disabled;
    if (ui.joinBtn) ui.joinBtn.disabled = disabled;
    if (ui.codeInput) ui.codeInput.disabled = disabled;
  }

  function normalizeRoomCode(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, ROOM_CODE_LENGTH);
  }

  function makeRoomCode() {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
      code += ROOM_CODE_ALPHABET[index];
    }
    return code;
  }

  function roomRefPath(code = roomCode) {
    return `${ROOM_ROOT}/${normalizeRoomCode(code)}`;
  }

  function deepClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function phaseKeyFromSnapshot(snapshot) {
    if (!snapshot) return '';
    return `${Number(snapshot.turnSerial || 0)}:${Number(snapshot.activePlayer || 0)}:${Number(snapshot.phaseIndex || 0)}`;
  }

  function currentLocalPhaseKey() {
    return `${Number(state.turnSerial || 0)}:${Number(state.activePlayer || 0)}:${Number(state.phaseIndex || 0)}`;
  }

  function makeBattleSnapshot() {
    const snapshot = {};
    SNAPSHOT_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(state, key)) snapshot[key] = deepClone(state[key]);
    });
    snapshot.aiEnabled = false;
    return snapshot;
  }

  function snapshotText(snapshot) {
    try { return JSON.stringify(snapshot); }
    catch (error) {
      reportOnlineError(error, 'No se pudo serializar la partida');
      return '';
    }
  }

  function resetTransientStateAfterRemoteApply() {
    state.activeTab = Number.isFinite(Number(state.activeTab)) ? Number(state.activeTab) : 0;
    state.selectedCardSlot = null;
    state.pendingCard = null;
    state.pendingPlacement = null;
    state.randomCostPayment = null;
    state.infoCard = null;
    state.cardMetaInfoHistory = [];
    state.cardMetaInfoCurrent = null;
    state.selectedMover = null;
    state.selectedTarget = null;
    state.pendingCasterDefense = null;
    state.pendingPowerAction = null;
    state.tokugawaAbilitySelectionActive = false;
    state.pendingTokugawaReposition = null;
    state.hattoriAbilitySelectionActive = false;
    state.hattoriAbilitySelectionResolver = null;
    state.hattoriReactionPromptActive = false;
    state.extractionAnimating = false;
    state.opponentActionResolving = false;
    state.opponentActionLockReason = '';
    state.actionExecutionLock = false;
    state.actionExecutionLockReason = '';
    state.opponentActionNoticeAwaiting = false;
    state.opponentActionNoticeResolve = null;
    state.opponentActionNoticeWaiters = [];
    state.opponentActionLockDepth = 0;
    state.opponentActionPreviousAiThinking = false;
    state.pendingCastTravelCount = 0;
    state.pendingCastTravelPromises = [];
    state.castTravelResolving = false;
    state.aiThinking = false;
    state.enemyResolutionRunning = false;
    state.aiEnabled = false;
    state.quickReactionWindow = {
      active: false,
      locked: false,
      candidates: [],
      resolver: null,
      phaseKey: '',
      playerId: LOCAL_PLAYER_ID,
      phaseFlowId: Number(state.quickReactionWindow?.phaseFlowId || 0) + 1,
    };
    state.offTurnCasterReposition = {
      active: false,
      playerId: null,
      phaseKey: '',
      moving: false,
      resolver: null,
    };
    state.semiAutoMovementAnimating = false;
  }

  function applyBattleSnapshot(snapshot, revision, writerUid) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const oldPhaseKey = currentLocalPhaseKey();
    const localHudMode = state.hudMode;
    const localSemiAutoMovement = state.semiAutoMovement;
    const localActiveTab = state.activeTab;

    applyingRemoteSnapshot = true;
    try {
      SNAPSHOT_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) state[key] = deepClone(snapshot[key]);
      });
      state.hudMode = localHudMode;
      state.semiAutoMovement = localSemiAutoMovement;
      state.activeTab = localActiveTab;
      resetTransientStateAfterRemoteApply();
      ROK_ONLINE_MATCH_ACTIVE = true;
      LOCAL_PLAYER_ID = playerSlot;
      mainMenuBattleStarted = true;
      lastKnownRevision = Math.max(lastKnownRevision, Number(revision || 0));
      lastSnapshotText = snapshotText(makeBattleSnapshot());
      localStateReady = true;
      showBattleScreen();
      renderAll();
    } finally {
      applyingRemoteSnapshot = false;
    }

    const newPhaseKey = currentLocalPhaseKey();
    if (newPhaseKey !== oldPhaseKey && newPhaseKey !== lastObservedPhaseKey) {
      lastObservedPhaseKey = newPhaseKey;
      deliverRemotePhaseIfLocal();
    } else if (!lastObservedPhaseKey) {
      lastObservedPhaseKey = newPhaseKey;
    }

    if (writerUid && writerUid !== uid) {
      try { window.ROK_DEBUG_RIBBON?.ok?.(`PvP sincronizado · revisión ${lastKnownRevision}`); } catch (_) {}
    }
    return true;
  }

  function deliverRemotePhaseIfLocal() {
    if (!ROK_ONLINE_MATCH_ACTIVE || Number(state.activePlayer) !== Number(LOCAL_PLAYER_ID) || state.gameOver) return;
    clearTimeout(schedulePhaseStartActions.timer);
    const phase = currentPhase();
    const items = [];
    if (phase?.id === 'extraction') {
      items.push({ text: `JUGADOR ${LOCAL_PLAYER_ID}`, playerId: LOCAL_PLAYER_ID, duration: 760 });
    }
    items.push({ text: String(phase?.label || 'FASE').toUpperCase(), playerId: LOCAL_PLAYER_ID, duration: 860 });
    queueTransitions(items);
    schedulePhaseStartActions(Math.max(0, sumTransitionDurations(items) - 120));
  }

  function setStartButtonVisible(visible, busy = false) {
    if (!ui.startBtn) return;
    ui.startBtn.classList.toggle('visible', Boolean(visible));
    ui.startBtn.setAttribute('aria-hidden', visible ? 'false' : 'true');
    ui.startBtn.disabled = Boolean(busy);
  }

  function showBattleScreen() {
    document.body.classList.remove('rok-menu-mode', 'rok-library-mode');
    document.body.classList.add('rok-battle-mode');
    if (els.mainMenuScreen) els.mainMenuScreen.setAttribute('aria-hidden', 'true');
    if (els.libraryBuilderScreen) els.libraryBuilderScreen.setAttribute('aria-hidden', 'true');
    if (ui.overlay) { ui.overlay.setAttribute('aria-hidden', 'true'); ui.overlay.classList.remove('visible'); }
    setStartButtonVisible(false);
    if (ui.badge) { ui.badge.setAttribute('aria-hidden', 'false'); ui.badge.classList.add('visible'); ui.badge.title = `Sala ${roomCode}`; }
    if (ui.badgeText) ui.badgeText.textContent = `PVP conectado · J${playerSlot} · rev ${lastKnownRevision}`;
    try { updateHudModeUi(); } catch (_) {}
  }

  function showWaitingRoom(code) {
    if (ui.codeBox) { ui.codeBox.setAttribute('aria-hidden', 'false'); ui.codeBox.classList.add('visible'); }
    if (ui.codeValue) ui.codeValue.textContent = code;
    if (ui.badge) { ui.badge.setAttribute('aria-hidden', 'true'); ui.badge.classList.remove('visible'); }
  }

  function openLobby() {
    cacheUi();
    if (!ui.overlay) return;
    ui.overlay.setAttribute('aria-hidden', 'false');
    ui.overlay.classList.add('visible');
    if (roomCode) showWaitingRoom(roomCode);
    if (!roomCode) setStatus('Crea una sala o escribe el código recibido.', '');
    setTimeout(() => ui.codeInput?.focus(), 40);
  }

  function closeLobby() {
    if (ui.overlay) { ui.overlay.setAttribute('aria-hidden', 'true'); ui.overlay.classList.remove('visible'); }
  }

  async function loadFirebase() {
    if (firebaseApiPromise) return firebaseApiPromise;
    firebaseApiPromise = (async () => {
      const [appModule, authModule, dbModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`),
      ]);
      const app = appModule.initializeApp(FIREBASE_CONFIG);
      auth = authModule.getAuth(app);
      try { await authModule.setPersistence(auth, authModule.browserLocalPersistence); } catch (_) {}
      if (!auth.currentUser) await authModule.signInAnonymously(auth);
      uid = auth.currentUser?.uid || '';
      if (!uid) throw new Error('Firebase Authentication no entregó un usuario anónimo.');
      db = dbModule.getDatabase(app);
      return { ...dbModule, authModule };
    })();
    try {
      return await firebaseApiPromise;
    } catch (error) {
      firebaseApiPromise = null;
      throw error;
    }
  }

  function saveSession() {
    if (!roomCode || !playerSlot) return;
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ roomCode, playerSlot, uid }));
    } catch (_) {}
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (_) {}
  }

  async function createRoom() {
    setLobbyBusy(true);
    setStatus('Conectando con Firebase…', 'working');
    try {
      const api = await loadFirebase();
      let createdCode = '';
      for (let attempt = 0; attempt < 12 && !createdCode; attempt += 1) {
        const candidate = makeRoomCode();
        const candidatePath = roomRefPath(candidate);
        const candidateRef = api.ref(db, candidatePath);
        const now = Date.now();

        // La sala se crea completa en una sola escritura. No se hace get()
        // previo sobre una sala inexistente y no se reserva /hostUid por
        // separado. Las reglas PvP que ya funcionaban validan la creación
        // usando el objeto completo y el hostUid del usuario autenticado.
        const initialRoom = {
          schemaVersion: ROOM_SCHEMA_VERSION,
          code: candidate,
          hostUid: uid,
          status: 'waiting',
          createdAt: now,
          updatedAt: now,
          players: {
            1: { uid, connected: true, joinedAt: now, lastSeenAt: now },
            2: { connected: false },
          },
        };

        try {
          await api.set(candidateRef, initialRoom);
          createdCode = candidate;
        } catch (error) {
          // Un código ya ocupado puede ser rechazado por las reglas porque el
          // usuario actual no es su host. Probamos otro código sin leer antes
          // la sala, ya que esa lectura era precisamente el error de v225.
          if (String(error?.code || '').toLowerCase().includes('permission-denied') && attempt < 11) {
            continue;
          }
          throw error;
        }
      }
      if (!createdCode) throw new Error('No se pudo reservar un código de sala.');
      await attachToRoom(createdCode, 1);
      showWaitingRoom(createdCode);
      setStatus(`Sala ${createdCode} creada. Comparte el código y espera al Jugador 2.`, 'ok');
    } catch (error) {
      reportOnlineError(error, 'No se pudo crear la sala');
      setStatus(readableFirebaseError(error), 'error');
    } finally {
      setLobbyBusy(false);
    }
  }

  async function joinRoom() {
    const code = normalizeRoomCode(ui.codeInput?.value);
    if (code.length !== ROOM_CODE_LENGTH) {
      setStatus('Escribe un código válido de 6 caracteres.', 'error');
      return;
    }
    setLobbyBusy(true);
    setStatus(`Buscando la sala ${code}…`, 'working');
    try {
      const api = await loadFirebase();
      const targetPath = roomRefPath(code);
      const targetRef = api.ref(db, targetPath);
      const roomSnapshot = await api.get(targetRef);
      const room = roomSnapshot.val();
      if (!room || Number(room.schemaVersion || 0) !== ROOM_SCHEMA_VERSION) {
        throw new Error('La sala no existe o usa una versión incompatible.');
      }

      const now = Date.now();
      const p1Uid = room.hostUid || room.players?.[1]?.uid || room.players?.['1']?.uid || '';
      const savedGuestUid = room.guestUid || room.players?.[2]?.uid || room.players?.['2']?.uid || '';
      let claimedSlot = 0;
      if (p1Uid === uid) {
        claimedSlot = 1;
        await api.update(api.ref(db, `${targetPath}/players/1`), { uid, connected: true, lastSeenAt: now });
      } else {
        const guestRef = api.ref(db, `${targetPath}/guestUid`);
        const guestClaim = await api.runTransaction(guestRef, current => {
          const currentUid = current || savedGuestUid || '';
          if (currentUid && currentUid !== uid) return;
          return uid;
        }, { applyLocally: false });
        if (!guestClaim.committed) throw new Error('La sala ya tiene un Jugador 2.');
        claimedSlot = 2;
        await api.update(api.ref(db, `${targetPath}/players/2`), {
          uid,
          connected: true,
          joinedAt: room.players?.[2]?.joinedAt || room.players?.['2']?.joinedAt || now,
          lastSeenAt: now,
        });
      }

      await api.update(targetRef, {
        guestUid: claimedSlot === 2 ? uid : (room.guestUid || null),
        status: room.game?.snapshot ? 'active' : 'ready',
        updatedAt: now,
      });
      await attachToRoom(code, claimedSlot);
      showWaitingRoom(code);
      setStatus(claimedSlot === 2 ? 'Entraste como Jugador 2. Preparando la partida…' : 'Sala recuperada como Jugador 1.', 'ok');
    } catch (error) {
      reportOnlineError(error, 'No se pudo entrar a la sala');
      setStatus(readableFirebaseError(error), 'error');
    } finally {
      setLobbyBusy(false);
    }
  }

  async function attachToRoom(code, slot) {
    const api = await loadFirebase();
    await detachRoomListener();
    roomCode = normalizeRoomCode(code);
    roomPath = roomRefPath(roomCode);
    playerSlot = Number(slot);
    LOCAL_PLAYER_ID = playerSlot;
    ROK_ONLINE_MATCH_ACTIVE = true;
    state.aiEnabled = false;
    lastKnownRevision = 0;
    lastSnapshotText = '';
    lastObservedPhaseKey = '';
    localStateReady = false;
    handledInteractionId = '';
    saveSession();

    const presenceRef = api.ref(db, `${roomPath}/players/${playerSlot}`);
    try {
      presenceDisconnect = api.onDisconnect(presenceRef);
      await presenceDisconnect.update({ connected: false, lastSeenAt: Date.now() });
      await api.update(presenceRef, { uid, connected: true, lastSeenAt: Date.now() });
    } catch (_) {}

    roomUnsubscribe = api.onValue(api.ref(db, roomPath), snapshot => {
      void handleRoomValue(snapshot.val());
    }, error => {
      reportOnlineError(error, 'Se perdió la lectura de la sala');
      setStatus(readableFirebaseError(error), 'error');
    });
    startSyncLoop();
  }

  async function handleRoomValue(room) {
    if (!room || leavingRoom) {
      if (roomCode && !leavingRoom) {
        setStatus('La sala fue cerrada o eliminada.', 'error');
        await leaveRoom({ silent: true, keepMenu: false });
      }
      return;
    }
    roomCache = room;
    const p1 = room.players?.[1] || room.players?.['1'];
    const p2 = room.players?.[2] || room.players?.['2'] || (room.guestUid ? { uid: room.guestUid, connected: true } : null);
    if (ui.badgeText) ui.badgeText.textContent = `PVP conectado · J${playerSlot} · rev ${lastKnownRevision}`;

    if (!room.game?.snapshot) {
      showWaitingRoom(roomCode);
      if (playerSlot === 1) {
        const guestReady = Boolean(p2?.uid);
        setStartButtonVisible(guestReady, startingOnlineBattle);
        setStatus(guestReady
          ? 'Jugador 2 conectado. Pulsa Iniciar duelo.'
          : `Sala ${roomCode} lista. Esperando al Jugador 2.`, guestReady ? 'ok' : 'ok');
      } else {
        setStartButtonVisible(false);
        setStatus('Conectado como Jugador 2. Esperando que el anfitrión inicie el duelo…', 'working');
      }
      return;
    }

    const game = room.game;
    const revision = Number(game.revision || 0);
    const writerUid = String(game.writerUid || '');
    if (!localStateReady || (writerUid !== uid && revision > lastKnownRevision)) {
      applyBattleSnapshot(game.snapshot, revision, writerUid);
    } else {
      lastKnownRevision = Math.max(lastKnownRevision, revision);
    }

    closeLobby();
    showBattleScreen();
    setStatus(`Partida activa · sala ${roomCode} · Jugador ${playerSlot}.`, 'ok');

    if (room.interaction) await handleIncomingInteraction(room.interaction);
  }

  async function startFreshOnlineBattleAsHost() {
    if (startingOnlineBattle || playerSlot !== 1) return;
    const guest = roomCache?.guestUid || roomCache?.players?.[2]?.uid || roomCache?.players?.['2']?.uid;
    if (!guest) { setStatus('Todavía no se ha conectado el Jugador 2.', 'error'); return; }
    startingOnlineBattle = true;
    setStartButtonVisible(true, true);
    try {
      clearTimeout(schedulePhaseStartActions.timer);
      clearTimeout(scheduleSustainedCombatResolution.timer);
      clearTimeout(scheduleSustainedStructureAttacks.timer);
      try { clearTransientBattleUiForRestart(); } catch (_) {}

      const localHudMode = state.hudMode;
      const localSemiAutoMovement = state.semiAutoMovement;
      const fresh = deepClone(INITIAL_BATTLE_STATE);
      Object.keys(state).forEach(key => delete state[key]);
      Object.assign(state, fresh);
      state.hudMode = localHudMode;
      state.semiAutoMovement = localSemiAutoMovement;
      state.aiEnabled = false;
      state.gameOver = false;
      LOCAL_PLAYER_ID = 1;
      ROK_ONLINE_MATCH_ACTIVE = true;
      mainMenuBattleStarted = true;
      initializeElementDecks();
      enterPhase(true, true);
      localStateReady = true;
      lastObservedPhaseKey = currentLocalPhaseKey();
      showBattleScreen();
      renderAll();
      await publishSnapshot({ force: true, status: 'active' });
      closeLobby();
      const introTransitions = [
        { text: 'INICIA EL COMBATE', playerId: 1, duration: 1150 },
        { text: 'EXTRACCIÓN', playerId: 1, duration: 900 },
      ];
      queueTransitions(introTransitions);
      schedulePhaseStartActions(sumTransitionDurations(introTransitions) - 120);
    } catch (error) {
      reportOnlineError(error, 'No se pudo iniciar la batalla online');
      setStatus(readableFirebaseError(error), 'error');
    } finally {
      startingOnlineBattle = false;
      if (!roomCache?.game?.snapshot) setStartButtonVisible(true, false);
    }
  }

  function startSyncLoop() {
    stopSyncLoop();
    syncTimer = window.setInterval(() => {
      void considerPublishingLocalState();
    }, SYNC_INTERVAL_MS);
  }

  function stopSyncLoop() {
    if (syncTimer) window.clearInterval(syncTimer);
    syncTimer = null;
    if (publishTimer) window.clearTimeout(publishTimer);
    publishTimer = null;
  }

  function noteLocalIntent() {
    if (!ROK_ONLINE_MATCH_ACTIVE) return;
    localIntentUntil = Date.now() + LOCAL_ACTION_GRACE_MS;
  }

  async function considerPublishingLocalState() {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomCode || !localStateReady || applyingRemoteSnapshot || publishingSnapshot || leavingRoom) return;
    const ownsTurn = Number(state.activePlayer) === Number(LOCAL_PLAYER_ID);
    const hasRecentIntent = Date.now() <= localIntentUntil;
    if (!ownsTurn && !hasRecentIntent) return;
    const nextSnapshot = makeBattleSnapshot();
    const nextText = snapshotText(nextSnapshot);
    if (!nextText || nextText === lastSnapshotText) return;
    await publishSnapshot({ snapshot: nextSnapshot, snapshotTextValue: nextText });
  }

  async function publishSnapshot(options = {}) {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot || publishingSnapshot || applyingRemoteSnapshot) return false;
    publishingSnapshot = true;
    try {
      const api = await loadFirebase();
      const nextSnapshot = options.snapshot || makeBattleSnapshot();
      const nextText = options.snapshotTextValue || snapshotText(nextSnapshot);
      if (!nextText) return false;
      const gameRef = api.ref(db, `${roomPath}/game`);
      let committedRevision = 0;
      const result = await api.runTransaction(gameRef, current => {
        const currentRevision = Number(current?.revision || 0);
        const currentWriter = String(current?.writerUid || '');
        if (!options.force && currentRevision > lastKnownRevision && currentWriter && currentWriter !== uid) return;
        committedRevision = currentRevision + 1;
        return {
          revision: committedRevision,
          writerUid: uid,
          writerPlayer: playerSlot,
          phaseKey: phaseKeyFromSnapshot(nextSnapshot),
          snapshot: nextSnapshot,
          updatedAt: Date.now(),
        };
      }, { applyLocally: false });
      if (!result.committed) return false;
      lastKnownRevision = Math.max(lastKnownRevision, committedRevision);
      lastSnapshotText = nextText;
      lastObservedPhaseKey = phaseKeyFromSnapshot(nextSnapshot) || lastObservedPhaseKey;
      if (options.status) {
        await api.update(api.ref(db, roomPath), { status: options.status, updatedAt: Date.now() });
      }
      return true;
    } catch (error) {
      reportOnlineError(error, 'Error al guardar el estado PvP');
      return false;
    } finally {
      publishingSnapshot = false;
    }
  }

  function sourceToInteractionPayload(source) {
    return {
      playerId: Number(source?.playerId || 0),
      unitId: source?.unit?.id || null,
      cardId: source?.unit?.cardId || source?.card?.id || null,
      hattoriDirectAttack: Boolean(source?.hattoriDirectAttack),
      ignoreArmor: Boolean(source?.ignoreArmor),
    };
  }

  function reconstructInteractionSource(payload) {
    const sourcePlayerId = Number(payload?.playerId || 0);
    const unit = payload?.unitId ? getUnitById(sourcePlayerId, payload.unitId) : null;
    const card = CARD_LIBRARY[payload?.cardId || unit?.cardId] || null;
    return {
      playerId: sourcePlayerId,
      unit,
      card,
      hattoriDirectAttack: Boolean(payload?.hattoriDirectAttack),
      ignoreArmor: Boolean(payload?.ignoreArmor),
    };
  }

  async function requestRemoteCasterDefense(defenderId, source, amount, options = {}) {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || Number(defenderId) === Number(LOCAL_PLAYER_ID)) {
      return showCasterDefenseMenu(defenderId, source, amount, options);
    }
    const api = await loadFirebase();
    await publishSnapshot({ force: true });
    const interactionId = `def_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const interaction = {
      id: interactionId,
      type: 'caster-defense',
      status: 'pending',
      requesterUid: uid,
      requesterPlayer: playerSlot,
      targetPlayer: Number(defenderId),
      createdAt: Date.now(),
      payload: {
        source: sourceToInteractionPayload(source),
        amount: Math.max(0, Number(amount || 0)),
        isDistanceAttack: Boolean(options.isDistanceAttack),
        allowCounter: options.allowCounter !== false,
        isDirectAttack: Boolean(options.isDirectAttack),
      },
    };
    const interactionRef = api.ref(db, `${roomPath}/interaction`);
    await api.set(interactionRef, interaction);
    try { log(`Esperando la respuesta defensiva del Jugador ${defenderId}…`); } catch (_) {}

    return await new Promise(resolve => {
      let settled = false;
      let unsubscribe = null;
      let timeoutId = null;
      const finish = async choice => {
        if (settled) return;
        settled = true;
        if (unsubscribe) unsubscribe();
        if (timeoutId) window.clearTimeout(timeoutId);
        try { await api.remove(interactionRef); } catch (_) {}
        resolve(['defend', 'counter', 'special-counter'].includes(choice) ? choice : 'defend');
      };
      unsubscribe = api.onValue(interactionRef, snapshot => {
        const value = snapshot.val();
        if (!value) return;
        if (value.id !== interactionId || value.status !== 'resolved') return;
        void finish(value.response?.choice || 'defend');
      }, () => { void finish('defend'); });
      timeoutId = window.setTimeout(() => { void finish('defend'); }, REMOTE_DEFENSE_TIMEOUT_MS);
    });
  }

  async function handleIncomingInteraction(interaction) {
    if (!interaction || interaction.status !== 'pending') return;
    if (Number(interaction.targetPlayer) !== Number(LOCAL_PLAYER_ID)) return;
    if (interaction.id === handledInteractionId) return;
    handledInteractionId = interaction.id;
    try {
      const payload = interaction.payload || {};
      const source = reconstructInteractionSource(payload.source || {});
      const choice = await showCasterDefenseMenu(LOCAL_PLAYER_ID, source, Number(payload.amount || 0), {
        isDistanceAttack: Boolean(payload.isDistanceAttack),
        allowCounter: payload.allowCounter !== false,
        isDirectAttack: Boolean(payload.isDirectAttack),
      });
      const api = await loadFirebase();
      await api.runTransaction(api.ref(db, `${roomPath}/interaction`), current => {
        if (!current || current.id !== interaction.id || current.status !== 'pending') return;
        return {
          ...current,
          status: 'resolved',
          response: { choice: choice || 'defend', uid, player: playerSlot, resolvedAt: Date.now() },
        };
      }, { applyLocally: false });
    } catch (error) {
      reportOnlineError(error, 'Error en la defensa remota del Kaster');
      try {
        const api = await loadFirebase();
        await api.update(api.ref(db, `${roomPath}/interaction`), {
          status: 'resolved',
          response: { choice: 'defend', uid, player: playerSlot, resolvedAt: Date.now(), fallback: true },
        });
      } catch (_) {}
    }
  }

  async function copyRoomCode() {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setStatus(`Código ${roomCode} copiado.`, 'ok');
    } catch (_) {
      if (ui.codeInput) {
        ui.codeInput.value = roomCode;
        ui.codeInput.select();
      }
      setStatus(`Código de sala: ${roomCode}`, 'ok');
    }
  }

  async function detachRoomListener() {
    if (roomUnsubscribe) {
      try { roomUnsubscribe(); } catch (_) {}
      roomUnsubscribe = null;
    }
    if (presenceDisconnect) {
      try { await presenceDisconnect.cancel(); } catch (_) {}
      presenceDisconnect = null;
    }
    stopSyncLoop();
  }

  async function leaveRoom(options = {}) {
    if (leavingRoom) return;
    leavingRoom = true;
    const oldRoomPath = roomPath;
    const oldSlot = playerSlot;
    try {
      await detachRoomListener();
      if (oldRoomPath && oldSlot && db && firebaseApiPromise) {
        try {
          const api = await firebaseApiPromise;
          await api.update(api.ref(db, `${oldRoomPath}/players/${oldSlot}`), { connected: false, lastSeenAt: Date.now() });
        } catch (_) {}
      }
    } finally {
      roomCode = '';
      roomPath = '';
      playerSlot = 0;
      roomCache = null;
      lastKnownRevision = 0;
      lastSnapshotText = '';
      lastObservedPhaseKey = '';
      localStateReady = false;
      handledInteractionId = '';
      localIntentUntil = 0;
      clearSession();
      ROK_ONLINE_MATCH_ACTIVE = false;
      LOCAL_PLAYER_ID = 1;
      state.aiEnabled = true;
      if (ui.badge) { ui.badge.setAttribute('aria-hidden', 'true'); ui.badge.classList.remove('visible'); }
      setStartButtonVisible(false);
      if (ui.codeBox) { ui.codeBox.setAttribute('aria-hidden', 'true'); ui.codeBox.classList.remove('visible'); }
      if (ui.codeValue) ui.codeValue.textContent = '------';
      if (ui.codeInput) ui.codeInput.value = '';
      leavingRoom = false;
    }

    if (!options.keepMenu) {
      try { exitMatchToMainMenu(); }
      catch (_) { try { showMainMenu(); } catch (_) {} }
      if (!options.silent) {
        openLobby();
        setStatus('Saliste de la sala online.', '');
      }
    }
  }

  function readableFirebaseError(error) {
    const code = String(error?.code || '');
    if (code.includes('auth/operation-not-allowed')) return 'Activa Anonymous Authentication en Firebase Authentication.';
    if (code.includes('permission-denied') || code.includes('PERMISSION_DENIED')) return 'Firebase bloqueó la sala. Revisa las Realtime Database Security Rules.';
    if (code.includes('network-request-failed')) return 'No se pudo conectar con Firebase. Revisa Internet y vuelve a intentar.';
    return error?.message || 'Ocurrió un error al conectar la partida online.';
  }

  function reportOnlineError(error, label) {
    try { reportGameException(error, `PvP online · ${label}`); }
    catch (_) { try { console.error(`[ROK PvP] ${label}`, error); } catch (_) {} }
  }

  function bindUi() {
    cacheUi();
    ui.closeBtn?.addEventListener('click', closeLobby);
    ui.createBtn?.addEventListener('click', () => { void createRoom(); });
    ui.joinBtn?.addEventListener('click', () => { void joinRoom(); });
    ui.copyBtn?.addEventListener('click', () => { void copyRoomCode(); });
    ui.startBtn?.addEventListener('click', () => { void startFreshOnlineBattleAsHost(); });
    ui.leaveBtn?.addEventListener('click', () => { void leaveRoom({ silent: false, keepMenu: false }); });
    ui.overlay?.addEventListener('click', event => {
      if (event.target === ui.overlay && !roomCode) closeLobby();
    });
    ui.codeInput?.addEventListener('input', event => {
      event.target.value = normalizeRoomCode(event.target.value);
    });
    ui.codeInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void joinRoom();
      }
    });

    ['pointerdown', 'click', 'keydown'].forEach(type => {
      document.addEventListener(type, noteLocalIntent, true);
    });

    window.addEventListener('beforeunload', () => {
      if (!roomPath || !playerSlot || !db || !firebaseApiPromise) return;
      void firebaseApiPromise.then(api => api.update(api.ref(db, `${roomPath}/players/${playerSlot}`), {
        connected: false,
        lastSeenAt: Date.now(),
      })).catch(() => {});
    });
  }

  window.ROK_ONLINE_PVP = {
    openLobby,
    closeLobby,
    createRoom,
    joinRoom,
    leaveRoom,
    requestRemoteCasterDefense,
    publishNow: () => publishSnapshot({ force: true }),
    getSession: () => ({ roomCode, playerSlot, uid, revision: lastKnownRevision, active: ROK_ONLINE_MATCH_ACTIVE }),
  };

  window.addEventListener('DOMContentLoaded', bindUi);
}());
