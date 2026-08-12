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
    apiKey: 'AIzaSyAjBzmwDLoZ1B4NfRoJTjhVAg3FX1TDlm4',
    authDomain: 'risin96ames.firebaseapp.com',
    databaseURL: 'https://risin96ames-default-rtdb.firebaseio.com',
    projectId: 'risin96ames',
    storageBucket: 'risin96ames.firebasestorage.app',
    messagingSenderId: '1017550552657',
    appId: '1:1017550552657:web:8b8de12408acd3c3dbc270',
  };

  const FIREBASE_VERSION = '12.16.0';
  const ROOM_ROOT = 'rooms';
  const ROOM_CODE_LENGTH = 6;
  const SYNC_INTERVAL_MS = 220;
  const REMOTE_DEFENSE_TIMEOUT_MS = 45000;
  const REMOTE_ACTION_WINDOW_TIMEOUT_MS = 60000;
  const SESSION_STORAGE_KEY = 'rok_online_room_session_v2';
  const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const FRIEND_CODE_LENGTH = 8;
  const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const OPEN_ROOMS_ROOT = 'openRooms';
  const AVATAR_JOBS_ROOT = 'avatarJobs';
  const AVATAR_SOURCE_ROOT = 'casterAvatarSources';
  const CUSTOM_PROFILE_AVATAR_ID = 'custom-caster';
  const MAX_CASTER_AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;
  const LOBBY_COUNTDOWN_MS = 3400;
  const ARENA_OPTIONS = Object.freeze({
    classic: { id: 'classic', label: 'Arena clásica', src: 'assets/arena.webp' },
    egypt: { id: 'egypt', label: 'Arena Egipto', src: 'assets/arena-egipto.webp' },
  });

  const ONLINE_SNAPSHOT_SCHEMA_VERSION = 2;

  // Estado autoritativo que debe ser idéntico en ambos navegadores.
  // La UI transitoria (menús, selección local, resolvers, etc.) NO viaja aquí.
  const SNAPSHOT_KEYS = [
    'activePlayer',
    'phaseIndex',
    'turnSerial',
    'phaseTransitionSerial',
    'phaseTransitionFrom',
    'phaseTransitionTo',
    'phaseTransitionChangedPlayer',
    'phaseTransitionReason',
    'gameOver',
    'matchWins',
    'phaseUndo',
    'resolutionUndoReturn',
    'resolutionActionTaken',
    'turnActionByPlayer',
    'resolutionSerial',
    'arenaEntrySerial',
    'smokeZones',
    'celestialLamps',
    'longNightEffects',
    'activeSpellLinks',
    'pendingGuardianStrikes',
    'kaguyaChargedShots',
    'minokageCharges',
    'pendingImmediateMinokageResolutions',
    'pendingTimedAbilityResolutions',
    'droppedWeapons',
    'kouutenProgressiveByPlayer',
    'extractedThisPhase',
    'players',
  ];

  // Firebase RTDB elimina propiedades null y colecciones vacías. Si una
  // colección pasa de "con datos" a vacía y no la reconstruimos, el otro
  // navegador conservaría basura de una revisión anterior. Estos defaults
  // hacen que cada snapshot sea reemplazo de estado, no un merge parcial.
  const SNAPSHOT_ARRAY_KEYS = new Set([
    'smokeZones',
    'celestialLamps',
    'longNightEffects',
    'activeSpellLinks',
    'pendingGuardianStrikes',
    'kaguyaChargedShots',
    'minokageCharges',
    'pendingImmediateMinokageResolutions',
    'pendingTimedAbilityResolutions',
    'droppedWeapons',
  ]);

  function snapshotDefaultValue(key) {
    if (SNAPSHOT_ARRAY_KEYS.has(key)) return [];
    if (key === 'phaseUndo' || key === 'resolutionUndoReturn') return null;
    if (key === 'turnActionByPlayer') return { 1: null, 2: null };
    if (key === 'kouutenProgressiveByPlayer') return {};
    if (key === 'phaseTransitionSerial') return 0;
    if (key === 'phaseTransitionFrom') return 'initial';
    if (key === 'phaseTransitionTo') return 'extraction';
    if (key === 'phaseTransitionChangedPlayer') return false;
    if (key === 'phaseTransitionReason') return 'initial';
    return undefined;
  }

  const ui = {};
  let firebaseApiPromise = null;
  let auth = null;
  let db = null;
  let storage = null;
  let uid = '';
  let roomCode = '';
  let roomPath = '';
  let playerSlot = 0;
  let roomUnsubscribe = null;
  let fxUnsubscribe = null;
  let fxListenerStartedAt = 0;
  const handledFxEventIds = new Set();
  let presenceDisconnect = null;
  let syncTimer = null;
  let publishTimer = null;
  let roomCache = null;
  let lastKnownRevision = 0;
  let lastSnapshotText = '';
  let lastObservedPhaseKey = '';
  let lastStartedPhaseKey = '';
  let phaseDeliveryScheduledKey = '';
  let lastAnnouncedPhaseKey = '';
  let phaseDeliveryRetryTimer = null;
  let pendingPhaseDeliveryContext = null;
  let turnHandoffPublishPending = false;
  let applyingRemoteSnapshot = false;
  let publishingSnapshot = false;
  let startingOnlineBattle = false;
  let handledInteractionId = '';
  let leavingRoom = false;
  let localStateReady = false;
  let onlineLobbyView = 'home';
  let availableRoomUnsubscribes = [];
  const availableRoomsByHost = new Map();
  let lobbyCountdownTimer = null;
  let lobbyCountdownStartAt = 0;
  let lobbyStartTimer = null;
  let hostLobbyReconcileBusy = false;
  let lobbyRoomDisconnect = null;
  let lobbyListingDisconnect = null;
  let lobbyGuestUidDisconnect = null;
  let lobbyDisconnectKey = '';

  // Cuenta de jugador + sistema social. La identidad online usa un UID real
  // de Firebase Authentication (email/contraseña); no se crean usuarios
  // anónimos. La sesión usa browserLocalPersistence para sobrevivir recargas.
  const accountUi = {};
  let accountAuthUnsubscribe = null;
  let accountAuthReady = false;
  const socialUi = {};
  const profileUi = {};
  let socialProfileCache = null;
  let socialUnsubscribes = [];
  let socialFriendsRenderSerial = 0;
  let socialRequestsRenderSerial = 0;
  let casterAvatarSourceFile = null;
  let casterAvatarSourceObjectUrl = '';
  let casterAvatarJobUnsubscribe = null;
  let casterAvatarCurrentJobId = '';
  let casterAvatarCurrentResultUrl = '';

  const PROFILE_AVATARS = Object.freeze([
    { id: 'shinra', label: 'Shinra Hitokiri', src: 'assets/shinra-hitokiri-token.png' },
    { id: 'oda', label: 'Oda no Kage', src: 'assets/oda-no-kage-token.png' },
    { id: 'takeda', label: 'Takeda Shingen', src: 'assets/takeda-shingen-token.png' },
    { id: 'ueshiba', label: 'O-sensei Ueshiba', src: 'assets/o-sensei-ueshiba-token.png' },
    { id: 'musashi', label: 'Miyamoto Musashi', src: 'assets/miyamoto-musashi-token.png' },
    { id: 'tokugawa', label: 'Tokugawa', src: 'assets/tokugawa-light-token.webp' },
  ]);
  const DEFAULT_PROFILE_AVATAR_ID = 'shinra';
  const LOCAL_SOCIAL_PROFILE_PREFIX = 'rokLocalSocialProfile';
  const LOCAL_CASTER_AVATAR_JOB_PREFIX = 'rokLocalCasterAvatarJob';

  function isCasterAvatarMockMode() {
    return new URLSearchParams(window.location.search).get('avatarMock') === '1';
  }

  function isPermissionDeniedError(error) {
    const code = String(error?.code || error?.message || '').toLowerCase();
    return code.includes('permission-denied') || code.includes('permission denied');
  }

  function buildLocalScopedKey(prefix) {
    return `${prefix}:${String(uid || 'guest')}`;
  }

  function readLocalJson(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeLocalJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function makeLocalFriendCode(seed = '') {
    const alphabet = FRIEND_CODE_ALPHABET;
    const source = String(seed || uid || auth?.currentUser?.uid || 'KASTERLOCAL');
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) hash = ((hash * 31) + source.charCodeAt(i)) >>> 0;
    let code = '';
    for (let i = 0; i < FRIEND_CODE_LENGTH; i += 1) {
      code += alphabet[hash % alphabet.length];
      hash = Math.floor(hash / alphabet.length) ^ ((source.charCodeAt(i % source.length) || 17) << 7);
      hash >>>= 0;
    }
    return code;
  }

  function buildLocalSocialProfile(existing = {}) {
    const stored = readLocalJson(buildLocalScopedKey(LOCAL_SOCIAL_PROFILE_PREFIX), {}) || {};
    const merged = { ...stored, ...existing };
    const friendCode = normalizeFriendCode(merged.friendCode || '') || makeLocalFriendCode(merged.displayName || merged.uid || uid);
    const displayName = normalizeSocialDisplayName(merged.displayName)
      || normalizeSocialDisplayName(auth?.currentUser?.displayName)
      || `Kaster ${String(friendCode || '0000').slice(-4)}`;
    const profile = {
      friendCode,
      displayName,
      avatarId: normalizeProfileAvatarId(merged.avatarId),
      casterAvatarUrl: String(merged.casterAvatarUrl || ''),
      level: normalizeAccountLevel(merged.level),
      xp: normalizeAccountXp(merged.xp),
      createdAt: Number(merged.createdAt || Date.now()),
      updatedAt: Date.now(),
    };
    if (profile.avatarId === CUSTOM_PROFILE_AVATAR_ID && !profile.casterAvatarUrl) profile.avatarId = DEFAULT_PROFILE_AVATAR_ID;
    return profile;
  }

  function persistLocalSocialProfile(profile) {
    writeLocalJson(buildLocalScopedKey(LOCAL_SOCIAL_PROFILE_PREFIX), profile);
  }

  function readLocalCasterAvatarJob() {
    return readLocalJson(buildLocalScopedKey(LOCAL_CASTER_AVATAR_JOB_PREFIX), null);
  }

  function persistLocalCasterAvatarJob(payload) {
    writeLocalJson(buildLocalScopedKey(LOCAL_CASTER_AVATAR_JOB_PREFIX), payload);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen seleccionada.'));
        reader.readAsDataURL(file);
      } catch (error) {
        reject(error);
      }
    });
  }

  function normalizeProfileAvatarId(value) {
    const id = String(value || '');
    if (id === CUSTOM_PROFILE_AVATAR_ID) return CUSTOM_PROFILE_AVATAR_ID;
    return PROFILE_AVATARS.some(entry => entry.id === id) ? id : DEFAULT_PROFILE_AVATAR_ID;
  }

  function getProfileAvatar(id, profileLike = null) {
    const normalized = normalizeProfileAvatarId(id);
    const profile = profileLike || socialProfileCache || {};
    if (normalized === CUSTOM_PROFILE_AVATAR_ID && profile?.casterAvatarUrl) {
      return { id: CUSTOM_PROFILE_AVATAR_ID, label: 'Mi Kaster', src: String(profile.casterAvatarUrl) };
    }
    return PROFILE_AVATARS.find(entry => entry.id === normalized) || PROFILE_AVATARS[0];
  }

  function normalizeAccountLevel(value) {
    return Math.max(1, Math.min(999, Math.floor(Number(value) || 1)));
  }

  function normalizeAccountXp(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
  }

  function getXpRequirement(level) {
    const safeLevel = normalizeAccountLevel(level);
    return 100 + ((safeLevel - 1) * 50);
  }

  function cacheUi() {
    ui.overlay = document.getElementById('onlineLobbyOverlay');
    ui.closeBtn = document.getElementById('onlineLobbyCloseBtn');
    ui.title = document.getElementById('onlineLobbyTitle');
    ui.copy = document.getElementById('onlineLobbyCopy');
    ui.homeView = document.getElementById('onlineLobbyHomeView');
    ui.joinView = document.getElementById('onlineJoinBrowserView');
    ui.roomView = document.getElementById('onlineRoomView');
    ui.createBtn = document.getElementById('onlineCreateRoomBtn');
    ui.joinBtn = document.getElementById('onlineJoinRoomBtn');
    ui.joinBackBtn = document.getElementById('onlineJoinBackBtn');
    ui.joinRefreshBtn = document.getElementById('onlineJoinRefreshBtn');
    ui.availableRoomsList = document.getElementById('onlineAvailableRoomsList');
    ui.codeInput = document.getElementById('onlineRoomCodeInput');
    ui.codeBox = document.getElementById('onlineRoomCodeBox');
    ui.codeValue = document.getElementById('onlineRoomCodeValue');
    ui.copyBtn = document.getElementById('onlineCopyCodeBtn');
    ui.status = document.getElementById('onlineLobbyStatus');
    ui.startBtn = document.getElementById('onlineStartMatchBtn');
    ui.readyBtn = ui.startBtn;
    ui.selectSpellbookBtn = document.getElementById('onlineSelectSpellbookBtn');
    ui.localSpellbookName = document.getElementById('onlineLocalSpellbookName');
    ui.arenaSelect = document.getElementById('onlineArenaSelect');
    ui.arenaPreview = document.getElementById('onlineArenaPreview');
    ui.roomRole = document.getElementById('onlineRoomRole');
    ui.roomName = document.getElementById('onlineRoomName');
    ui.roomConnection = document.getElementById('onlineRoomConnection');
    ui.hostAvatar = document.getElementById('onlineHostAvatar');
    ui.hostName = document.getElementById('onlineHostName');
    ui.hostSpellbook = document.getElementById('onlineHostSpellbook');
    ui.hostReady = document.getElementById('onlineHostReady');
    ui.guestAvatar = document.getElementById('onlineGuestAvatar');
    ui.guestName = document.getElementById('onlineGuestName');
    ui.guestSpellbook = document.getElementById('onlineGuestSpellbook');
    ui.guestReady = document.getElementById('onlineGuestReady');
    ui.countdown = document.getElementById('onlineCountdown');
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
    if (ui.joinBackBtn) ui.joinBackBtn.disabled = disabled;
    if (ui.joinRefreshBtn) ui.joinRefreshBtn.disabled = disabled;
    if (disabled) {
      if (ui.selectSpellbookBtn) ui.selectSpellbookBtn.disabled = true;
      if (ui.arenaSelect) ui.arenaSelect.disabled = true;
      if (ui.readyBtn) ui.readyBtn.disabled = true;
    } else if (roomCache) {
      renderRoomLobby(roomCache);
    }
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

  function getRoomPlayerUid(room, slot) {
    return Number(slot) === 1 ? String(room?.hostUid || '') : String(room?.guestUid || '');
  }

  function getRoomPlayerRecord(room, slot) {
    const playerUid = getRoomPlayerUid(room, slot);
    return playerUid ? (room?.players?.[playerUid] || null) : null;
  }


  function normalizeArenaId(value) {
    const id = String(value || 'classic');
    return ARENA_OPTIONS[id] ? id : 'classic';
  }

  function getArenaOption(value) {
    return ARENA_OPTIONS[normalizeArenaId(value)];
  }

  function applyArenaToBattle(arenaId) {
    const arena = getArenaOption(arenaId);
    const image = document.querySelector('.arena-img');
    if (image && image.getAttribute('src') !== arena.src) image.setAttribute('src', arena.src);
    return arena;
  }

  function setOnlineLobbyView(view) {
    onlineLobbyView = ['home', 'join', 'room'].includes(view) ? view : 'home';
    if (ui.homeView) ui.homeView.hidden = onlineLobbyView !== 'home';
    if (ui.joinView) ui.joinView.hidden = onlineLobbyView !== 'join';
    if (ui.roomView) ui.roomView.hidden = onlineLobbyView !== 'room';
    if (ui.title) ui.title.textContent = onlineLobbyView === 'room' ? 'Lobby de partida' : (onlineLobbyView === 'join' ? 'Partidas de amigos' : 'Duelo entre amigos');
    if (ui.copy) ui.copy.textContent = onlineLobbyView === 'room'
      ? 'Selecciona tu Spellbook. El Host elige la arena. Cuando ambos jugadores estén listos, el duelo comienza automáticamente.'
      : (onlineLobbyView === 'join'
        ? 'Solo aparecen partidas abiertas por jugadores que ya están en tu lista de amigos.'
        : 'Crea una partida o entra a una partida abierta por uno de tus amigos.');
  }

  function stopAvailableRoomListeners() {
    availableRoomUnsubscribes.forEach(unsubscribe => { try { unsubscribe(); } catch (_) {} });
    availableRoomUnsubscribes = [];
    availableRoomsByHost.clear();
  }

  function renderAvailableRooms() {
    if (!ui.availableRoomsList) return;
    const entries = [];
    availableRoomsByHost.forEach((rooms, hostUid) => {
      Object.entries(rooms || {}).forEach(([code, room]) => {
        if (!room || String(room.hostUid || hostUid) !== String(hostUid)) return;
        entries.push({ code: normalizeRoomCode(code), hostUid, ...room });
      });
    });
    entries.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    ui.availableRoomsList.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'online-room-empty';
      empty.textContent = 'No hay partidas disponibles de tus amigos en este momento.';
      ui.availableRoomsList.appendChild(empty);
      return;
    }
    entries.forEach(entry => {
      const row = document.createElement('article');
      row.className = 'online-available-room';
      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'online-available-room-avatar';
      const avatar = document.createElement('img');
      avatar.src = getProfileAvatar(entry.avatarId, { casterAvatarUrl: entry.avatarUrl || '' }).src;
      avatar.alt = entry.hostName || 'Host';
      avatarWrap.appendChild(avatar);
      const copy = document.createElement('div');
      copy.className = 'online-available-room-copy';
      const name = document.createElement('strong');
      name.textContent = entry.hostName || 'Amigo';
      const arena = getArenaOption(entry.arenaId);
      const meta = document.createElement('span');
      meta.textContent = `${arena.label} · Nivel ${normalizeAccountLevel(entry.level)} · Esperando rival`;
      copy.append(name, meta);
      const join = document.createElement('button');
      join.type = 'button';
      join.textContent = 'UNIRSE';
      join.addEventListener('click', () => { join.disabled = true; void joinRoom(entry.code); });
      row.append(avatarWrap, copy, join);
      ui.availableRoomsList.appendChild(row);
    });
  }

  async function startAvailableRoomListeners() {
    stopAvailableRoomListeners();
    if (ui.availableRoomsList) ui.availableRoomsList.innerHTML = '<div class="online-room-empty">Buscando partidas de tus amigos…</div>';
    const api = await loadFirebase();
    const friendIds = await getFriendIds();
    if (!friendIds.length) {
      renderAvailableRooms();
      setStatus('Todavía no tienes amigos agregados. Añade amigos desde tu perfil para ver sus partidas.', '');
      return;
    }
    friendIds.forEach(friendUid => {
      const unsubscribe = api.onValue(api.ref(db, `${OPEN_ROOMS_ROOT}/${friendUid}`), snapshot => {
        availableRoomsByHost.set(friendUid, snapshot.val() || {});
        renderAvailableRooms();
      }, error => {
        reportOnlineError(error, 'No se pudo leer la bandeja de partidas');
        setStatus(readableFirebaseError(error), 'error');
      });
      availableRoomUnsubscribes.push(unsubscribe);
    });
    setStatus('Bandeja conectada. Las partidas nuevas aparecerán automáticamente.', 'ok');
  }

  async function showJoinBrowser() {
    setOnlineLobbyView('join');
    setStatus('Buscando partidas abiertas de tus amigos…', 'working');
    try { await startAvailableRoomListeners(); }
    catch (error) {
      reportOnlineError(error, 'No se pudo abrir la bandeja de partidas');
      setStatus(readableFirebaseError(error), 'error');
    }
  }

  async function cleanupOwnOpenRooms(api) {
    const snapshot = await api.get(api.ref(db, `${OPEN_ROOMS_ROOT}/${uid}`));
    const rooms = snapshot.val() || {};
    for (const code of Object.keys(rooms)) {
      const normalized = normalizeRoomCode(code);
      if (!normalized) continue;
      try {
        const roomSnap = await api.get(api.ref(db, roomRefPath(normalized)));
        const oldRoom = roomSnap.val();
        if (String(oldRoom?.hostUid || '') === uid && !oldRoom?.game?.snapshot) {
          await api.remove(api.ref(db, roomRefPath(normalized)));
        }
      } catch (_) {}
      try { await api.remove(api.ref(db, `${OPEN_ROOMS_ROOT}/${uid}/${normalized}`)); } catch (_) {}
    }
  }

  async function publishOpenRoomListing(api, code, room = null) {
    if (!code || playerSlot !== 1) return;
    const profile = socialProfileCache || await ensureSocialProfile();
    const arenaId = normalizeArenaId(room?.arenaId || ui.arenaSelect?.value || 'classic');
    await api.set(api.ref(db, `${OPEN_ROOMS_ROOT}/${uid}/${normalizeRoomCode(code)}`), {
      hostUid: uid,
      hostName: profile.displayName,
      avatarId: normalizeProfileAvatarId(profile.avatarId),
      avatarUrl: profile.casterAvatarUrl || '',
      level: normalizeAccountLevel(profile.level),
      arenaId,
      createdAt: Number(room?.createdAt || Date.now()),
    });
  }

  async function removeOpenRoomListing(api, code = roomCode, hostUid = String(roomCache?.hostUid || uid)) {
    if (!code || !hostUid) return;
    try { await api.remove(api.ref(db, `${OPEN_ROOMS_ROOT}/${hostUid}/${normalizeRoomCode(code)}`)); } catch (_) {}
  }

  function setPlayerReadyBadge(element, ready, connected = true) {
    if (!element) return;
    element.textContent = !connected ? 'DESCONECTADO' : (ready ? 'LISTO' : 'NO LISTO');
    element.classList.toggle('ready', Boolean(connected && ready));
  }

  function renderLobbyPlayer(record, slot, room) {
    const isHost = Number(slot) === 1;
    const avatar = isHost ? ui.hostAvatar : ui.guestAvatar;
    const name = isHost ? ui.hostName : ui.guestName;
    const spellbook = isHost ? ui.hostSpellbook : ui.guestSpellbook;
    const ready = isHost ? ui.hostReady : ui.guestReady;
    const connected = Boolean(record?.connected);
    if (avatar) avatar.src = getProfileAvatar(record?.avatarId, { casterAvatarUrl: record?.avatarUrl || '' }).src;
    if (name) name.textContent = record?.displayName || (isHost ? 'Host' : (room?.guestUid ? 'Invitado' : 'Esperando amigo…'));
    if (spellbook) spellbook.textContent = record?.loadout?.name || 'Sin Spellbook';
    setPlayerReadyBadge(ready, Boolean(record?.ready), connected || (isHost && Boolean(record)));
  }

  function renderRoomLobby(room) {
    if (!room) return;
    setOnlineLobbyView('room');
    const p1 = getRoomPlayerRecord(room, 1);
    const p2 = getRoomPlayerRecord(room, 2);
    renderLobbyPlayer(p1, 1, room);
    renderLobbyPlayer(p2, 2, room);
    const localRecord = getRoomPlayerRecord(room, playerSlot);
    const localLoadout = localRecord?.loadout || getLocalSelectedLoadout();
    if (ui.localSpellbookName) ui.localSpellbookName.textContent = localLoadout?.name || 'Sin seleccionar';
    if (ui.roomRole) ui.roomRole.textContent = playerSlot === 1 ? 'HOST · JUGADOR 1' : 'INVITADO · JUGADOR 2';
    if (ui.roomName) ui.roomName.textContent = room.status === 'countdown' ? 'El duelo está por comenzar' : 'Preparando duelo';
    const bothConnected = Boolean(p1?.connected && p2?.connected && room.guestUid);
    if (ui.roomConnection) {
      ui.roomConnection.textContent = bothConnected ? '2/2 CONECTADOS' : '1/2 CONECTADOS';
      ui.roomConnection.classList.toggle('connected', bothConnected);
    }
    const arena = getArenaOption(room.arenaId);
    if (ui.arenaSelect) {
      ui.arenaSelect.value = arena.id;
      ui.arenaSelect.disabled = playerSlot !== 1 || room.status === 'countdown';
    }
    if (ui.arenaPreview) ui.arenaPreview.src = arena.src;
    applyArenaToBattle(arena.id);
    const localReady = Boolean(localRecord?.ready);
    if (ui.readyBtn) {
      ui.readyBtn.textContent = localReady ? 'CANCELAR LISTO' : 'LISTO';
      ui.readyBtn.classList.toggle('is-ready', localReady);
      ui.readyBtn.disabled = Boolean(room.status === 'countdown' || !localLoadout || getLoadoutIssue(localLoadout));
      ui.readyBtn.setAttribute('aria-hidden', 'false');
    }
    if (ui.selectSpellbookBtn) ui.selectSpellbookBtn.disabled = room.status === 'countdown';
  }

  function stopLobbyCountdown() {
    if (lobbyCountdownTimer) window.clearInterval(lobbyCountdownTimer);
    lobbyCountdownTimer = null;
    if (lobbyStartTimer) window.clearTimeout(lobbyStartTimer);
    lobbyStartTimer = null;
    lobbyCountdownStartAt = 0;
    if (ui.countdown) {
      ui.countdown.classList.remove('visible');
      ui.countdown.setAttribute('aria-hidden', 'true');
    }
  }

  function renderLobbyCountdown(startAt) {
    const target = Number(startAt || 0);
    if (!target) { stopLobbyCountdown(); return; }
    if (lobbyCountdownStartAt !== target) {
      stopLobbyCountdown();
      lobbyCountdownStartAt = target;
    }
    const paint = () => {
      const remaining = target - Date.now();
      let text = '¡COMBATE!';
      if (remaining > 2400) text = '3';
      else if (remaining > 1400) text = '2';
      else if (remaining > 400) text = '1';
      if (ui.countdown) {
        ui.countdown.classList.add('visible');
        ui.countdown.setAttribute('aria-hidden', 'false');
        const label = ui.countdown.querySelector('span');
        if (label && label.textContent !== text) {
          label.textContent = text;
          label.style.animation = 'none';
          void label.offsetWidth;
          label.style.animation = '';
        }
      }
      if (remaining <= -700 && lobbyCountdownTimer) {
        window.clearInterval(lobbyCountdownTimer);
        lobbyCountdownTimer = null;
      }
    };
    paint();
    if (!lobbyCountdownTimer) lobbyCountdownTimer = window.setInterval(paint, 100);
  }

  async function setLobbyLoadout(loadout) {
    if (!loadout || getLoadoutIssue(loadout)) {
      setStatus(getLoadoutIssue(loadout) || 'Selecciona un Spellbook válido.', 'error');
      return false;
    }
    if (!roomPath || !playerSlot) return true;
    try {
      const api = await loadFirebase();
      await api.update(api.ref(db, `${roomPath}/players/${uid}`), {
        loadout,
        ready: false,
        lastSeenAt: Date.now(),
      });
      setStatus(`Spellbook “${loadout.name}” seleccionado.`, 'ok');
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo seleccionar el Spellbook del lobby');
      setStatus(readableFirebaseError(error), 'error');
      return false;
    }
  }

  async function toggleLobbyReady() {
    if (!roomPath || !playerSlot || !roomCache) return;
    const localRecord = getRoomPlayerRecord(roomCache, playerSlot);
    const loadout = localRecord?.loadout || getLocalSelectedLoadout();
    const issue = getLoadoutIssue(loadout);
    if (issue || !loadout) { setStatus(issue || 'Selecciona tu Spellbook antes de marcar Listo.', 'error'); return; }
    if (!localRecord?.connected) { setStatus('Tu conexión al lobby todavía no está lista.', 'error'); return; }
    try {
      const api = await loadFirebase();
      await api.update(api.ref(db, `${roomPath}/players/${uid}`), { ready: !Boolean(localRecord?.ready), lastSeenAt: Date.now() });
    } catch (error) {
      reportOnlineError(error, 'No se pudo cambiar el estado Listo');
      setStatus(readableFirebaseError(error), 'error');
    }
  }

  async function changeLobbyArena(arenaId) {
    if (!roomPath || playerSlot !== 1 || !roomCache) return;
    const normalized = normalizeArenaId(arenaId);
    try {
      const api = await loadFirebase();
      const updates = { arenaId: normalized };
      if (roomCache.status === 'countdown') { updates.status = 'full'; updates.startAt = null; }
      await api.update(api.ref(db, roomPath), updates);
      await api.update(api.ref(db, `${roomPath}/players/${uid}`), { ready: false, lastSeenAt: Date.now() });
      if (!roomCache.guestUid) await publishOpenRoomListing(api, roomCode, { ...roomCache, arenaId: normalized });
    } catch (error) {
      reportOnlineError(error, 'No se pudo cambiar la arena');
      setStatus(readableFirebaseError(error), 'error');
    }
  }

  async function beginLobbyCountdown() {
    if (playerSlot !== 1 || !roomPath || !roomCache || roomCache.status === 'countdown') return;
    const p1 = getRoomPlayerRecord(roomCache, 1);
    const p2 = getRoomPlayerRecord(roomCache, 2);
    const bothReady = Boolean(roomCache.guestUid && p1?.connected && p2?.connected && p1?.ready && p2?.ready && !getLoadoutIssue(p1?.loadout) && !getLoadoutIssue(p2?.loadout));
    if (!bothReady) return;
    try {
      const api = await loadFirebase();
      await removeOpenRoomListing(api, roomCode, uid);
      await api.update(api.ref(db, roomPath), { status: 'countdown', startAt: Date.now() + LOBBY_COUNTDOWN_MS });
    } catch (error) {
      reportOnlineError(error, 'No se pudo iniciar la cuenta regresiva');
    }
  }

  async function cancelLobbyDisconnects() {
    for (const handle of [lobbyRoomDisconnect, lobbyListingDisconnect, lobbyGuestUidDisconnect]) {
      if (!handle) continue;
      try { await handle.cancel(); } catch (_) {}
    }
    lobbyRoomDisconnect = null;
    lobbyListingDisconnect = null;
    lobbyGuestUidDisconnect = null;
    lobbyDisconnectKey = '';
  }

  async function configureLobbyDisconnects(room) {
    if (!roomPath || !playerSlot || !uid || room?.game?.snapshot) {
      await cancelLobbyDisconnects();
      return;
    }
    const key = `${roomCode}:${playerSlot}:${room?.hostUid || ''}:${room?.guestUid || ''}`;
    if (lobbyDisconnectKey === key) return;
    await cancelLobbyDisconnects();
    const api = await loadFirebase();
    try {
      if (playerSlot === 1) {
        lobbyRoomDisconnect = api.onDisconnect(api.ref(db, roomPath));
        lobbyListingDisconnect = api.onDisconnect(api.ref(db, `${OPEN_ROOMS_ROOT}/${uid}/${roomCode}`));
        await lobbyRoomDisconnect.remove();
        await lobbyListingDisconnect.remove();
      } else if (playerSlot === 2 && String(room?.guestUid || '') === uid) {
        lobbyGuestUidDisconnect = api.onDisconnect(api.ref(db, `${roomPath}/guestUid`));
        await lobbyGuestUidDisconnect.remove();
      }
      lobbyDisconnectKey = key;
    } catch (error) {
      reportOnlineError(error, 'No se pudo preparar la salida automática del lobby');
    }
  }

  async function reconcileLobbyAsHost(room) {
    if (playerSlot !== 1 || hostLobbyReconcileBusy || !roomPath || room?.game?.snapshot) return;
    hostLobbyReconcileBusy = true;
    try {
      const api = await loadFirebase();
      const p1 = getRoomPlayerRecord(room, 1);
      const p2 = getRoomPlayerRecord(room, 2);
      const guestPresent = Boolean(room.guestUid && p2?.uid);
      const bothReady = Boolean(guestPresent && p1?.connected && p2?.connected && p1?.ready && p2?.ready && !getLoadoutIssue(p1?.loadout) && !getLoadoutIssue(p2?.loadout));

      if (!guestPresent && room.status !== 'open') {
        await api.update(api.ref(db, roomPath), { status: 'open', startAt: null });
      }
      if (!guestPresent) {
        if (p1?.ready) await api.update(api.ref(db, `${roomPath}/players/${uid}`), { ready: false, lastSeenAt: Date.now() });
        await publishOpenRoomListing(api, roomCode, room);
      } else {
        await removeOpenRoomListing(api, roomCode, uid);
        if (room.status === 'open') await api.set(api.ref(db, `${roomPath}/status`), 'full');
      }
      if (room.status === 'countdown' && !bothReady) {
        await api.update(api.ref(db, roomPath), { status: guestPresent ? 'full' : 'open', startAt: null });
        stopLobbyCountdown();
      } else if (guestPresent && bothReady && (room.status === 'full' || room.status === 'open')) {
        await beginLobbyCountdown();
      }
    } catch (error) {
      reportOnlineError(error, 'No se pudo reconciliar el lobby');
    } finally {
      hostLobbyReconcileBusy = false;
    }
  }


  function getLocalSelectedLoadout() {
    return window.ROK_SPELLBOOK_MATCH?.getPendingOnlineLoadout?.() || null;
  }

  function getLoadoutIssue(loadout) {
    return window.ROK_SPELLBOOK_MATCH?.getLoadoutIssue?.(loadout) || (!loadout ? 'Selecciona un Spellbook antes de entrar al PvP.' : '');
  }

  function requireLocalSelectedLoadout() {
    const loadout = getLocalSelectedLoadout();
    const issue = getLoadoutIssue(loadout);
    if (!loadout || issue) throw new Error(issue || 'Selecciona un Spellbook antes de entrar al PvP.');
    return loadout;
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

  function currentPhaseContext() {
    const phaseIndex = Number(state.phaseIndex || 0);
    const phase = Array.isArray(PHASES) ? PHASES[phaseIndex] : null;
    return {
      key: currentLocalPhaseKey(),
      turnSerial: Number(state.turnSerial || 0),
      activePlayer: Number(state.activePlayer || 0),
      phaseIndex,
      phaseId: String(phase?.id || ''),
      phaseLabel: String(phase?.label || 'FASE').toUpperCase(),
    };
  }

  function makeBattleSnapshot() {
    const snapshot = { _schemaVersion: ONLINE_SNAPSHOT_SCHEMA_VERSION };
    SNAPSHOT_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        snapshot[key] = deepClone(state[key]);
        return;
      }
      const fallback = snapshotDefaultValue(key);
      if (fallback !== undefined) snapshot[key] = deepClone(fallback);
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
    state.gioshoninPriorityAction = null;
    state.gioshoninSupplyPrompt = { active: false, playerId: null, unitId: null, signature: '', lastResolvedSignature: '', startedAt: 0, timeoutId: null, intervalId: null };
    state.remotePriorityAction = null;
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
    if (!snapshot.players || typeof snapshot.players !== 'object') {
      reportOnlineError(new Error('Snapshot PvP incompleto: falta players.'), 'Snapshot inválido');
      return false;
    }
    const previousPhaseContext = currentPhaseContext();
    const oldPhaseKey = previousPhaseContext.key;
    const localHudMode = state.hudMode;
    const localSemiAutoMovement = state.semiAutoMovement;
    const localActiveTab = state.activeTab;

    applyingRemoteSnapshot = true;
    try {
      SNAPSHOT_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
          state[key] = deepClone(snapshot[key]);
          return;
        }
        // RTDB puede omitir null/[]/{}. Para los campos reseteables debemos
        // borrar explícitamente el valor local anterior, no conservarlo.
        const fallback = snapshotDefaultValue(key);
        if (fallback !== undefined) state[key] = deepClone(fallback);
      });
      // RTDB elimina arreglos vacíos y puede devolver arreglos dispersos como
      // objetos numéricos. Reconstruirlos antes de cualquier render o fase.
      if (typeof ensureRuntimeStateCollections === 'function') {
        ensureRuntimeStateCollections(state);
      }
      state.hudMode = localHudMode;
      state.semiAutoMovement = localSemiAutoMovement;
      state.activeTab = localActiveTab;
      // Esta respuesta llega dentro de una secuencia local que está esperando
      // al rival. No se limpian selectedMover/quickReactionWindow/candados: son
      // UI y resolvers locales que deben sobrevivir hasta que el flujo padre
      // continúe después de aplicar el resultado remoto.
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
    lastObservedPhaseKey = newPhaseKey;
    if (newPhaseKey !== oldPhaseKey) {
      phaseDeliveryScheduledKey = '';
      pendingPhaseDeliveryContext = previousPhaseContext;
      if (lastStartedPhaseKey !== newPhaseKey) {
        clearTimeout(phaseDeliveryRetryTimer);
        phaseDeliveryRetryTimer = null;
      }
    }
    // No depender solo del cambio de clave: si un flujo fue cancelado,
    // el mismo snapshot debe poder volver a entregar la fase al dueño local.
    deliverRemotePhaseIfLocal({ previousPhase: pendingPhaseDeliveryContext });

    if (writerUid && writerUid !== uid) {
      turnHandoffPublishPending = false;
      try { window.ROK_DEBUG_RIBBON?.ok?.(`PvP sincronizado · revisión ${lastKnownRevision}`); } catch (_) {}
    }
    return true;
  }

  function clearPhaseDeliveryRetry() {
    if (phaseDeliveryRetryTimer) window.clearTimeout(phaseDeliveryRetryTimer);
    phaseDeliveryRetryTimer = null;
  }

  function markPhaseStarted(phaseKey = '') {
    const key = String(phaseKey || currentLocalPhaseKey());
    if (!key) return;
    lastStartedPhaseKey = key;
    if (phaseDeliveryScheduledKey === key) phaseDeliveryScheduledKey = '';
    pendingPhaseDeliveryContext = null;
    clearPhaseDeliveryRetry();
  }

  function schedulePhaseDeliveryRetry(phaseKey, delayMs) {
    clearPhaseDeliveryRetry();
    phaseDeliveryRetryTimer = window.setTimeout(() => {
      phaseDeliveryRetryTimer = null;
      if (!ROK_ONLINE_MATCH_ACTIVE || state.gameOver) return;
      if (Number(state.activePlayer) !== Number(LOCAL_PLAYER_ID)) return;
      if (currentLocalPhaseKey() !== phaseKey || lastStartedPhaseKey === phaseKey) return;
      phaseDeliveryScheduledKey = '';
      deliverRemotePhaseIfLocal({
        force: true,
        announce: false,
        previousPhase: pendingPhaseDeliveryContext,
      });
    }, Math.max(900, Number(delayMs || 0)));
  }

  function deliverRemotePhaseIfLocal(options = {}) {
    if (!ROK_ONLINE_MATCH_ACTIVE || Number(state.activePlayer) !== Number(LOCAL_PLAYER_ID) || state.gameOver) return false;
    const phaseKey = currentLocalPhaseKey();
    if (!phaseKey || lastStartedPhaseKey === phaseKey) return true;
    if (!options.force && phaseDeliveryScheduledKey === phaseKey) return false;

    clearTimeout(schedulePhaseStartActions.timer);
    phaseDeliveryScheduledKey = phaseKey;

    const phase = currentPhase();
    const previous = options.previousPhase || pendingPhaseDeliveryContext || null;
    const shouldAnnounce = options.announce !== false && lastAnnouncedPhaseKey !== phaseKey;
    const changedPlayer = Boolean(
      previous
      && Number(previous.activePlayer)
      && Number(previous.activePlayer) !== Number(state.activePlayer)
      && phase?.id === 'extraction'
    );
    const castingToResolution = Boolean(
      previous
      && Number(previous.activePlayer) === Number(state.activePlayer)
      && String(previous.phaseId || '') === 'casting'
      && phase?.id === 'resolution'
    );

    const items = [];
    if (shouldAnnounce) {
      if (changedPlayer) {
        // Misma plantilla exacta de nextPhase() para J1 y J2.
        items.push(
          { text: 'TERMINA EL TURNO', playerId: Number(previous.activePlayer), duration: 950 },
          { text: `JUGADOR ${state.activePlayer}`, playerId: Number(state.activePlayer), duration: 900 },
          { text: 'EXTRACCIÓN', playerId: Number(state.activePlayer), duration: 900 },
        );
      } else {
        items.push({
          text: String(phase?.label || 'FASE').toUpperCase(),
          playerId: Number(state.activePlayer),
          duration: 860,
        });
      }
      lastAnnouncedPhaseKey = phaseKey;
    }

    const transitionAnchor = typeof getTransitionAnchorPoint === 'function'
      ? getTransitionAnchorPoint()
      : undefined;

    // El jugador remoto ya no tiene una secuencia abreviada propia. Usa
    // exactamente schedulePhaseIntroFlow(), igual que el jugador base.
    if (typeof schedulePhaseIntroFlow === 'function') {
      schedulePhaseIntroFlow(items, {
        allowOffTurnCasterReposition: shouldAnnounce && castingToResolution,
        transitionAnchor,
      });
    } else {
      if (items.length) queueTransitions(items, { anchor: transitionAnchor });
      schedulePhaseStartActions(items.length ? Math.max(0, sumTransitionDurations(items) - 120) : 80);
    }

    // La marca definitiva solo llega desde startPhaseActions(). El margen
    // contempla TERMINA/JUGADOR/EXTRACCIÓN y ACCIÓN DE KASTER.
    const retryDelay = Math.max(
      5200,
      sumTransitionDurations(items) + (castingToResolution ? 15000 : 0) + 3200,
    );
    schedulePhaseDeliveryRetry(phaseKey, retryDelay);
    return true;
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

  function showWaitingRoom() {
    setOnlineLobbyView('room');
    if (ui.badge) { ui.badge.setAttribute('aria-hidden', 'true'); ui.badge.classList.remove('visible'); }
  }

  function openLobby() {
    cacheUi();
    if (!hasAuthenticatedAccount()) {
      showAccountAuthOverlay(true);
      setAccountAuthStatus('Inicia sesión para entrar a Versus Online.', 'error');
      return;
    }
    if (!ui.overlay) return;
    ui.overlay.setAttribute('aria-hidden', 'false');
    ui.overlay.classList.add('visible');
    if (roomCode && roomCache) {
      renderRoomLobby(roomCache);
      return;
    }
    setOnlineLobbyView('home');
    stopAvailableRoomListeners();
    stopLobbyCountdown();
    setStatus('Crea una partida o consulta las partidas disponibles de tus amigos.', '');
  }

  function closeLobby() {
    stopAvailableRoomListeners();
    if (ui.overlay) { ui.overlay.setAttribute('aria-hidden', 'true'); ui.overlay.classList.remove('visible'); }
  }

  async function handleLobbyClose() {
    if (roomCode && !roomCache?.game?.snapshot) {
      await leaveRoom({ silent: true, keepMenu: true, returnToLobby: false });
    }
    closeLobby();
  }

  async function loadFirebase() {
    if (firebaseApiPromise) return firebaseApiPromise;
    firebaseApiPromise = (async () => {
      const [appModule, authModule, dbModule, storageModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-storage.js`),
      ]);
      const app = appModule.initializeApp(FIREBASE_CONFIG);
      auth = authModule.getAuth(app);
      try { await authModule.setPersistence(auth, authModule.browserLocalPersistence); } catch (_) {}
      uid = auth.currentUser && !auth.currentUser.isAnonymous ? String(auth.currentUser.uid || '') : '';
      db = dbModule.getDatabase(app);
      storage = storageModule.getStorage(app);
      return { ...dbModule, authModule, storageModule };
    })();
    try {
      return await firebaseApiPromise;
    } catch (error) {
      firebaseApiPromise = null;
      throw error;
    }
  }

  function hasAuthenticatedAccount() {
    return Boolean(auth?.currentUser && !auth.currentUser.isAnonymous && auth.currentUser.uid && uid);
  }

  function requireAuthenticatedAccount() {
    if (!hasAuthenticatedAccount()) {
      const error = new Error('Inicia sesión con tu cuenta de R.O.K para usar funciones online.');
      error.code = 'rok/auth-required';
      throw error;
    }
    return auth.currentUser;
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
    if (!hasAuthenticatedAccount()) { showAccountAuthOverlay(true); return; }
    setLobbyBusy(true);
    setStatus('Creando lobby…', 'working');
    try {
      const api = await loadFirebase();
      const profile = await ensureSocialProfile();
      await cleanupOwnOpenRooms(api);
      let createdCode = '';
      for (let attempt = 0; attempt < 12 && !createdCode; attempt += 1) {
        const candidate = makeRoomCode();
        const candidatePath = roomRefPath(candidate);
        const now = Date.now();
        try {
          await api.update(api.ref(db), {
            [`${candidatePath}/hostUid`]: uid,
            [`${candidatePath}/status`]: 'open',
            [`${candidatePath}/createdAt`]: now,
            [`${candidatePath}/arenaId`]: 'classic',
          });
        } catch (error) {
          if (String(error?.code || '').toLowerCase().includes('permission-denied') && attempt < 11) continue;
          throw error;
        }
        const selectedLoadout = getLocalSelectedLoadout();
        const playerRecord = {
          uid,
          slot: 1,
          connected: true,
          ready: false,
          joinedAt: now,
          lastSeenAt: now,
          displayName: profile.displayName,
          avatarId: normalizeProfileAvatarId(profile.avatarId),
          avatarUrl: profile.casterAvatarUrl || '',
          level: normalizeAccountLevel(profile.level),
        };
        if (selectedLoadout && !getLoadoutIssue(selectedLoadout)) playerRecord.loadout = selectedLoadout;
        await api.set(api.ref(db, `${candidatePath}/players/${uid}`), playerRecord);
        await api.set(api.ref(db, `${OPEN_ROOMS_ROOT}/${uid}/${candidate}`), {
          hostUid: uid,
          hostName: profile.displayName,
          avatarId: normalizeProfileAvatarId(profile.avatarId),
          avatarUrl: profile.casterAvatarUrl || '',
          level: normalizeAccountLevel(profile.level),
          arenaId: 'classic',
          createdAt: now,
        });
        createdCode = candidate;
      }
      if (!createdCode) throw new Error('No se pudo crear el lobby.');
      stopAvailableRoomListeners();
      await attachToRoom(createdCode, 1);
      showWaitingRoom();
      setStatus('Lobby creado. Tus amigos ya pueden verlo desde Unirse.', 'ok');
    } catch (error) {
      reportOnlineError(error, 'No se pudo crear la sala');
      setStatus(readableFirebaseError(error), 'error');
    } finally {
      setLobbyBusy(false);
    }
  }

  async function joinRoom(requestedCode = '') {
    const code = normalizeRoomCode(requestedCode || ui.codeInput?.value);
    if (code.length !== ROOM_CODE_LENGTH) {
      setStatus('La partida seleccionada ya no está disponible.', 'error');
      return;
    }
    setLobbyBusy(true);
    setStatus('Entrando al lobby…', 'working');
    try {
      const api = await loadFirebase();
      const targetPath = roomRefPath(code);
      const roomSnapshot = await api.get(api.ref(db, targetPath));
      const room = roomSnapshot.val();
      if (!room?.hostUid || room?.status !== 'open') throw new Error('La partida ya no está disponible.');
      const hostUid = String(room.hostUid || '');
      if (hostUid === uid) {
        await attachToRoom(code, 1);
        showWaitingRoom();
        return;
      }
      if (!(await isFriend(hostUid))) throw new Error('Solo puedes unirte a partidas creadas por tus amigos.');
      if (room.guestUid && String(room.guestUid) !== uid) throw new Error('La partida ya tiene un segundo jugador.');
      if (!room.guestUid) await api.set(api.ref(db, `${targetPath}/guestUid`), uid);
      const profile = await ensureSocialProfile();
      const now = Date.now();
      const selectedLoadout = getLocalSelectedLoadout();
      const playerRecord = {
        uid,
        slot: 2,
        connected: true,
        ready: false,
        joinedAt: Number(room.players?.[uid]?.joinedAt || now),
        lastSeenAt: now,
        displayName: profile.displayName,
        avatarId: normalizeProfileAvatarId(profile.avatarId),
        avatarUrl: profile.casterAvatarUrl || '',
        level: normalizeAccountLevel(profile.level),
      };
      if (selectedLoadout && !getLoadoutIssue(selectedLoadout)) playerRecord.loadout = selectedLoadout;
      await api.set(api.ref(db, `${targetPath}/players/${uid}`), playerRecord);
      await removeOpenRoomListing(api, code, hostUid);
      stopAvailableRoomListeners();
      await attachToRoom(code, 2);
      showWaitingRoom();
      setStatus('Entraste al lobby. Selecciona tu Spellbook y marca Listo.', 'ok');
    } catch (error) {
      reportOnlineError(error, 'No se pudo entrar a la sala');
      setStatus(readableFirebaseError(error), 'error');
      if (onlineLobbyView === 'join') void startAvailableRoomListeners().catch(() => {});
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
    lastStartedPhaseKey = '';
    phaseDeliveryScheduledKey = '';
    lastAnnouncedPhaseKey = '';
    clearPhaseDeliveryRetry();
    turnHandoffPublishPending = false;
    localStateReady = false;
    handledInteractionId = '';
    saveSession();

    const presenceRef = api.ref(db, `${roomPath}/players/${uid}`);
    try {
      presenceDisconnect = api.onDisconnect(presenceRef);
      await presenceDisconnect.update({ connected: false, lastSeenAt: Date.now() });
      await api.update(presenceRef, { uid, slot: playerSlot, connected: true, lastSeenAt: Date.now() });
    } catch (_) {}

    roomUnsubscribe = api.onValue(api.ref(db, roomPath), snapshot => {
      void handleRoomValue(snapshot.val());
    }, error => {
      reportOnlineError(error, 'Se perdió la lectura de la sala');
      setStatus(readableFirebaseError(error), 'error');
    });
    attachFxListener(api);
    startSyncLoop();
  }

  async function handleRoomValue(room) {
    if (!room || leavingRoom) {
      if (roomCode && !leavingRoom) {
        setStatus('La sala fue cerrada o eliminada.', 'error');
        await leaveRoom({ silent: true, keepMenu: true, returnToLobby: true });
      }
      return;
    }
    roomCache = room;
    const p1 = getRoomPlayerRecord(room, 1);
    const p2 = getRoomPlayerRecord(room, 2);
    if (ui.badgeText) ui.badgeText.textContent = `PVP conectado · J${playerSlot} · rev ${lastKnownRevision}`;
    applyArenaToBattle(room.arenaId);

    if (!room.game?.snapshot) {
      void configureLobbyDisconnects(room);
      showWaitingRoom();
      renderRoomLobby(room);
      if (playerSlot === 1) void reconcileLobbyAsHost(room);

      const bothConnected = Boolean(room.guestUid && p1?.connected && p2?.connected);
      const bothReady = Boolean(bothConnected && p1?.ready && p2?.ready && !getLoadoutIssue(p1?.loadout) && !getLoadoutIssue(p2?.loadout));

      if (room.status === 'countdown' && room.startAt && bothReady) {
        renderLobbyCountdown(room.startAt);
        setStatus('Ambos jugadores están listos. Iniciando duelo…', 'ok');
        if (playerSlot === 1 && !startingOnlineBattle && !lobbyStartTimer) {
          const wait = Math.max(0, Number(room.startAt) - Date.now());
          lobbyStartTimer = window.setTimeout(() => {
            lobbyStartTimer = null;
            void startFreshOnlineBattleAsHost();
          }, wait + 40);
        }
      } else {
        stopLobbyCountdown();
        if (!room.guestUid) {
          setStatus('Lobby abierto. Esperando que uno de tus amigos se una.', 'working');
        } else if (!bothConnected) {
          setStatus('El segundo jugador está en el lobby, pero todavía no terminó de conectar.', 'working');
        } else if (!p1?.loadout || !p2?.loadout) {
          setStatus('Ambos están conectados. Falta seleccionar uno o más Spellbooks.', 'working');
        } else if (!p1?.ready || !p2?.ready) {
          setStatus('Configuración lista. Ambos jugadores deben pulsar LISTO.', 'working');
        } else {
          setStatus('Preparando cuenta regresiva…', 'working');
        }
      }
      return;
    }

    stopLobbyCountdown();
    void cancelLobbyDisconnects();
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
    setStatus(`Partida activa · Jugador ${playerSlot}.`, 'ok');

    if (room.game?.interaction) await handleIncomingInteraction(room.game.interaction);
    handleIncomingPriorityAction(room.game?.priorityAction || null);
  }

  async function startFreshOnlineBattleAsHost() {
    if (startingOnlineBattle || playerSlot !== 1) return;
    const guest = String(roomCache?.guestUid || '');
    if (!guest) { setStatus('Todavía no se ha conectado el Jugador 2.', 'error'); return; }
    const hostLobbyRecord = getRoomPlayerRecord(roomCache, 1);
    const guestLobbyRecord = getRoomPlayerRecord(roomCache, 2);
    if (!hostLobbyRecord?.ready || !guestLobbyRecord?.ready || !hostLobbyRecord?.connected || !guestLobbyRecord?.connected) {
      setStatus('Ambos jugadores deben estar conectados y en LISTO.', 'error');
      return;
    }
    applyArenaToBattle(roomCache?.arenaId);
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
      const hostRecord = getRoomPlayerRecord(roomCache, 1);
      const guestRecord = getRoomPlayerRecord(roomCache, 2);
      const hostLoadout = hostRecord?.loadout;
      const guestLoadout = guestRecord?.loadout;
      const hostIssue = getLoadoutIssue(hostLoadout);
      const guestIssue = getLoadoutIssue(guestLoadout);
      if (hostIssue || guestIssue) throw new Error(hostIssue || guestIssue || 'Falta un Spellbook válido.');
      window.ROK_SPELLBOOK_MATCH?.applyLoadoutToPlayer?.(1, hostLoadout);
      window.ROK_SPELLBOOK_MATCH?.applyLoadoutToPlayer?.(2, guestLoadout);
      initializeElementDecks();
      if (typeof prepareStartingElementStocks === 'function') prepareStartingElementStocks();
      enterPhase(true, true);
      localStateReady = true;
      lastObservedPhaseKey = currentLocalPhaseKey();
      lastStartedPhaseKey = '';
      phaseDeliveryScheduledKey = '';
      lastAnnouncedPhaseKey = '';
      pendingPhaseDeliveryContext = null;
      clearPhaseDeliveryRetry();
      showBattleScreen();
      renderAll();
      await cancelLobbyDisconnects();
      await publishSnapshot({ force: true, status: 'playing' });
      try { const api = await loadFirebase(); await removeOpenRoomListing(api, roomCode, uid); } catch (_) {}
      closeLobby();
      const introTransitions = [
        { text: 'INICIA EL COMBATE', playerId: 1, duration: 1050 },
        { text: '10 ELEMENTOS INICIALES', playerId: 1, duration: 900 },
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

  function markTurnHandoffPending() {
    if (!ROK_ONLINE_MATCH_ACTIVE) return;
    turnHandoffPublishPending = true;
    void considerPublishingLocalState();
  }

  async function considerPublishingLocalState() {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomCode || !localStateReady || applyingRemoteSnapshot || publishingSnapshot || leavingRoom) return;
    const ownsTurn = Number(state.activePlayer) === Number(LOCAL_PLAYER_ID);
    // Fuera de turno solo se permite la escritura única que entrega el turno.
    // Clics o teclas ya no abren una ventana para sobrescribir el snapshot rival.
    if (!ownsTurn && !turnHandoffPublishPending) return;
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
        const nextGame = {
          revision: committedRevision,
          writerUid: uid,
          writerPlayer: playerSlot,
          phaseKey: phaseKeyFromSnapshot(nextSnapshot),
          schemaVersion: ONLINE_SNAPSHOT_SCHEMA_VERSION,
          snapshot: nextSnapshot,
          updatedAt: Date.now(),
        };
        // La interacción vive dentro de /game porque las reglas no permiten
        // hijos adicionales en la raíz de la sala. Se conserva durante cada
        // transacción de sincronización para que no desaparezca a mitad de J2.
        if (current?.interaction) nextGame.interaction = deepClone(current.interaction);
        if (current?.priorityAction) nextGame.priorityAction = deepClone(current.priorityAction);
        // Los FX online viajan como eventos efímeros separados del snapshot.
        // La transacción autoritativa no debe borrarlos mientras otro cliente
        // todavía está reproduciendo una animación.
        if (current?.fxEvents) nextGame.fxEvents = deepClone(current.fxEvents);
        return nextGame;
      }, { applyLocally: false });
      if (!result.committed) return false;
      lastKnownRevision = Math.max(lastKnownRevision, committedRevision);
      lastSnapshotText = nextText;
      lastObservedPhaseKey = phaseKeyFromSnapshot(nextSnapshot) || lastObservedPhaseKey;
      if (turnHandoffPublishPending && Number(nextSnapshot.activePlayer) !== Number(LOCAL_PLAYER_ID)) {
        turnHandoffPublishPending = false;
      }
      if (options.status) {
        if (playerSlot === 1 && ['waiting', 'ready', 'playing', 'finished'].includes(options.status)) {
          await api.set(api.ref(db, `${roomPath}/status`), options.status);
        }
      }
      return true;
    } catch (error) {
      reportOnlineError(error, 'Error al guardar el estado PvP');
      return false;
    } finally {
      publishingSnapshot = false;
    }
  }


  function trimHandledFxEvents() {
    if (handledFxEventIds.size <= 160) return;
    const keep = Array.from(handledFxEventIds).slice(-80);
    handledFxEventIds.clear();
    keep.forEach(id => handledFxEventIds.add(id));
  }

  async function emitVisualEvent(type, payload = {}) {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot || !localStateReady || applyingRemoteSnapshot || leavingRoom) return false;
    const safeType = String(type || '').trim();
    if (!safeType) return false;
    try {
      const api = await loadFirebase();
      const eventRef = api.push(api.ref(db, `${roomPath}/game/fxEvents`));
      const id = String(eventRef.key || `fx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      const event = {
        id,
        type: safeType,
        authorUid: uid,
        authorPlayer: playerSlot,
        createdAt: Date.now(),
        phaseKey: currentLocalPhaseKey(),
        payload: deepClone(payload || {}),
      };
      handledFxEventIds.add(id);
      trimHandledFxEvents();
      await api.set(eventRef, event);
      // Los eventos solo sirven para reproducir el instante visual. Mantenerlos
      // unos segundos permite absorber latencia/reconexiones sin convertirlos
      // en parte persistente del estado de batalla.
      const eventRoomPath = roomPath;
      window.setTimeout(() => {
        if (!eventRoomPath) return;
        void loadFirebase().then(apiNow => apiNow.remove(apiNow.ref(db, `${eventRoomPath}/game/fxEvents/${id}`))).catch(() => {});
      }, 18000);
      return true;
    } catch (error) {
      reportOnlineError(error, `No se pudo sincronizar FX ${safeType}`);
      return false;
    }
  }

  function handleIncomingVisualEvent(rawEvent, key = '') {
    if (!rawEvent || typeof rawEvent !== 'object') return;
    const id = String(rawEvent.id || key || '');
    if (!id || handledFxEventIds.has(id)) return;
    const authorUid = String(rawEvent.authorUid || '');
    const createdAt = Number(rawEvent.createdAt || 0);
    handledFxEventIds.add(id);
    trimHandledFxEvents();
    if (authorUid && authorUid === uid) return;
    // onChildAdded entrega también el historial al conectar. Solo se reproducen
    // eventos nacidos alrededor de esta sesión activa para no repetir ataques
    // viejos después de recargar la página.
    if (fxListenerStartedAt && createdAt && createdAt < fxListenerStartedAt - 1800) return;
    try {
      const player = window.ROK_ONLINE_FX?.play;
      if (typeof player === 'function') {
        Promise.resolve(player({ ...deepClone(rawEvent), id })).catch(error => reportOnlineError(error, `Error reproduciendo FX ${rawEvent.type || ''}`));
      }
    } catch (error) {
      reportOnlineError(error, `Error reproduciendo FX ${rawEvent.type || ''}`);
    }
  }

  function attachFxListener(api) {
    if (fxUnsubscribe) {
      try { fxUnsubscribe(); } catch (_) {}
      fxUnsubscribe = null;
    }
    handledFxEventIds.clear();
    fxListenerStartedAt = Date.now();
    fxUnsubscribe = api.onChildAdded(api.ref(db, `${roomPath}/game/fxEvents`), snapshot => {
      handleIncomingVisualEvent(snapshot.val(), snapshot.key || '');
    }, error => reportOnlineError(error, 'Se perdió el canal de efectos visuales'));
  }


  function handleIncomingPriorityAction(priorityAction) {
    const active = Boolean(priorityAction && priorityAction.status === 'active');
    const ownerPlayer = Number(priorityAction?.ownerPlayer || 0);
    if (active && ownerPlayer && ownerPlayer !== Number(LOCAL_PLAYER_ID)) {
      window.ROK_PRIORITY_ACTION?.activateRemote?.(priorityAction);
      return true;
    }
    window.ROK_PRIORITY_ACTION?.clearRemote?.(priorityAction?.id || '');
    return false;
  }

  async function setPriorityAction(payload = {}) {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot) return false;
    const id = String(payload.id || `priority_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const priorityAction = {
      id,
      type: String(payload.type || 'priority-action'),
      label: String(payload.label || 'acción prioritaria'),
      status: 'active',
      ownerUid: uid,
      ownerPlayer: Number(payload.ownerPlayer || playerSlot),
      unitId: payload.unitId || null,
      startedAt: Number(payload.startedAt || Date.now()),
      updatedAt: Date.now(),
    };
    try {
      const api = await loadFirebase();
      await api.set(api.ref(db, `${roomPath}/game/priorityAction`), priorityAction);
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo iniciar la acción prioritaria');
      return false;
    }
  }

  async function clearPriorityAction(priorityId = '', result = 'closed') {
    if (!roomPath || !playerSlot) return false;
    try {
      const api = await loadFirebase();
      const ref = api.ref(db, `${roomPath}/game/priorityAction`);
      const outcome = await api.runTransaction(ref, current => {
        if (!current) return null;
        if (String(current.ownerUid || '') !== String(uid)) return;
        if (priorityId && current.id && String(current.id) !== String(priorityId)) return;
        return null;
      }, { applyLocally: false });
      return Boolean(outcome.committed);
    } catch (error) {
      reportOnlineError(error, `No se pudo cerrar la acción prioritaria (${result})`);
      return false;
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
    const interactionRef = api.ref(db, `${roomPath}/game/interaction`);
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

  function applyRemoteActionWindowState(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.players) return false;
    const localHudMode = state.hudMode;
    const localSemiAutoMovement = state.semiAutoMovement;
    const localActiveTab = state.activeTab;
    applyingRemoteSnapshot = true;
    try {
      SNAPSHOT_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
          state[key] = deepClone(snapshot[key]);
          return;
        }
        const fallback = snapshotDefaultValue(key);
        if (fallback !== undefined) state[key] = deepClone(fallback);
      });
      if (typeof ensureRuntimeStateCollections === 'function') ensureRuntimeStateCollections(state);
      state.hudMode = localHudMode;
      state.semiAutoMovement = localSemiAutoMovement;
      state.activeTab = localActiveTab;

      // IMPORTANTE · PvP: esta función se ejecuta mientras el navegador que
      // conduce la transición está ESPERANDO una ventana de acción del rival.
      // El snapshot devuelto solo contiene estado autoritativo (SNAPSHOT_KEYS);
      // selectedMover, quickReactionWindow, offTurnCasterReposition, locks y
      // resolvers son estado transitorio LOCAL y deben sobrevivir.
      //
      // Antes se llamaba resetTransientStateAfterRemoteApply() aquí. Ese reset
      // incrementaba quickReactionWindow.phaseFlowId y cancelaba inmediatamente
      // schedulePhaseIntroFlow() al volver de la ventana remota. El resultado era:
      // - no aparecía la ACCIÓN DE KASTER rival,
      // - Resolución no alcanzaba startPhaseActions()/prepareResolutionMoves(),
      // - las unidades quedaban con movesLeft=0,
      // - el siguiente relevo de turno podía quedar detenido en la transición.
      //
      // No limpiar nada transitorio en una RESPUESTA de action-window. Si un
      // snapshot normal cambia de fase, applyBattleSnapshot() ya entrega la nueva
      // fase mediante su flujo específico.
      ROK_ONLINE_MATCH_ACTIVE = true;
      LOCAL_PLAYER_ID = playerSlot;
      localStateReady = true;
      lastSnapshotText = snapshotText(makeBattleSnapshot());
      try { renderAll(); } catch (_) {}
      return true;
    } finally {
      applyingRemoteSnapshot = false;
    }
  }

  async function requestRemoteActionWindow(targetPlayer, kind, payload = {}) {
    const targetId = Number(targetPlayer || 0);
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot || !targetId || targetId === Number(LOCAL_PLAYER_ID)) {
      return { result: 'none', applied: false };
    }
    const safeKind = String(kind || '').trim();
    if (!safeKind) return { result: 'none', applied: false };
    const api = await loadFirebase();
    // El dueño de la acción congela primero el estado autoritativo. El rival
    // resuelve su ventana sobre esa misma fotografía y devuelve el resultado.
    await publishSnapshot({ force: true });
    const interactionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const interactionRef = api.ref(db, `${roomPath}/game/interaction`);
    const interaction = {
      id: interactionId,
      type: 'action-window',
      kind: safeKind,
      status: 'pending',
      requesterUid: uid,
      requesterPlayer: playerSlot,
      targetPlayer: targetId,
      createdAt: Date.now(),
      payload: deepClone(payload || {}),
    };
    await api.set(interactionRef, interaction);

    return await new Promise(resolve => {
      let settled = false;
      let unsubscribe = null;
      let timeoutId = null;
      const finish = async response => {
        if (settled) return;
        settled = true;
        if (unsubscribe) unsubscribe();
        if (timeoutId) window.clearTimeout(timeoutId);
        let applied = false;
        const returnedSnapshot = response?.snapshot;
        if (returnedSnapshot && typeof returnedSnapshot === 'object') {
          applied = applyRemoteActionWindowState(returnedSnapshot);
          if (applied) await publishSnapshot({ force: true });
        }
        try { await api.remove(interactionRef); } catch (_) {}
        resolve({ result: String(response?.result || 'skipped'), applied });
      };
      unsubscribe = api.onValue(interactionRef, snapshot => {
        const value = snapshot.val();
        if (!value || value.id !== interactionId || value.status !== 'resolved') return;
        void finish(value.response || { result: 'skipped' });
      }, () => { void finish({ result: 'error' }); });
      timeoutId = window.setTimeout(() => { void finish({ result: 'timeout' }); }, REMOTE_ACTION_WINDOW_TIMEOUT_MS);
    });
  }

  async function handleIncomingInteraction(interaction) {
    if (!interaction || interaction.status !== 'pending') return;
    if (Number(interaction.targetPlayer) !== Number(LOCAL_PLAYER_ID)) return;
    if (interaction.id === handledInteractionId) return;
    handledInteractionId = interaction.id;

    if (interaction.type === 'action-window') {
      try {
        const runner = window.ROK_ONLINE_ACTION_WINDOW?.run;
        const result = typeof runner === 'function'
          ? await runner(String(interaction.kind || ''), deepClone(interaction.payload || {}))
          : 'unsupported';
        const responseSnapshot = makeBattleSnapshot();
        const api = await loadFirebase();
        await api.runTransaction(api.ref(db, `${roomPath}/game/interaction`), current => {
          if (!current || current.id !== interaction.id || current.status !== 'pending') return;
          return {
            ...current,
            status: 'resolved',
            response: {
              result: typeof result === 'string' ? result : String(result?.result || 'completed'),
              snapshot: responseSnapshot,
              uid,
              player: playerSlot,
              resolvedAt: Date.now(),
            },
          };
        }, { applyLocally: false });
      } catch (error) {
        reportOnlineError(error, `Error en ventana remota ${interaction.kind || ''}`);
        try {
          const api = await loadFirebase();
          await api.update(api.ref(db, `${roomPath}/game/interaction`), {
            status: 'resolved',
            response: { result: 'error', snapshot: makeBattleSnapshot(), uid, player: playerSlot, resolvedAt: Date.now(), fallback: true },
          });
        } catch (_) {}
      }
      return;
    }

    if (interaction.type !== 'caster-defense') return;
    try {
      const payload = interaction.payload || {};
      const source = reconstructInteractionSource(payload.source || {});
      const choice = await showCasterDefenseMenu(LOCAL_PLAYER_ID, source, Number(payload.amount || 0), {
        isDistanceAttack: Boolean(payload.isDistanceAttack),
        allowCounter: payload.allowCounter !== false,
        isDirectAttack: Boolean(payload.isDirectAttack),
      });
      const api = await loadFirebase();
      await api.runTransaction(api.ref(db, `${roomPath}/game/interaction`), current => {
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
        await api.update(api.ref(db, `${roomPath}/game/interaction`), {
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
    if (fxUnsubscribe) {
      try { fxUnsubscribe(); } catch (_) {}
      fxUnsubscribe = null;
    }
    fxListenerStartedAt = 0;
    handledFxEventIds.clear();
    if (presenceDisconnect) {
      try { await presenceDisconnect.cancel(); } catch (_) {}
      presenceDisconnect = null;
    }
    await cancelLobbyDisconnects();
    stopSyncLoop();
  }

  async function leaveRoom(options = {}) {
    if (leavingRoom) return;
    leavingRoom = true;
    const oldRoomPath = roomPath;
    const oldRoomCode = roomCode;
    const oldSlot = playerSlot;
    const oldRoom = roomCache;
    const wasPlaying = Boolean(oldRoom?.game?.snapshot || oldRoom?.status === 'playing');
    try {
      if (oldRoomPath && oldSlot) {
        try { await clearPriorityAction('', 'leave-room'); } catch (_) {}
      }
      await detachRoomListener();
      stopLobbyCountdown();
      stopAvailableRoomListeners();
      if (oldRoomPath && oldSlot && db && firebaseApiPromise) {
        try {
          const api = await firebaseApiPromise;
          if (!wasPlaying && oldSlot === 1) {
            await removeOpenRoomListing(api, oldRoomCode, uid);
            await api.remove(api.ref(db, oldRoomPath));
          } else if (!wasPlaying && oldSlot === 2) {
            await api.remove(api.ref(db, `${oldRoomPath}/players/${uid}`));
            await api.remove(api.ref(db, `${oldRoomPath}/guestUid`));
          } else {
            await api.update(api.ref(db, `${oldRoomPath}/players/${uid}`), { connected: false, lastSeenAt: Date.now() });
          }
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
      lastStartedPhaseKey = '';
      phaseDeliveryScheduledKey = '';
      lastAnnouncedPhaseKey = '';
      pendingPhaseDeliveryContext = null;
      clearPhaseDeliveryRetry();
      turnHandoffPublishPending = false;
      localStateReady = false;
      handledInteractionId = '';
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
    }
    if (options.returnToLobby) {
      openLobby();
      setStatus(options.silent ? 'La sala ya no está disponible.' : 'Saliste del lobby.', '');
    } else if (!options.keepMenu && !options.silent) {
      openLobby();
      setStatus('Saliste de la sala online.', '');
    }
  }

  function cacheAccountUi() {
    accountUi.overlay = document.getElementById('accountAuthOverlay');
    accountUi.loginTab = document.getElementById('accountLoginTabBtn');
    accountUi.registerTab = document.getElementById('accountRegisterTabBtn');
    accountUi.loginForm = document.getElementById('accountLoginForm');
    accountUi.loginEmail = document.getElementById('accountLoginEmail');
    accountUi.loginPassword = document.getElementById('accountLoginPassword');
    accountUi.loginSubmit = document.getElementById('accountLoginSubmitBtn');
    accountUi.resetPassword = document.getElementById('accountPasswordResetBtn');
    accountUi.registerForm = document.getElementById('accountRegisterForm');
    accountUi.registerName = document.getElementById('accountRegisterName');
    accountUi.registerEmail = document.getElementById('accountRegisterEmail');
    accountUi.registerPassword = document.getElementById('accountRegisterPassword');
    accountUi.registerPasswordConfirm = document.getElementById('accountRegisterPasswordConfirm');
    accountUi.registerSubmit = document.getElementById('accountRegisterSubmitBtn');
    accountUi.status = document.getElementById('accountAuthStatus');
    accountUi.logout = document.getElementById('mainMenuLogoutBtn');
    accountUi.menuName = document.getElementById('mainMenuAccountName');
    accountUi.menuEmail = document.getElementById('mainMenuAccountEmail');
    accountUi.hudName = document.getElementById('mainMenuProfileName');
    accountUi.hudAvatar = document.getElementById('mainMenuProfileAvatar');
    accountUi.hudLevel = document.getElementById('mainMenuProfileLevel');
    accountUi.hudXp = document.getElementById('mainMenuProfileXp');
    accountUi.menuAvatar = document.getElementById('mainMenuMenuAvatar');
    accountUi.menuLevel = document.getElementById('mainMenuMenuLevel');
    accountUi.menuXpFill = document.getElementById('mainMenuMenuXpFill');
    accountUi.menuXpText = document.getElementById('mainMenuMenuXpText');
  }

  function setAccountAuthStatus(message, kind = '') {
    if (!accountUi.status) cacheAccountUi();
    if (!accountUi.status) return;
    accountUi.status.textContent = String(message || '');
    accountUi.status.classList.remove('ok', 'error', 'working');
    if (kind) accountUi.status.classList.add(kind);
  }

  function setAccountAuthBusy(busy) {
    const disabled = Boolean(busy);
    [accountUi.loginSubmit, accountUi.resetPassword, accountUi.registerSubmit,
      accountUi.loginTab, accountUi.registerTab].forEach(node => { if (node) node.disabled = disabled; });
    [accountUi.loginEmail, accountUi.loginPassword, accountUi.registerName,
      accountUi.registerEmail, accountUi.registerPassword, accountUi.registerPasswordConfirm]
      .forEach(node => { if (node) node.disabled = disabled; });
  }

  function showAccountAuthOverlay(show = true) {
    if (!accountUi.overlay) cacheAccountUi();
    const visible = Boolean(show);
    accountUi.overlay?.classList.toggle('visible', visible);
    accountUi.overlay?.setAttribute('aria-hidden', visible ? 'false' : 'true');
    document.body.classList.toggle('rok-account-locked', visible);
  }

  function setAccountAuthMode(mode = 'login') {
    cacheAccountUi();
    const register = mode === 'register';
    accountUi.loginTab?.classList.toggle('active', !register);
    accountUi.registerTab?.classList.toggle('active', register);
    accountUi.loginTab?.setAttribute('aria-selected', register ? 'false' : 'true');
    accountUi.registerTab?.setAttribute('aria-selected', register ? 'true' : 'false');
    if (accountUi.loginForm) {
      accountUi.loginForm.hidden = register;
      accountUi.loginForm.classList.toggle('active', !register);
    }
    if (accountUi.registerForm) {
      accountUi.registerForm.hidden = !register;
      accountUi.registerForm.classList.toggle('active', register);
    }
    setAccountAuthStatus(register ? 'Crea una cuenta para obtener una identidad permanente.' : 'Inicia sesión con tu cuenta de R.O.K.', '');
    setTimeout(() => (register ? accountUi.registerName : accountUi.loginEmail)?.focus(), 30);
  }

  function updateAccountIdentityUi(user = auth?.currentUser, profile = socialProfileCache) {
    cacheAccountUi();
    if (!user || user.isAnonymous) {
      if (accountUi.menuName) accountUi.menuName.textContent = 'Cuenta';
      if (accountUi.menuEmail) accountUi.menuEmail.textContent = 'Sesión no iniciada';
      if (accountUi.hudName) accountUi.hudName.textContent = 'Kaster';
      if (accountUi.hudLevel) accountUi.hudLevel.textContent = 'Nivel 1';
      if (accountUi.hudXp) accountUi.hudXp.textContent = '0 / 100 XP';
      const avatar = getProfileAvatar(DEFAULT_PROFILE_AVATAR_ID);
      if (accountUi.hudAvatar) accountUi.hudAvatar.src = avatar.src;
      if (accountUi.menuAvatar) accountUi.menuAvatar.src = avatar.src;
      if (accountUi.menuLevel) accountUi.menuLevel.textContent = 'Nivel 1';
      if (accountUi.menuXpFill) accountUi.menuXpFill.style.width = '0%';
      if (accountUi.menuXpText) accountUi.menuXpText.textContent = '0 / 100 XP';
      return;
    }
    const name = normalizeSocialDisplayName(profile?.displayName) || normalizeSocialDisplayName(user.displayName) || 'Kaster';
    const level = normalizeAccountLevel(profile?.level);
    const xp = normalizeAccountXp(profile?.xp);
    const required = getXpRequirement(level);
    const progress = Math.max(0, Math.min(100, (xp / required) * 100));
    const avatar = getProfileAvatar(profile?.avatarId, profile);
    if (accountUi.menuName) accountUi.menuName.textContent = name;
    if (accountUi.menuEmail) accountUi.menuEmail.textContent = String(user.email || 'Cuenta de Firebase');
    if (accountUi.hudName) accountUi.hudName.textContent = name;
    if (accountUi.hudAvatar) accountUi.hudAvatar.src = avatar.src;
    if (accountUi.hudAvatar) accountUi.hudAvatar.alt = `Avatar de ${name}`;
    if (accountUi.hudLevel) accountUi.hudLevel.textContent = `Nivel ${level}`;
    if (accountUi.hudXp) accountUi.hudXp.textContent = `${xp} / ${required} XP`;
    if (accountUi.menuAvatar) accountUi.menuAvatar.src = avatar.src;
    if (accountUi.menuLevel) accountUi.menuLevel.textContent = `Nivel ${level}`;
    if (accountUi.menuXpFill) accountUi.menuXpFill.style.width = `${progress}%`;
    if (accountUi.menuXpText) accountUi.menuXpText.textContent = `${xp} / ${required} XP`;
  }

  function readableAccountAuthError(error) {
    const code = String(error?.code || '');
    if (code.includes('auth/email-already-in-use')) return 'Ese correo electrónico ya tiene una cuenta.';
    if (code.includes('auth/invalid-email')) return 'El correo electrónico no es válido.';
    if (code.includes('auth/weak-password')) return 'La contraseña es demasiado débil. Usa al menos 6 caracteres.';
    if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password') || code.includes('auth/user-not-found')) return 'Correo o contraseña incorrectos.';
    if (code.includes('auth/too-many-requests')) return 'Demasiados intentos. Espera un momento y vuelve a intentarlo.';
    if (code.includes('auth/network-request-failed')) return 'No se pudo conectar con Firebase. Revisa Internet.';
    if (code.includes('auth/operation-not-allowed')) return 'Activa Email/Password en Firebase Authentication para usar cuentas.';
    if (code === 'rok/auth-required') return error.message;
    return error?.message || 'No se pudo completar la operación de cuenta.';
  }

  async function registerAccount(event) {
    event?.preventDefault?.();
    cacheAccountUi();
    const displayName = normalizeSocialDisplayName(accountUi.registerName?.value);
    const email = String(accountUi.registerEmail?.value || '').trim().toLowerCase();
    const password = String(accountUi.registerPassword?.value || '');
    const confirmation = String(accountUi.registerPasswordConfirm?.value || '');
    if (displayName.length < 2) { setAccountAuthStatus('El nombre visible debe tener al menos 2 caracteres.', 'error'); return false; }
    if (!email) { setAccountAuthStatus('Escribe tu correo electrónico.', 'error'); return false; }
    if (password.length < 6) { setAccountAuthStatus('La contraseña debe tener al menos 6 caracteres.', 'error'); return false; }
    if (password !== confirmation) { setAccountAuthStatus('Las contraseñas no coinciden.', 'error'); return false; }
    setAccountAuthBusy(true);
    setAccountAuthStatus('Creando cuenta…', 'working');
    try {
      const api = await loadFirebase();
      const credential = await api.authModule.createUserWithEmailAndPassword(auth, email, password);
      await api.authModule.updateProfile(credential.user, { displayName });
      uid = String(credential.user.uid || '');
      socialProfileCache = null;
      const profile = await ensureSocialProfile();
      updateAccountIdentityUi(credential.user, profile);
      setAccountAuthStatus(`Cuenta creada. Bienvenido, ${displayName}.`, 'ok');
      showAccountAuthOverlay(false);
      return true;
    } catch (error) {
      setAccountAuthStatus(readableAccountAuthError(error), 'error');
      return false;
    } finally {
      setAccountAuthBusy(false);
    }
  }

  async function loginAccount(event) {
    event?.preventDefault?.();
    cacheAccountUi();
    const email = String(accountUi.loginEmail?.value || '').trim().toLowerCase();
    const password = String(accountUi.loginPassword?.value || '');
    if (!email || !password) { setAccountAuthStatus('Escribe tu correo y contraseña.', 'error'); return false; }
    setAccountAuthBusy(true);
    setAccountAuthStatus('Iniciando sesión…', 'working');
    try {
      const api = await loadFirebase();
      const credential = await api.authModule.signInWithEmailAndPassword(auth, email, password);
      uid = String(credential.user.uid || '');
      socialProfileCache = null;
      const profile = await ensureSocialProfile();
      updateAccountIdentityUi(credential.user, profile);
      setAccountAuthStatus('Sesión iniciada.', 'ok');
      showAccountAuthOverlay(false);
      return true;
    } catch (error) {
      setAccountAuthStatus(readableAccountAuthError(error), 'error');
      return false;
    } finally {
      setAccountAuthBusy(false);
    }
  }

  async function resetAccountPassword() {
    cacheAccountUi();
    const email = String(accountUi.loginEmail?.value || '').trim().toLowerCase();
    if (!email) { setAccountAuthStatus('Escribe primero el correo de la cuenta que quieres recuperar.', 'error'); return false; }
    setAccountAuthBusy(true);
    setAccountAuthStatus('Enviando correo de recuperación…', 'working');
    try {
      const api = await loadFirebase();
      await api.authModule.sendPasswordResetEmail(auth, email);
      setAccountAuthStatus('Firebase envió el correo para restablecer la contraseña.', 'ok');
      return true;
    } catch (error) {
      setAccountAuthStatus(readableAccountAuthError(error), 'error');
      return false;
    } finally {
      setAccountAuthBusy(false);
    }
  }

  async function logoutAccount() {
    cacheAccountUi();
    try {
      const api = await loadFirebase();
      if (roomCode) await leaveRoom({ silent: true, keepMenu: true });
      stopSocialListeners();
      closeFriendsPanel();
      closeLobby();
      socialProfileCache = null;
      await api.authModule.signOut(auth);
      uid = '';
      updateAccountIdentityUi(null);
      setAccountAuthMode('login');
      setAccountAuthStatus('Sesión cerrada.', 'ok');
      showAccountAuthOverlay(true);
      return true;
    } catch (error) {
      setAccountAuthStatus(readableAccountAuthError(error), 'error');
      showAccountAuthOverlay(true);
      return false;
    }
  }

  async function initializeAccountAuthentication() {
    cacheAccountUi();
    showAccountAuthOverlay(true);
    setAccountAuthStatus('Comprobando sesión…', 'working');
    try {
      const api = await loadFirebase();
      if (accountAuthUnsubscribe) { try { accountAuthUnsubscribe(); } catch (_) {} }
      accountAuthUnsubscribe = api.authModule.onAuthStateChanged(auth, async user => {
        if (user?.isAnonymous) {
          uid = '';
          socialProfileCache = null;
          try { await api.authModule.signOut(auth); } catch (_) {}
          showAccountAuthOverlay(true);
          setAccountAuthStatus('La versión actual requiere una cuenta registrada. Inicia sesión o crea una cuenta.', '');
          return;
        }
        if (!user) {
          uid = '';
          socialProfileCache = null;
          accountAuthReady = true;
          updateAccountIdentityUi(null);
          showAccountAuthOverlay(true);
          setAccountAuthMode('login');
          return;
        }
        uid = String(user.uid || '');
        accountAuthReady = true;
        socialProfileCache = null;
        updateAccountIdentityUi(user);
        try { const profile = await ensureSocialProfile(); updateAccountIdentityUi(user, profile); } catch (error) { reportOnlineError(error, 'perfil social de cuenta'); }
        showAccountAuthOverlay(false);
      });
    } catch (error) {
      accountAuthReady = true;
      showAccountAuthOverlay(true);
      setAccountAuthStatus(readableAccountAuthError(error), 'error');
    }
  }

  function bindAccountUi() {
    cacheAccountUi();
    accountUi.loginTab?.addEventListener('click', () => setAccountAuthMode('login'));
    accountUi.registerTab?.addEventListener('click', () => setAccountAuthMode('register'));
    accountUi.loginForm?.addEventListener('submit', event => { void loginAccount(event); });
    accountUi.registerForm?.addEventListener('submit', event => { void registerAccount(event); });
    accountUi.resetPassword?.addEventListener('click', () => { void resetAccountPassword(); });
    accountUi.logout?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void logoutAccount(); });
  }

  function readableFirebaseError(error) {
    const code = String(error?.code || '');
    if (code.includes('auth/operation-not-allowed')) return 'Activa el proveedor Email/Password en Firebase Authentication.';
    if (code.includes('permission-denied') || code.includes('PERMISSION_DENIED')) return 'Firebase bloqueó la operación. Revisa las Realtime Database Security Rules.';
    if (code.includes('storage/unauthorized') || code.includes('storage/unauthenticated')) return 'Firebase Storage bloqueó la foto. Revisa las Storage Security Rules y tu sesión.';
    if (code.includes('network-request-failed') || code.includes('storage/retry-limit-exceeded')) return 'No se pudo conectar con Firebase. Revisa Internet y vuelve a intentar.';
    return error?.message || 'Ocurrió un error al conectar la partida online.';
  }

  function reportOnlineError(error, label) {
    try { reportGameException(error, `PvP online · ${label}`); }
    catch (_) { try { console.error(`[ROK PvP] ${label}`, error); } catch (_) {} }
  }

  function cacheProfileUi() {
    profileUi.overlay = document.getElementById('profileCenterOverlay');
    profileUi.closeBtn = document.getElementById('profileCenterCloseBtn');
    profileUi.avatar = document.getElementById('profileCenterAvatar');
    profileUi.title = document.getElementById('profileCenterTitle');
    profileUi.level = document.getElementById('profileCenterLevel');
    profileUi.friendCode = document.getElementById('profileCenterFriendCode');
    profileUi.xpFill = document.getElementById('profileCenterXpFill');
    profileUi.xpText = document.getElementById('profileCenterXpText');
    profileUi.tabs = Array.from(document.querySelectorAll('[data-profile-tab]'));
    profileUi.panels = Array.from(document.querySelectorAll('[data-profile-panel]'));
    profileUi.avatarGrid = document.getElementById('profileAvatarGrid');
    profileUi.casterAvatarSourceInput = document.getElementById('casterAvatarSourceInput');
    profileUi.casterAvatarSourcePreview = document.getElementById('casterAvatarSourcePreview');
    profileUi.casterAvatarSourceEmpty = document.getElementById('casterAvatarSourceEmpty');
    profileUi.casterAvatarResultPreview = document.getElementById('casterAvatarResultPreview');
    profileUi.casterAvatarResultBadge = document.getElementById('casterAvatarResultBadge');
    profileUi.casterAvatarConsent = document.getElementById('casterAvatarConsent');
    profileUi.casterAvatarRequestBtn = document.getElementById('casterAvatarRequestBtn');
    profileUi.casterAvatarUseResultBtn = document.getElementById('casterAvatarUseResultBtn');
    profileUi.casterAvatarJobStatus = document.getElementById('casterAvatarJobStatus');
    profileUi.achievementsGrid = document.getElementById('profileAchievementsGrid');
    profileUi.achievementsCount = document.getElementById('profileAchievementsCount');
    profileUi.summarySpellbooks = document.getElementById('profileSummarySpellbooks');
    profileUi.summaryCollection = document.getElementById('profileSummaryCollection');
    profileUi.summaryFriends = document.getElementById('profileSummaryFriends');
    profileUi.summaryCrystal = document.getElementById('profileSummaryCrystal');
    profileUi.accountNameInput = document.getElementById('profileAccountNameInput');
    profileUi.accountSaveNameBtn = document.getElementById('profileAccountSaveNameBtn');
    profileUi.accountEmail = document.getElementById('profileAccountEmail');
    profileUi.accountFriendCode = document.getElementById('profileAccountFriendCode');
    profileUi.accountCopyCodeBtn = document.getElementById('profileAccountCopyCodeBtn');
    profileUi.accountFriendsBtn = document.getElementById('profileAccountFriendsBtn');
    profileUi.accountPasswordBtn = document.getElementById('profileAccountPasswordBtn');
    profileUi.accountLogoutBtn = document.getElementById('profileAccountLogoutBtn');
    profileUi.status = document.getElementById('profileCenterStatus');
    profileUi.menuProfileBtn = document.getElementById('mainMenuProfileBtn');
    profileUi.menuAvatarBtn = document.getElementById('mainMenuAvatarBtn');
    profileUi.menuAchievementsBtn = document.getElementById('mainMenuAchievementsBtn');
    profileUi.menuAccountBtn = document.getElementById('mainMenuAccountBtn');
  }

  function setProfileCenterStatus(message = '', kind = '') {
    if (!profileUi.status) return;
    profileUi.status.textContent = String(message || '');
    profileUi.status.classList.remove('ok', 'error', 'working');
    if (kind) profileUi.status.classList.add(kind);
  }

  function setCasterAvatarJobStatus(message = '', kind = '') {
    cacheProfileUi();
    if (!profileUi.casterAvatarJobStatus) return;
    profileUi.casterAvatarJobStatus.textContent = String(message || '');
    profileUi.casterAvatarJobStatus.classList.remove('ok', 'error', 'working');
    if (kind) profileUi.casterAvatarJobStatus.classList.add(kind);
  }

  function refreshCasterAvatarRequestButton() {
    cacheProfileUi();
    const consent = Boolean(profileUi.casterAvatarConsent?.checked);
    const validFile = Boolean(casterAvatarSourceFile);
    if (profileUi.casterAvatarRequestBtn) profileUi.casterAvatarRequestBtn.disabled = !(consent && validFile);
  }

  function clearCasterAvatarSourceObjectUrl() {
    if (casterAvatarSourceObjectUrl) {
      try { URL.revokeObjectURL(casterAvatarSourceObjectUrl); } catch (_) {}
      casterAvatarSourceObjectUrl = '';
    }
  }

  function clearCasterAvatarSourceSelection() {
    casterAvatarSourceFile = null;
    clearCasterAvatarSourceObjectUrl();
    if (profileUi.casterAvatarSourceInput) profileUi.casterAvatarSourceInput.value = '';
    if (profileUi.casterAvatarSourcePreview) {
      profileUi.casterAvatarSourcePreview.hidden = true;
      profileUi.casterAvatarSourcePreview.removeAttribute('src');
    }
    if (profileUi.casterAvatarSourceEmpty) profileUi.casterAvatarSourceEmpty.hidden = false;
    refreshCasterAvatarRequestButton();
  }

  function handleCasterAvatarSourceSelected(fileList) {
    cacheProfileUi();
    const file = fileList?.[0] || null;
    clearCasterAvatarSourceSelection();
    if (!file) {
      setCasterAvatarJobStatus('Sube una foto para comenzar.', '');
      return false;
    }
    const type = String(file.type || '').toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
      setCasterAvatarJobStatus('Usa una imagen PNG, JPG o WEBP.', 'error');
      return false;
    }
    if (Number(file.size || 0) > MAX_CASTER_AVATAR_SOURCE_BYTES) {
      setCasterAvatarJobStatus('La imagen supera el máximo de 10 MB.', 'error');
      return false;
    }
    casterAvatarSourceFile = file;
    casterAvatarSourceObjectUrl = URL.createObjectURL(file);
    if (profileUi.casterAvatarSourcePreview) {
      profileUi.casterAvatarSourcePreview.src = casterAvatarSourceObjectUrl;
      profileUi.casterAvatarSourcePreview.hidden = false;
    }
    if (profileUi.casterAvatarSourceEmpty) profileUi.casterAvatarSourceEmpty.hidden = true;
    setCasterAvatarJobStatus('Foto preparada. Confirma la autorización y solicita la creación.', '');
    refreshCasterAvatarRequestButton();
    return true;
  }

  function stopCasterAvatarJobListener() {
    if (casterAvatarJobUnsubscribe) {
      try { casterAvatarJobUnsubscribe(); } catch (_) {}
      casterAvatarJobUnsubscribe = null;
    }
  }

  function renderCasterAvatarJob(job = null) {
    cacheProfileUi();
    const status = String(job?.status || '');
    const resultUrl = String(job?.resultUrl || '');
    casterAvatarCurrentResultUrl = resultUrl;
    if (profileUi.casterAvatarResultPreview) {
      if (resultUrl) {
        profileUi.casterAvatarResultPreview.src = resultUrl;
        profileUi.casterAvatarResultPreview.hidden = false;
      } else {
        profileUi.casterAvatarResultPreview.hidden = true;
        profileUi.casterAvatarResultPreview.removeAttribute('src');
      }
    }
    if (profileUi.casterAvatarResultBadge) profileUi.casterAvatarResultBadge.hidden = !resultUrl;
    if (profileUi.casterAvatarUseResultBtn) profileUi.casterAvatarUseResultBtn.hidden = !(status === 'completed' && resultUrl);
    if (!job) {
      setCasterAvatarJobStatus('Sube una foto para comenzar.', '');
      return;
    }
    if (status === 'queued') setCasterAvatarJobStatus('Solicitud enviada. Está esperando turno para generar el avatar.', 'working');
    else if (status === 'processing') setCasterAvatarJobStatus('Generando tu Kaster. Puedes cerrar esta ventana y volver después.', 'working');
    else if (status === 'completed') setCasterAvatarJobStatus('Tu avatar de Kaster está listo. Puedes usarlo como avatar del perfil.', 'ok');
    else if (status === 'failed') setCasterAvatarJobStatus(job?.errorMessage || 'La generación falló. Puedes volver a intentarlo.', 'error');
    else setCasterAvatarJobStatus('Solicitud registrada.', 'working');
  }

  async function attachCasterAvatarJobListener(jobId) {
    if (!jobId) return;
    const api = await loadFirebase();
    stopCasterAvatarJobListener();
    casterAvatarCurrentJobId = String(jobId);
    casterAvatarJobUnsubscribe = api.onValue(api.ref(db, `${AVATAR_JOBS_ROOT}/${uid}/${jobId}`), snapshot => {
      const job = snapshot.val();
      if (job) renderCasterAvatarJob(job);
    }, error => {
      setCasterAvatarJobStatus(readableFirebaseError(error), 'error');
    });
  }

  async function loadLatestCasterAvatarJob(profile = socialProfileCache) {
    cacheProfileUi();
    if (isCasterAvatarMockMode()) {
      const localEntry = readLocalCasterAvatarJob();
      if (localEntry?.job) {
        casterAvatarCurrentJobId = String(localEntry.jobId || 'mock-job');
        renderCasterAvatarJob(localEntry.job);
        return localEntry.job;
      }
      if (profile?.casterAvatarUrl) {
        casterAvatarCurrentResultUrl = profile.casterAvatarUrl;
        renderCasterAvatarJob({ status: 'completed', resultUrl: profile.casterAvatarUrl, mock: true });
      } else {
        renderCasterAvatarJob(null);
      }
      return null;
    }
    try {
      const api = await loadFirebase();
      const jobsQuery = api.query(api.ref(db, `${AVATAR_JOBS_ROOT}/${uid}`), api.orderByChild('createdAt'), api.limitToLast(1));
      const snapshot = await api.get(jobsQuery);
      const jobs = snapshot.val() || {};
      const entries = Object.entries(jobs);
      if (entries.length) {
        const [jobId, job] = entries[entries.length - 1];
        renderCasterAvatarJob(job);
        await attachCasterAvatarJobListener(jobId);
        return job;
      }
      if (profile?.casterAvatarUrl) {
        casterAvatarCurrentResultUrl = profile.casterAvatarUrl;
        renderCasterAvatarJob({ status: 'completed', resultUrl: profile.casterAvatarUrl });
      } else {
        renderCasterAvatarJob(null);
      }
      return null;
    } catch (error) {
      setCasterAvatarJobStatus(readableFirebaseError(error), 'error');
      return null;
    }
  }

  function casterAvatarSourceExtension(file) {
    const type = String(file?.type || '').toLowerCase();
    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    return 'jpg';
  }

  async function requestCasterAvatarGeneration() {
    cacheProfileUi();
    if (!hasAuthenticatedAccount()) {
      showAccountAuthOverlay(true);
      return false;
    }
    if (!casterAvatarSourceFile) {
      setCasterAvatarJobStatus('Primero sube una foto.', 'error');
      return false;
    }
    if (!profileUi.casterAvatarConsent?.checked) {
      setCasterAvatarJobStatus('Necesitas confirmar la autorización de uso de la foto.', 'error');
      return false;
    }
    const file = casterAvatarSourceFile;
    if (profileUi.casterAvatarRequestBtn) profileUi.casterAvatarRequestBtn.disabled = true;
    setCasterAvatarJobStatus('Subiendo la foto de referencia…', 'working');
    try {
      if (isCasterAvatarMockMode()) {
        const resultUrl = await fileToDataUrl(file);
        const now = Date.now();
        const jobId = `mock-${now}`;
        const jobPayload = {
          uid,
          status: 'completed',
          sourceContentType: file.type,
          promptVersion: 'rok-caster-avatar-v1',
          mode: 'mock-client-local',
          createdAt: now,
          updatedAt: now,
          completedAt: now,
          resultUrl,
          mock: true,
        };
        persistLocalCasterAvatarJob({ jobId, job: jobPayload });
        casterAvatarCurrentJobId = jobId;
        clearCasterAvatarSourceSelection();
        if (profileUi.casterAvatarConsent) profileUi.casterAvatarConsent.checked = false;
        renderCasterAvatarJob(jobPayload);
        setCasterAvatarJobStatus('Modo mock: avatar generado localmente para prueba.', 'ok');
        return true;
      }
      const api = await loadFirebase();
      requireAuthenticatedAccount();
      const jobRef = api.push(api.ref(db, `${AVATAR_JOBS_ROOT}/${uid}`));
      const jobId = String(jobRef.key || '');
      if (!jobId) throw new Error('No se pudo crear el identificador de la solicitud.');
      const ext = casterAvatarSourceExtension(file);
      const sourcePath = `${AVATAR_SOURCE_ROOT}/${uid}/${jobId}/source.${ext}`;
      const sourceRef = api.storageModule.ref(storage, sourcePath);
      await api.storageModule.uploadBytes(sourceRef, file, {
        contentType: file.type,
        customMetadata: { ownerUid: uid, jobId, purpose: 'rok-caster-avatar-source' },
      });
      const now = Date.now();
      const jobPayload = {
        uid,
        status: 'queued',
        sourcePath,
        sourceContentType: file.type,
        promptVersion: 'rok-caster-avatar-v1',
        mode: 'production',
        createdAt: now,
        updatedAt: now,
      };
      await api.set(jobRef, jobPayload);
      casterAvatarCurrentJobId = jobId;
      clearCasterAvatarSourceSelection();
      if (profileUi.casterAvatarConsent) profileUi.casterAvatarConsent.checked = false;
      renderCasterAvatarJob(jobPayload);
      await attachCasterAvatarJobListener(jobId);
      return true;
    } catch (error) {
      setCasterAvatarJobStatus(readableFirebaseError(error), 'error');
      refreshCasterAvatarRequestButton();
      return false;
    }
  }

  async function useGeneratedCasterAvatar() {
    if (!casterAvatarCurrentResultUrl) {
      setCasterAvatarJobStatus('Todavía no hay un avatar generado disponible.', 'error');
      return false;
    }
    try {
      const profile = await ensureSocialProfile();
      const updates = {
        avatarId: CUSTOM_PROFILE_AVATAR_ID,
        casterAvatarUrl: casterAvatarCurrentResultUrl,
        updatedAt: Date.now(),
      };
      if (isCasterAvatarMockMode()) {
        const localProfile = { ...profile, ...updates, uid };
        socialProfileCache = localProfile;
        persistLocalSocialProfile(localProfile);
        renderProfileAvatarChoices(localProfile);
        updateAccountIdentityUi(auth?.currentUser || null, localProfile);
        await renderProfileCenter(localProfile);
        setProfileCenterTab('avatar');
        setProfileCenterStatus('Tu Kaster generado ahora es el avatar activo de tu cuenta. (modo mock)', 'ok');
        setCasterAvatarJobStatus('Avatar aplicado al perfil local de prueba.', 'ok');
        return true;
      }
      const api = await loadFirebase();
      await api.update(api.ref(db, `socialProfiles/${uid}`), updates);
      socialProfileCache = { ...profile, ...updates, uid };
      await renderProfileCenter(socialProfileCache);
      setProfileCenterTab('avatar');
      setProfileCenterStatus('Tu Kaster generado ahora es el avatar activo de tu cuenta.', 'ok');
      setCasterAvatarJobStatus('Avatar aplicado a tu perfil.', 'ok');
      return true;
    } catch (error) {
      setCasterAvatarJobStatus(readableSocialError(error), 'error');
      return false;
    }
  }

  function setProfileCenterTab(tab = 'summary') {
    cacheProfileUi();
    const selected = ['summary', 'avatar', 'achievements', 'account'].includes(tab) ? tab : 'summary';
    profileUi.tabs.forEach(button => button.classList.toggle('active', button.dataset.profileTab === selected));
    profileUi.panels.forEach(panel => panel.classList.toggle('active', panel.dataset.profilePanel === selected));
    return selected;
  }

  function closeProfileCenter() {
    cacheProfileUi();
    profileUi.overlay?.classList.remove('visible');
    profileUi.overlay?.setAttribute('aria-hidden', 'true');
  }

  function readLocalProfileStats() {
    let spellbooks = 0;
    let collection = 0;
    let pureCrystal = 0;
    try {
      const saved = JSON.parse(localStorage.getItem('rokLite.spellbooks.v1') || '[]');
      spellbooks = Array.isArray(saved) ? saved.length : 0;
    } catch (_) {}
    try {
      const user = JSON.parse(localStorage.getItem('rokLite.userProfile.v1') || '{}');
      collection = user?.collection && typeof user.collection === 'object'
        ? Object.values(user.collection).filter(value => Number(value) > 0).length : 0;
      pureCrystal = Math.max(0, Number(user?.pureCrystal || 0) || 0);
    } catch (_) {}
    return { spellbooks, collection, pureCrystal };
  }

  function renderProfileAvatarChoices(profile) {
    if (!profileUi.avatarGrid) return;
    profileUi.avatarGrid.innerHTML = '';
    const entries = [...PROFILE_AVATARS];
    if (profile?.casterAvatarUrl) entries.unshift({ id: CUSTOM_PROFILE_AVATAR_ID, label: 'Mi Kaster', src: profile.casterAvatarUrl });
    entries.forEach(entry => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-avatar-choice';
      button.dataset.avatarId = entry.id;
      const selected = entry.id === normalizeProfileAvatarId(profile?.avatarId);
      button.classList.toggle('selected', selected);
      button.innerHTML = `<span><img src="${entry.src}" alt="${entry.label}"></span><strong>${entry.label}</strong><small>${selected ? 'Seleccionado' : 'Usar avatar'}</small>`;
      profileUi.avatarGrid.appendChild(button);
    });
  }

  function renderProfileAchievements(stats = {}, friendCount = 0) {
    if (!profileUi.achievementsGrid) return;
    const achievements = [
      { id: 'account', title: 'Identidad de Kaster', copy: 'Crea tu cuenta de R.O.K.', unlocked: Boolean(auth?.currentUser && !auth.currentUser.isAnonymous) },
      { id: 'spellbook', title: 'Primer Spellbook', copy: 'Guarda tu primer Spellbook.', unlocked: Number(stats.spellbooks || 0) >= 1 },
      { id: 'collection', title: 'Coleccionista', copy: 'Consigue al menos 10 cartas distintas.', unlocked: Number(stats.collection || 0) >= 10 },
      { id: 'friend', title: 'Círculo de aliados', copy: 'Agrega tu primer amigo.', unlocked: Number(friendCount || 0) >= 1 },
    ];
    profileUi.achievementsGrid.innerHTML = '';
    let unlockedCount = 0;
    achievements.forEach(entry => {
      if (entry.unlocked) unlockedCount += 1;
      const article = document.createElement('article');
      article.className = `profile-achievement ${entry.unlocked ? 'unlocked' : 'locked'}`;
      article.innerHTML = `<span class="profile-achievement-mark">${entry.unlocked ? '✓' : '◆'}</span><div><strong>${entry.title}</strong><p>${entry.copy}</p></div><small>${entry.unlocked ? 'Completado' : 'Bloqueado'}</small>`;
      profileUi.achievementsGrid.appendChild(article);
    });
    if (profileUi.achievementsCount) profileUi.achievementsCount.textContent = `${unlockedCount} / ${achievements.length}`;
  }

  async function renderProfileCenter(profile = socialProfileCache) {
    cacheProfileUi();
    const activeProfile = profile || await ensureSocialProfile();
    const level = normalizeAccountLevel(activeProfile.level);
    const xp = normalizeAccountXp(activeProfile.xp);
    const required = getXpRequirement(level);
    const progress = Math.max(0, Math.min(100, (xp / required) * 100));
    const avatar = getProfileAvatar(activeProfile.avatarId, activeProfile);
    const stats = readLocalProfileStats();
    let friendCount = 0;
    try { friendCount = (await getFriendIds()).length; } catch (_) {}
    if (profileUi.avatar) profileUi.avatar.src = avatar.src;
    if (profileUi.avatar) profileUi.avatar.alt = `Avatar de ${activeProfile.displayName}`;
    if (profileUi.title) profileUi.title.textContent = activeProfile.displayName;
    if (profileUi.level) profileUi.level.textContent = `Nivel ${level}`;
    if (profileUi.friendCode) profileUi.friendCode.textContent = `Código ${formatFriendCode(activeProfile.friendCode)}`;
    if (profileUi.xpFill) profileUi.xpFill.style.width = `${progress}%`;
    if (profileUi.xpText) profileUi.xpText.textContent = `${xp} / ${required} XP`;
    if (profileUi.summarySpellbooks) profileUi.summarySpellbooks.textContent = String(stats.spellbooks);
    if (profileUi.summaryCollection) profileUi.summaryCollection.textContent = String(stats.collection);
    if (profileUi.summaryFriends) profileUi.summaryFriends.textContent = String(friendCount);
    if (profileUi.summaryCrystal) profileUi.summaryCrystal.textContent = Math.floor(stats.pureCrystal).toLocaleString('en-US');
    if (profileUi.accountNameInput) profileUi.accountNameInput.value = activeProfile.displayName;
    if (profileUi.accountEmail) profileUi.accountEmail.textContent = String(auth?.currentUser?.email || '—');
    if (profileUi.accountFriendCode) profileUi.accountFriendCode.textContent = formatFriendCode(activeProfile.friendCode);
    renderProfileAvatarChoices(activeProfile);
    renderProfileAchievements(stats, friendCount);
    updateAccountIdentityUi(auth?.currentUser || null, activeProfile);
    await loadLatestCasterAvatarJob(activeProfile);
  }

  async function openProfileCenter(tab = 'summary') {
    cacheProfileUi();
    if (!hasAuthenticatedAccount()) {
      showAccountAuthOverlay(true);
      setAccountAuthStatus('Inicia sesión para abrir tu perfil.', 'error');
      return false;
    }
    document.getElementById('mainMenuUserHud')?.classList.remove('is-open');
    document.getElementById('mainMenuUserHud')?.setAttribute('aria-expanded', 'false');
    document.getElementById('mainMenuUserHudMenu')?.setAttribute('aria-hidden', 'true');
    profileUi.overlay?.classList.add('visible');
    profileUi.overlay?.setAttribute('aria-hidden', 'false');
    setProfileCenterTab(tab);
    setProfileCenterStatus('Cargando perfil…', 'working');
    try {
      const profile = await ensureSocialProfile();
      await renderProfileCenter(profile);
      setProfileCenterStatus('', '');
      return true;
    } catch (error) {
      setProfileCenterStatus(readableSocialError(error), 'error');
      return false;
    }
  }

  async function selectProfileAvatar(avatarId) {
    const normalized = normalizeProfileAvatarId(avatarId);
    try {
      const api = await loadFirebase();
      const profile = await ensureSocialProfile();
      if (normalized === CUSTOM_PROFILE_AVATAR_ID && !profile.casterAvatarUrl) throw new Error('Todavía no tienes un avatar de Kaster generado.');
      await api.update(api.ref(db, `socialProfiles/${uid}`), { avatarId: normalized, updatedAt: Date.now() });
      socialProfileCache = { ...profile, avatarId: normalized, uid };
      await renderProfileCenter(socialProfileCache);
      setProfileCenterTab('avatar');
      setProfileCenterStatus(`Avatar actualizado: ${getProfileAvatar(normalized, socialProfileCache).label}.`, 'ok');
      return true;
    } catch (error) {
      setProfileCenterStatus(readableSocialError(error), 'error');
      return false;
    }
  }

  async function saveProfileCenterDisplayName() {
    const displayName = normalizeSocialDisplayName(profileUi.accountNameInput?.value);
    if (displayName.length < 2) {
      setProfileCenterStatus('El nombre visible debe tener al menos 2 caracteres.', 'error');
      return false;
    }
    try {
      const api = await loadFirebase();
      const profile = await ensureSocialProfile();
      await api.update(api.ref(db, `socialProfiles/${uid}`), { displayName, updatedAt: Date.now() });
      if (auth?.currentUser && !auth.currentUser.isAnonymous) await api.authModule.updateProfile(auth.currentUser, { displayName });
      socialProfileCache = { ...profile, displayName, uid };
      if (socialUi.displayNameInput) socialUi.displayNameInput.value = displayName;
      await renderProfileCenter(socialProfileCache);
      setProfileCenterTab('account');
      setProfileCenterStatus(`Nombre actualizado a ${displayName}.`, 'ok');
      return true;
    } catch (error) {
      setProfileCenterStatus(readableSocialError(error), 'error');
      return false;
    }
  }

  async function copyProfileFriendCode() {
    try {
      const profile = socialProfileCache || await ensureSocialProfile();
      const code = formatFriendCode(profile.friendCode);
      await navigator.clipboard.writeText(code);
      setProfileCenterStatus(`Código ${code} copiado.`, 'ok');
      return true;
    } catch (error) {
      setProfileCenterStatus(readableSocialError(error), 'error');
      return false;
    }
  }

  async function sendCurrentAccountPasswordReset() {
    const email = String(auth?.currentUser?.email || '').trim();
    if (!email) {
      setProfileCenterStatus('Esta cuenta no tiene un correo disponible.', 'error');
      return false;
    }
    try {
      const api = await loadFirebase();
      await api.authModule.sendPasswordResetEmail(auth, email);
      setProfileCenterStatus(`Correo de restablecimiento enviado a ${email}.`, 'ok');
      return true;
    } catch (error) {
      setProfileCenterStatus(readableAccountAuthError(error), 'error');
      return false;
    }
  }

  function cacheSocialUi() {
    socialUi.openBtn = document.getElementById('mainMenuFriendsBtn');
    socialUi.overlay = document.getElementById('friendsOverlay');
    socialUi.closeBtn = document.getElementById('friendsCloseBtn');
    socialUi.displayNameInput = document.getElementById('friendsDisplayNameInput');
    socialUi.saveNameBtn = document.getElementById('friendsSaveNameBtn');
    socialUi.ownCode = document.getElementById('friendsOwnCode');
    socialUi.copyCodeBtn = document.getElementById('friendsCopyCodeBtn');
    socialUi.addCodeInput = document.getElementById('friendsAddCodeInput');
    socialUi.sendRequestBtn = document.getElementById('friendsSendRequestBtn');
    socialUi.status = document.getElementById('friendsStatus');
    socialUi.requestCount = document.getElementById('friendsRequestCount');
    socialUi.requestList = document.getElementById('friendsRequestList');
    socialUi.friendCount = document.getElementById('friendsCount');
    socialUi.friendList = document.getElementById('friendsList');
  }

  function normalizeFriendCode(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, FRIEND_CODE_LENGTH);
  }

  function formatFriendCode(value) {
    const code = normalizeFriendCode(value);
    return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  }

  function normalizeSocialDisplayName(value) {
    return String(value || '')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24);
  }

  function setSocialStatus(message, kind = '') {
    if (!socialUi.status) return;
    socialUi.status.textContent = String(message || '');
    socialUi.status.classList.remove('ok', 'error', 'working');
    if (kind) socialUi.status.classList.add(kind);
  }

  function setSocialBusy(busy) {
    const disabled = Boolean(busy);
    if (socialUi.saveNameBtn) socialUi.saveNameBtn.disabled = disabled;
    if (socialUi.copyCodeBtn) socialUi.copyCodeBtn.disabled = disabled;
    if (socialUi.sendRequestBtn) socialUi.sendRequestBtn.disabled = disabled;
    if (socialUi.displayNameInput) socialUi.displayNameInput.disabled = disabled;
    if (socialUi.addCodeInput) socialUi.addCodeInput.disabled = disabled;
  }

  function makeFriendCode() {
    let code = '';
    for (let index = 0; index < FRIEND_CODE_LENGTH; index += 1) {
      code += FRIEND_CODE_ALPHABET[Math.floor(Math.random() * FRIEND_CODE_ALPHABET.length)];
    }
    return code;
  }

  async function reserveFriendCode(api, preferredCode = '') {
    const candidates = [];
    const normalizedPreferred = normalizeFriendCode(preferredCode);
    if (normalizedPreferred.length === FRIEND_CODE_LENGTH) candidates.push(normalizedPreferred);
    for (let index = 0; index < 18; index += 1) candidates.push(makeFriendCode());

    for (const candidate of candidates) {
      const codeRef = api.ref(db, `friendCodes/${candidate}`);
      const result = await api.runTransaction(codeRef, current => {
        if (current === null || current === undefined || String(current) === String(uid)) return uid;
        return;
      }, { applyLocally: false });
      if (result.committed && String(result.snapshot?.val() || '') === String(uid)) return candidate;
    }
    throw new Error('No se pudo generar un código de amigo único.');
  }

  async function ensureSocialProfile() {
    try {
      const api = await loadFirebase();
      const profileRef = api.ref(db, `socialProfiles/${uid}`);
      const snapshot = await api.get(profileRef);
      const existing = snapshot.val() || {};
      let friendCode = normalizeFriendCode(existing.friendCode || '');
      friendCode = await reserveFriendCode(api, friendCode);
      const displayName = normalizeSocialDisplayName(existing.displayName)
        || normalizeSocialDisplayName(auth?.currentUser?.displayName)
        || `Kaster ${friendCode.slice(-4)}`;
      const profile = {
        friendCode,
        displayName,
        avatarId: normalizeProfileAvatarId(existing.avatarId),
        casterAvatarUrl: String(existing.casterAvatarUrl || ''),
        level: normalizeAccountLevel(existing.level),
        xp: normalizeAccountXp(existing.xp),
        createdAt: Number(existing.createdAt || Date.now()),
        updatedAt: Date.now(),
      };
      if (profile.avatarId === CUSTOM_PROFILE_AVATAR_ID && !profile.casterAvatarUrl) profile.avatarId = DEFAULT_PROFILE_AVATAR_ID;
      await api.set(profileRef, profile);
      socialProfileCache = { ...profile, uid };
      persistLocalSocialProfile(socialProfileCache);
      updateAccountIdentityUi(auth?.currentUser || null, socialProfileCache);
      return socialProfileCache;
    } catch (error) {
      if (isCasterAvatarMockMode() || isPermissionDeniedError(error)) {
        const profile = buildLocalSocialProfile({ uid });
        socialProfileCache = { ...profile, uid };
        persistLocalSocialProfile(socialProfileCache);
        updateAccountIdentityUi(auth?.currentUser || null, socialProfileCache);
        return socialProfileCache;
      }
      throw error;
    }
  }

  async function readSocialProfile(profileUid) {
    const targetUid = String(profileUid || '');
    if (!targetUid) return null;
    if (targetUid === uid && socialProfileCache) return { ...socialProfileCache };
    const api = await loadFirebase();
    const snapshot = await api.get(api.ref(db, `socialProfiles/${targetUid}`));
    const profile = snapshot.val();
    if (!profile) return null;
    return {
      uid: targetUid,
      displayName: normalizeSocialDisplayName(profile.displayName) || 'Kaster',
      friendCode: normalizeFriendCode(profile.friendCode),
      avatarId: normalizeProfileAvatarId(profile.avatarId),
      casterAvatarUrl: String(profile.casterAvatarUrl || ''),
      level: normalizeAccountLevel(profile.level),
      xp: normalizeAccountXp(profile.xp),
    };
  }

  function makeEmptySocialNode(text) {
    const node = document.createElement('p');
    node.className = 'friends-empty';
    node.textContent = text;
    return node;
  }

  function makeSocialPlayerCopy(profile, fallbackUid = '') {
    const wrap = document.createElement('div');
    wrap.className = 'friend-row-copy';
    const name = document.createElement('strong');
    name.className = 'friend-row-name';
    name.textContent = normalizeSocialDisplayName(profile?.displayName) || `Kaster ${String(fallbackUid || '').slice(-4)}`;
    const code = document.createElement('span');
    code.className = 'friend-row-code';
    const normalizedCode = normalizeFriendCode(profile?.friendCode || '');
    code.textContent = normalizedCode ? `ID ${formatFriendCode(normalizedCode)}` : 'ID no disponible';
    wrap.append(name, code);
    return wrap;
  }

  async function renderFriendsFromMap(friendMap) {
    const serial = ++socialFriendsRenderSerial;
    const ids = Object.keys(friendMap || {}).filter(friendUid => friendUid && friendUid !== uid);
    if (socialUi.friendCount) socialUi.friendCount.textContent = String(ids.length);
    if (!socialUi.friendList) return;
    if (!ids.length) {
      socialUi.friendList.replaceChildren(makeEmptySocialNode('Todavía no has agregado amigos.'));
      return;
    }
    const profiles = await Promise.all(ids.map(async friendUid => ({
      friendUid,
      profile: await readSocialProfile(friendUid).catch(() => null),
    })));
    if (serial !== socialFriendsRenderSerial || !socialUi.friendList) return;
    socialUi.friendList.replaceChildren();
    profiles
      .sort((a, b) => String(a.profile?.displayName || '').localeCompare(String(b.profile?.displayName || ''), 'es'))
      .forEach(({ friendUid, profile }) => {
        const row = document.createElement('div');
        row.className = 'friend-row';
        row.appendChild(makeSocialPlayerCopy(profile, friendUid));
        const actions = document.createElement('div');
        actions.className = 'friend-row-actions';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = 'Eliminar';
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          await removeFriend(friendUid, profile?.displayName || 'este jugador');
        });
        actions.appendChild(remove);
        row.appendChild(actions);
        socialUi.friendList.appendChild(row);
      });
  }

  async function renderRequestsFromMap(requestMap) {
    const serial = ++socialRequestsRenderSerial;
    const entries = Object.entries(requestMap || {})
      .filter(([senderUid, request]) => senderUid && senderUid !== uid && request?.fromUid === senderUid);
    if (socialUi.requestCount) socialUi.requestCount.textContent = String(entries.length);
    if (!socialUi.requestList) return;
    if (!entries.length) {
      socialUi.requestList.replaceChildren(makeEmptySocialNode('No tienes solicitudes pendientes.'));
      return;
    }
    const resolved = await Promise.all(entries.map(async ([senderUid, request]) => ({
      senderUid,
      request,
      profile: await readSocialProfile(senderUid).catch(() => null),
    })));
    if (serial !== socialRequestsRenderSerial || !socialUi.requestList) return;
    socialUi.requestList.replaceChildren();
    resolved
      .sort((a, b) => Number(a.request?.createdAt || 0) - Number(b.request?.createdAt || 0))
      .forEach(({ senderUid, request, profile }) => {
        const fallbackProfile = {
          displayName: request?.fromName,
          friendCode: request?.fromCode,
        };
        const row = document.createElement('div');
        row.className = 'friend-row';
        row.appendChild(makeSocialPlayerCopy(profile || fallbackProfile, senderUid));
        const actions = document.createElement('div');
        actions.className = 'friend-row-actions';
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'accept';
        accept.textContent = 'Aceptar';
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'reject';
        reject.textContent = 'Rechazar';
        accept.addEventListener('click', async () => {
          accept.disabled = true;
          reject.disabled = true;
          await acceptFriendRequest(senderUid);
        });
        reject.addEventListener('click', async () => {
          accept.disabled = true;
          reject.disabled = true;
          await rejectFriendRequest(senderUid);
        });
        actions.append(accept, reject);
        row.appendChild(actions);
        socialUi.requestList.appendChild(row);
      });
  }

  function stopSocialListeners() {
    socialUnsubscribes.forEach(unsubscribe => {
      try { unsubscribe(); } catch (_) {}
    });
    socialUnsubscribes = [];
  }

  async function startSocialListeners() {
    stopSocialListeners();
    const api = await loadFirebase();
    socialUnsubscribes.push(api.onValue(api.ref(db, `friends/${uid}`), snapshot => {
      void renderFriendsFromMap(snapshot.val() || {});
    }, error => setSocialStatus(readableSocialError(error), 'error')));
    socialUnsubscribes.push(api.onValue(api.ref(db, `friendRequests/${uid}`), snapshot => {
      void renderRequestsFromMap(snapshot.val() || {});
    }, error => setSocialStatus(readableSocialError(error), 'error')));
  }

  function readableSocialError(error) {
    const code = String(error?.code || '');
    if (code.includes('permission-denied') || code.includes('PERMISSION_DENIED')) {
      return 'Firebase bloqueó el sistema de amigos. Publica las reglas de Realtime Database incluidas con esta versión.';
    }
    if (code.includes('network-request-failed')) return 'No se pudo conectar con Firebase. Revisa tu conexión.';
    if (code.includes('auth/operation-not-allowed')) return 'Activa el proveedor Email/Password en Firebase Authentication.';
    return error?.message || 'No se pudo completar la operación social.';
  }

  async function saveSocialDisplayName() {
    const displayName = normalizeSocialDisplayName(socialUi.displayNameInput?.value);
    if (displayName.length < 2) {
      setSocialStatus('El nombre visible debe tener al menos 2 caracteres.', 'error');
      return false;
    }
    setSocialBusy(true);
    try {
      const api = await loadFirebase();
      const profile = await ensureSocialProfile();
      await api.update(api.ref(db, `socialProfiles/${uid}`), { displayName, updatedAt: Date.now() });
      if (auth?.currentUser && !auth.currentUser.isAnonymous) {
        await api.authModule.updateProfile(auth.currentUser, { displayName });
      }
      socialProfileCache = { ...profile, displayName, uid };
      if (socialUi.displayNameInput) socialUi.displayNameInput.value = displayName;
      updateAccountIdentityUi(auth?.currentUser || null, socialProfileCache);
      setSocialStatus(`Nombre actualizado a ${displayName}.`, 'ok');
      return true;
    } catch (error) {
      setSocialStatus(readableSocialError(error), 'error');
      return false;
    } finally {
      setSocialBusy(false);
    }
  }

  async function copyFriendCode() {
    const profile = socialProfileCache || await ensureSocialProfile();
    const formatted = formatFriendCode(profile.friendCode);
    try {
      await navigator.clipboard.writeText(formatted);
      setSocialStatus(`Código ${formatted} copiado.`, 'ok');
    } catch (_) {
      setSocialStatus(`Tu código de amigo es ${formatted}.`, 'ok');
    }
  }

  async function sendFriendRequestByCode(rawCode) {
    const friendCode = normalizeFriendCode(rawCode);
    if (friendCode.length !== FRIEND_CODE_LENGTH) {
      setSocialStatus('Escribe un código de amigo válido de 8 caracteres.', 'error');
      return false;
    }
    setSocialBusy(true);
    try {
      const api = await loadFirebase();
      const ownProfile = await ensureSocialProfile();
      const targetUidSnapshot = await api.get(api.ref(db, `friendCodes/${friendCode}`));
      const targetUid = String(targetUidSnapshot.val() || '');
      if (!targetUid) throw new Error('No existe ningún jugador con ese código de amigo.');
      if (targetUid === uid) throw new Error('No puedes agregarte a ti mismo.');

      const existingFriend = await api.get(api.ref(db, `friends/${uid}/${targetUid}`));
      if (existingFriend.exists()) throw new Error('Ese jugador ya está en tu lista de amigos.');

      const incoming = await api.get(api.ref(db, `friendRequests/${uid}/${targetUid}`));
      if (incoming.exists()) throw new Error('Ese jugador ya te envió una solicitud. Acéptala desde Solicitudes.');

      const targetProfile = await readSocialProfile(targetUid);
      if (!targetProfile) throw new Error('No se pudo cargar el perfil de ese jugador.');
      const now = Date.now();
      const updates = {};
      updates[`friendRequests/${targetUid}/${uid}`] = {
        fromUid: uid,
        fromName: ownProfile.displayName,
        fromCode: ownProfile.friendCode,
        createdAt: now,
      };
      updates[`sentFriendRequests/${uid}/${targetUid}`] = {
        targetUid,
        targetName: targetProfile.displayName,
        targetCode: targetProfile.friendCode,
        createdAt: now,
      };
      await api.update(api.ref(db), updates);
      if (socialUi.addCodeInput) socialUi.addCodeInput.value = '';
      setSocialStatus(`Solicitud enviada a ${targetProfile.displayName}.`, 'ok');
      return true;
    } catch (error) {
      setSocialStatus(readableSocialError(error), 'error');
      return false;
    } finally {
      setSocialBusy(false);
    }
  }

  async function acceptFriendRequest(senderUid) {
    const otherUid = String(senderUid || '');
    if (!otherUid || otherUid === uid) return false;
    try {
      const api = await loadFirebase();
      const requestSnapshot = await api.get(api.ref(db, `friendRequests/${uid}/${otherUid}`));
      const request = requestSnapshot.val();
      if (!request || String(request.fromUid || '') !== otherUid) throw new Error('La solicitud ya no está disponible.');
      const now = Date.now();
      const updates = {};
      updates[`friends/${uid}/${otherUid}`] = { uid: otherUid, since: now };
      updates[`friends/${otherUid}/${uid}`] = { uid, since: now };
      updates[`friendRequests/${uid}/${otherUid}`] = null;
      updates[`sentFriendRequests/${otherUid}/${uid}`] = null;
      await api.update(api.ref(db), updates);
      const profile = await readSocialProfile(otherUid).catch(() => null);
      setSocialStatus(`${profile?.displayName || 'Jugador'} ahora es tu amigo.`, 'ok');
      return true;
    } catch (error) {
      setSocialStatus(readableSocialError(error), 'error');
      return false;
    }
  }

  async function rejectFriendRequest(senderUid) {
    const otherUid = String(senderUid || '');
    if (!otherUid || otherUid === uid) return false;
    try {
      const api = await loadFirebase();
      const updates = {};
      updates[`friendRequests/${uid}/${otherUid}`] = null;
      updates[`sentFriendRequests/${otherUid}/${uid}`] = null;
      await api.update(api.ref(db), updates);
      setSocialStatus('Solicitud rechazada.', 'ok');
      return true;
    } catch (error) {
      setSocialStatus(readableSocialError(error), 'error');
      return false;
    }
  }

  async function removeFriend(friendUid, displayName = 'este jugador') {
    const otherUid = String(friendUid || '');
    if (!otherUid || otherUid === uid) return false;
    try {
      const api = await loadFirebase();
      const updates = {};
      updates[`friends/${uid}/${otherUid}`] = null;
      updates[`friends/${otherUid}/${uid}`] = null;
      await api.update(api.ref(db), updates);
      setSocialStatus(`${displayName} fue eliminado de tus amigos.`, 'ok');
      return true;
    } catch (error) {
      setSocialStatus(readableSocialError(error), 'error');
      return false;
    }
  }

  async function getFriendIds() {
    const api = await loadFirebase();
    requireAuthenticatedAccount();
    await ensureSocialProfile();
    const snapshot = await api.get(api.ref(db, `friends/${uid}`));
    return Object.keys(snapshot.val() || {}).filter(friendUid => friendUid && friendUid !== uid);
  }

  async function isFriend(otherUid) {
    requireAuthenticatedAccount();
    const targetUid = String(otherUid || '');
    if (!targetUid || targetUid === uid) return false;
    const api = await loadFirebase();
    const snapshot = await api.get(api.ref(db, `friends/${uid}/${targetUid}`));
    return snapshot.exists();
  }

  async function getOwnSocialProfile() {
    return { ...(await ensureSocialProfile()) };
  }

  async function openFriendsPanel() {
    cacheSocialUi();
    if (!hasAuthenticatedAccount()) {
      showAccountAuthOverlay(true);
      setAccountAuthStatus('Inicia sesión para usar el sistema de amigos.', 'error');
      return;
    }
    if (!socialUi.overlay) return;
    socialUi.overlay.setAttribute('aria-hidden', 'false');
    socialUi.overlay.classList.add('visible');
    setSocialBusy(true);
    setSocialStatus('Conectando con Firebase…', 'working');
    try {
      const profile = await ensureSocialProfile();
      if (socialUi.displayNameInput) socialUi.displayNameInput.value = profile.displayName;
      if (socialUi.ownCode) socialUi.ownCode.textContent = formatFriendCode(profile.friendCode);
      await startSocialListeners();
      setSocialStatus('Sistema de amigos conectado.', 'ok');
    } catch (error) {
      setSocialStatus(readableSocialError(error), 'error');
    } finally {
      setSocialBusy(false);
    }
  }

  function closeFriendsPanel() {
    stopSocialListeners();
    if (socialUi.overlay) {
      socialUi.overlay.setAttribute('aria-hidden', 'true');
      socialUi.overlay.classList.remove('visible');
    }
  }

  function bindUi() {
    cacheUi();
    cacheSocialUi();
    cacheProfileUi();
    bindAccountUi();
    profileUi.menuProfileBtn?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void openProfileCenter('summary'); });
    profileUi.menuAvatarBtn?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void openProfileCenter('avatar'); });
    profileUi.menuAchievementsBtn?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void openProfileCenter('achievements'); });
    profileUi.menuAccountBtn?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void openProfileCenter('account'); });
    profileUi.closeBtn?.addEventListener('click', closeProfileCenter);
    profileUi.overlay?.addEventListener('click', event => { if (event.target === profileUi.overlay) closeProfileCenter(); });
    profileUi.tabs.forEach(button => button.addEventListener('click', () => setProfileCenterTab(button.dataset.profileTab)));
    profileUi.avatarGrid?.addEventListener('click', event => { const button = event.target?.closest?.('[data-avatar-id]'); if (button) void selectProfileAvatar(button.dataset.avatarId); });
    profileUi.casterAvatarSourceInput?.addEventListener('change', event => { handleCasterAvatarSourceSelected(event.currentTarget.files); });
    profileUi.casterAvatarConsent?.addEventListener('change', refreshCasterAvatarRequestButton);
    profileUi.casterAvatarRequestBtn?.addEventListener('click', () => { void requestCasterAvatarGeneration(); });
    profileUi.casterAvatarUseResultBtn?.addEventListener('click', () => { void useGeneratedCasterAvatar(); });
    profileUi.accountSaveNameBtn?.addEventListener('click', () => { void saveProfileCenterDisplayName(); });
    profileUi.accountNameInput?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void saveProfileCenterDisplayName(); } });
    profileUi.accountCopyCodeBtn?.addEventListener('click', () => { void copyProfileFriendCode(); });
    profileUi.accountFriendsBtn?.addEventListener('click', () => { closeProfileCenter(); void openFriendsPanel(); });
    profileUi.accountPasswordBtn?.addEventListener('click', () => { void sendCurrentAccountPasswordReset(); });
    profileUi.accountLogoutBtn?.addEventListener('click', () => { closeProfileCenter(); void logoutAccount(); });
    socialUi.openBtn?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const hud = document.getElementById('mainMenuUserHud');
      const hudMenu = document.getElementById('mainMenuUserHudMenu');
      hud?.classList.remove('is-open');
      hud?.setAttribute('aria-expanded', 'false');
      hudMenu?.setAttribute('aria-hidden', 'true');
      void openFriendsPanel();
    });
    socialUi.closeBtn?.addEventListener('click', closeFriendsPanel);
    socialUi.overlay?.addEventListener('click', event => {
      if (event.target === socialUi.overlay) closeFriendsPanel();
    });
    socialUi.saveNameBtn?.addEventListener('click', () => { void saveSocialDisplayName(); });
    socialUi.copyCodeBtn?.addEventListener('click', () => { void copyFriendCode(); });
    socialUi.sendRequestBtn?.addEventListener('click', () => { void sendFriendRequestByCode(socialUi.addCodeInput?.value); });
    socialUi.addCodeInput?.addEventListener('input', event => {
      event.target.value = formatFriendCode(event.target.value);
    });
    socialUi.addCodeInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void sendFriendRequestByCode(event.currentTarget.value);
      }
    });
    socialUi.displayNameInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void saveSocialDisplayName();
      }
    });
    ui.closeBtn?.addEventListener('click', () => { void handleLobbyClose(); });
    ui.createBtn?.addEventListener('click', () => { void createRoom(); });
    ui.joinBtn?.addEventListener('click', () => { void showJoinBrowser(); });
    ui.joinBackBtn?.addEventListener('click', () => { stopAvailableRoomListeners(); setOnlineLobbyView('home'); setStatus('Crea una partida o consulta las partidas disponibles de tus amigos.', ''); });
    ui.joinRefreshBtn?.addEventListener('click', () => { void startAvailableRoomListeners(); });
    ui.copyBtn?.addEventListener('click', () => { void copyRoomCode(); });
    ui.readyBtn?.addEventListener('click', () => { void toggleLobbyReady(); });
    ui.selectSpellbookBtn?.addEventListener('click', () => { window.ROK_SPELLBOOK_MATCH?.openOnlineSelector?.(); });
    ui.arenaSelect?.addEventListener('change', event => { void changeLobbyArena(event.currentTarget.value); });
    ui.leaveBtn?.addEventListener('click', () => { void leaveRoom({ silent: false, keepMenu: false }); });
    ui.overlay?.addEventListener('click', event => {
      if (event.target === ui.overlay && !roomCode) closeLobby();
    });

    window.addEventListener('beforeunload', () => {
      if (!roomPath || !playerSlot || !db || !firebaseApiPromise || !uid) return;
      void firebaseApiPromise.then(api => api.update(api.ref(db, `${roomPath}/players/${uid}`), {
        connected: false,
        lastSeenAt: Date.now(),
      })).catch(() => {});
    });

    void initializeAccountAuthentication();
  }

  window.ROK_ACCOUNT = {
    login: loginAccount,
    register: registerAccount,
    logout: logoutAccount,
    resetPassword: resetAccountPassword,
    showLogin: () => { setAccountAuthMode('login'); showAccountAuthOverlay(true); },
    showRegister: () => { setAccountAuthMode('register'); showAccountAuthOverlay(true); },
    isSignedIn: hasAuthenticatedAccount,
    getUser: () => auth?.currentUser && !auth.currentUser.isAnonymous ? {
      uid: auth.currentUser.uid,
      email: auth.currentUser.email || '',
      displayName: auth.currentUser.displayName || '',
    } : null,
  };

  window.ROK_SOCIAL = {
    openFriendsPanel,
    closeFriendsPanel,
    getFriendIds,
    isFriend,
    getOwnProfile: getOwnSocialProfile,
    readProfile: readSocialProfile,
    sendFriendRequestByCode,
  };

  window.ROK_CASTER_AVATAR = {
    request: requestCasterAvatarGeneration,
    useResult: useGeneratedCasterAvatar,
    loadLatest: loadLatestCasterAvatarJob,
    getState: () => ({
      jobId: casterAvatarCurrentJobId,
      resultUrl: casterAvatarCurrentResultUrl,
      hasSourceFile: Boolean(casterAvatarSourceFile),
    }),
  };

  window.ROK_ONLINE_PVP = {
    openLobby,
    closeLobby,
    createRoom,
    joinRoom,
    setLobbyLoadout,
    showJoinBrowser,
    leaveRoom,
    requestRemoteCasterDefense,
    requestRemoteActionWindow,
    setPriorityAction,
    clearPriorityAction,
    emitVisualEvent,
    markPhaseStarted,
    markTurnHandoffPending,
    publishNow: () => publishSnapshot({ force: true }),
    getSession: () => ({
      roomCode,
      playerSlot,
      uid,
      revision: lastKnownRevision,
      active: ROK_ONLINE_MATCH_ACTIVE,
      observedPhaseKey: lastObservedPhaseKey,
      startedPhaseKey: lastStartedPhaseKey,
      handoffPending: turnHandoffPublishPending,
    }),
  };

  window.addEventListener('DOMContentLoaded', bindUi);
}());
