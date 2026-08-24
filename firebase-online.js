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

  // v9.56 · Modo de prueba local sin Firebase Auth.
  // Además de file://, también cubre servidores locales usados para abrir R.O.K
  // en PC o móvil (por ejemplo http://localhost:8080). Firebase puede bloquear
  // esos referers aunque el juego y sus assets carguen correctamente. En estos
  // orígenes omitimos completamente Authentication y dejamos entrar al menú
  // para probar PvB, Aventura, Manual y Tiempo Real. Versus Online permanece
  // bloqueado mientras este modo local esté activo.
  const LOCAL_HOSTNAME = String(window.location.hostname || '').trim().toLowerCase();
  const LOCAL_HTTP_TEST_HOST = (
    LOCAL_HOSTNAME === 'localhost'
    || LOCAL_HOSTNAME === '0.0.0.0'
    || LOCAL_HOSTNAME === '::1'
    || LOCAL_HOSTNAME === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(LOCAL_HOSTNAME)
    || /^10(?:\.\d{1,3}){3}$/.test(LOCAL_HOSTNAME)
    || /^192\.168(?:\.\d{1,3}){2}$/.test(LOCAL_HOSTNAME)
    || /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(LOCAL_HOSTNAME)
  );
  const LOCAL_FILE_TEST_MODE = (
    window.location.protocol === 'file:'
    || window.location.origin === 'null'
    || !/^https?:$/i.test(String(window.location.protocol || ''))
    || LOCAL_HTTP_TEST_HOST
  );
  const ROOM_ROOT = 'rooms';
  const ROOM_CODE_LENGTH = 6;
  const SYNC_DEBOUNCE_MS = 90;
  const SYNC_WATCHDOG_MS = 1800;
  const REMOTE_DEFENSE_TIMEOUT_MS = 45000;
  const REMOTE_ACTION_WINDOW_TIMEOUT_MS = 60000;
  const RECONNECT_GRACE_MS = 60000;
  const REALTIME_COMMAND_MAX_AGE_MS = 10000;
  const REALTIME_COMMAND_MAX_FUTURE_SKEW_MS = 5000;
  const REALTIME_COMMAND_MAX_REVISION_LAG = 40;
  const REALTIME_COMMAND_TYPES = Object.freeze([
    'caster-move',
    'combat-mode',
    'cast-card',
    'thought-pause',
    'spell-action-pause',
    'progressive-recast',
    'power-automation',
    'power-arm',
  ]);
  const SESSION_STORAGE_KEY = 'rok_online_room_session_v2';
  const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const FRIEND_CODE_LENGTH = 8;
  const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const OPEN_ROOMS_ROOT = 'openRooms';
  const AVATAR_JOBS_ROOT = 'avatarJobs';
  const CUSTOM_PROFILE_AVATAR_ID = 'custom-caster';
  const MAX_CASTER_AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;
  const LOBBY_COUNTDOWN_MS = 6200;
  const SHARED_ARENAS = window.ROK_ARENA_REGISTRY || {};
  const ARENA_OPTIONS = Object.freeze({
    ...Object.fromEntries(Object.values(SHARED_ARENAS)
      .filter(arena => arena && arena.pvp)
      .map(arena => [arena.id, {
        id: arena.id,
        label: arena.label,
        previewImage: arena.previewImage,
        battleImage: arena.battleImage,
      }])),
    random: {
      id: 'random',
      label: 'Random',
      previewImage: 'assets/arenas/previews/japan.webp',
      battleImage: 'assets/arena.webp',
      random: true,
    },
  });
  const CONCRETE_ARENA_IDS = Object.freeze(Object.keys(ARENA_OPTIONS).filter(id => id !== 'random'));


  const ONLINE_SNAPSHOT_SCHEMA_VERSION = 6;
  const ONLINE_SNAPSHOT_HASH_VERSION = 2;
  const ONLINE_FX_SCHEMA_VERSION = 2;
  const ONLINE_FX_RETENTION_MS = 18000;
  const ONLINE_FX_DEFAULT_MAX_REPLAY_AGE_MS = 9000;

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
    'matchSerial',
    'matchWins',
    'phaseUndo',
    'resolutionUndoReturn',
    'resolutionActionTaken',
    'turnActionByPlayer',
    'resolutionSerial',
    'arenaEntrySerial',
    'smokeZones',
    'farolPortals',
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
    'openingElementsDealt',
    'openingExtractionSkippedByPlayer',
    'playStyle',
    'realtime',
    'players',
  ];

  // Firebase RTDB elimina propiedades null y colecciones vacías. Si una
  // colección pasa de "con datos" a vacía y no la reconstruimos, el otro
  // navegador conservaría basura de una revisión anterior. Estos defaults
  // hacen que cada snapshot sea reemplazo de estado, no un merge parcial.
  const SNAPSHOT_ARRAY_KEYS = new Set([
    'smokeZones',
    'farolPortals',
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
    if (key === 'matchSerial') return 1;
    if (key === 'kouutenProgressiveByPlayer') return {};
    if (key === 'openingElementsDealt') return false;
    if (key === 'openingExtractionSkippedByPlayer') return { 1: false, 2: false };
    if (key === 'playStyle') return 'manual';
    if (key === 'realtime') return { active: false, startedAt: 0, elapsedSeconds: 0, tickSerial: 0, phaseEquivalentSeconds: 1 };
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
  let uid = '';
  let roomCode = '';
  let roomPath = '';
  let playerSlot = 0;
  let roomUnsubscribe = null;
  let roomSessionGeneration = 0;
  let authoritativeUnsubscribe = null;
  let interactionUnsubscribe = null;
  let realtimeCommandUnsubscribe = null;
  let priorityActionUnsubscribe = null;
  let matchPlayersUnsubscribe = null;
  let matchStatusUnsubscribe = null;
  let matchControlUnsubscribe = null;
  let fxUnsubscribe = null;
  let fxListenerStartedAt = 0;
  const handledFxEventIds = new Set();
  let presenceDisconnect = null;
  let connectionUnsubscribe = null;
  let opponentReconnectTimer = null;
  let opponentReconnectDeadline = 0;
  let reconnectCandidate = null;
  let syncTimer = null;
  let publishTimer = null;
  let localStateDirty = false;
  let localMutationSerial = 0;
  let lastPublishedMutationSerial = 0;
  let publishQueueTail = Promise.resolve(false);
  let remoteFxPlaybackTail = Promise.resolve();
  let outboundFxPublishTail = Promise.resolve(true);
  let fxPlaybackGeneration = 1;
  let outboundFxSequence = 0;
  let fxListenerGeneration = 0;
  let fxListenerFloorKey = '';
  let firebaseServerTimeOffsetMs = 0;
  const lastFxSequenceByAuthor = new Map();
  const activeParallelFxPlaybacks = new Set();
  const pendingFxCleanupEntries = new Map();
  let fxCleanupTimer = null;
  const fxStats = {
    emitted: 0,
    emitFailed: 0,
    received: 0,
    played: 0,
    skippedDuplicate: 0,
    skippedOwn: 0,
    skippedMatch: 0,
    skippedStale: 0,
    skippedUnsupported: 0,
    revisionWaits: 0,
    revisionWaitFailures: 0,
    parallelPlayed: 0,
    serialPlayed: 0,
  };
  const realtimeCommandStats = {
    received: 0,
    applied: 0,
    rejectedIdentity: 0,
    rejectedMatch: 0,
    rejectedStale: 0,
    rejectedRevision: 0,
    rejectedPayload: 0,
  };
  let roomCache = null;
  let lastKnownRevision = 0;
  let lastSnapshotText = '';
  let lastAuthoritativeSnapshot = null;
  let lastAuthoritativeSnapshotText = '';
  let lastAuthoritativeSnapshotHash = '';
  const consistencyStats = {
    validatedOutgoing: 0,
    rejectedOutgoing: 0,
    validatedIncoming: 0,
    rejectedIncoming: 0,
    hashMismatch: 0,
    passiveChecks: 0,
    passiveRepairs: 0,
    actionWindowRejected: 0,
    legacySnapshots: 0,
    lastIssue: '',
  };
  let lastObservedPhaseKey = '';
  let lastStartedPhaseKey = '';
  let phaseDeliveryScheduledKey = '';
  let phaseDeliveryInFlightKey = '';
  let phaseDeliveryPromise = null;
  let lastAnnouncedPhaseKey = '';
  let phaseDeliveryRetryTimer = null;
  let pendingPhaseDeliveryContext = null;
  let turnHandoffPublishPending = false;
  let applyingRemoteSnapshot = false;
  let publishingSnapshot = false;
  let startingOnlineBattle = false;
  let startingOnlineRematch = false;
  let matchControlCache = null;
  const networkCleanupTimers = new Set();
  const pendingInteractionAborters = new Set();
  let handledInteractionId = '';
  let passiveConsistencySuspendUntil = 0;
  const handledInteractionIds = new Set();
  const handledRealtimeCommandIds = new Set();
  let realtimeCommandTail = Promise.resolve(true);
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
  let onlineSpellbookCarouselIndex = 0;
  let onlineArenaCarouselIndex = 0;

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
  let socialProfileRemoteBlocked = false;

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
    const code = `${String(error?.code || '')} ${String(error?.message || '')}`.toLowerCase();
    return code.includes('permission-denied')
      || code.includes('permission_denied')
      || code.includes('permission denied')
      || code.includes('database/permission-denied');
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
    ui.playStylePanel = document.getElementById('onlinePlayStylePanel');
    ui.playStyleName = document.getElementById('onlinePlayStyleName');
    ui.playStyleHelp = document.getElementById('onlinePlayStyleHelp');
    ui.playStyleManualBtn = document.getElementById('onlinePlayStyleManualBtn');
    ui.playStyleRealtimeBtn = document.getElementById('onlinePlayStyleRealtimeBtn');
    ui.localSpellbookName = document.getElementById('onlineLocalSpellbookName');
    ui.spellbookCarouselViewport = document.getElementById('onlineSpellbookCarouselViewport');
    ui.spellbookPrevBtn = document.getElementById('onlineSpellbookPrevBtn');
    ui.spellbookNextBtn = document.getElementById('onlineSpellbookNextBtn');
    ui.arenaPreviewWrap = document.getElementById('onlineArenaPreviewWrap');
    ui.arenaPreview = document.getElementById('onlineArenaPreview');
    ui.arenaName = document.getElementById('onlineArenaName');
    ui.arenaPrevBtn = document.getElementById('onlineArenaPrevBtn');
    ui.arenaNextBtn = document.getElementById('onlineArenaNextBtn');
    ui.arenaRandomBtn = document.getElementById('onlineArenaRandomBtn');
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
    ui.reconnectNotice = document.getElementById('onlineReconnectNotice');
    ui.reconnectNoticeText = document.getElementById('onlineReconnectNoticeText');
    ui.reconnectSeconds = document.getElementById('onlineReconnectSeconds');
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
      if (ui.playStyleManualBtn) ui.playStyleManualBtn.disabled = true;
      if (ui.playStyleRealtimeBtn) ui.playStyleRealtimeBtn.disabled = true;
      if (ui.spellbookPrevBtn) ui.spellbookPrevBtn.disabled = true;
      if (ui.spellbookNextBtn) ui.spellbookNextBtn.disabled = true;
      if (ui.arenaPrevBtn) ui.arenaPrevBtn.disabled = true;
      if (ui.arenaNextBtn) ui.arenaNextBtn.disabled = true;
      if (ui.arenaRandomBtn) ui.arenaRandomBtn.disabled = true;
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

  // v9.89 · El modo Online pertenece al lobby, no a una preferencia local de
  // cada navegador. J1 conserva la única selección y J2 la observa en vivo.
  // El fallback mantiene compatibles las salas v9.88 ya abiertas.
  function getLobbyPlayStyle(room = roomCache) {
    const hostRecord = getRoomPlayerRecord(room, 1);
    return normalizeOnlinePlayStyle(hostRecord?.lobbyPlayStyle || hostRecord?.loadout?.playStyle || 'manual');
  }

  function withLobbyPlayStyle(loadout, playStyle = getLobbyPlayStyle()) {
    if (!loadout || typeof loadout !== 'object') return loadout;
    return { ...deepClone(loadout), playStyle: normalizeOnlinePlayStyle(playStyle) };
  }

  function areLobbyPlayersReady(room = roomCache) {
    const p1 = getRoomPlayerRecord(room, 1);
    const p2 = getRoomPlayerRecord(room, 2);
    const playStyle = getLobbyPlayStyle(room);
    return Boolean(
      room?.guestUid
      && p1?.connected
      && p2?.connected
      && p1?.ready
      && p2?.ready
      && !getLoadoutIssue(p1?.loadout)
      && !getLoadoutIssue(p2?.loadout)
      && normalizeOnlinePlayStyle(p1?.loadout?.playStyle) === playStyle
      && normalizeOnlinePlayStyle(p2?.loadout?.playStyle) === playStyle
    );
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
    if (image && image.getAttribute('src') !== arena.battleImage) image.setAttribute('src', arena.battleImage);
    return arena;
  }

  function setOnlineLobbyView(view) {
    onlineLobbyView = ['home', 'join', 'room'].includes(view) ? view : 'home';
    if (ui.homeView) ui.homeView.hidden = onlineLobbyView !== 'home';
    if (ui.joinView) ui.joinView.hidden = onlineLobbyView !== 'join';
    if (ui.roomView) ui.roomView.hidden = onlineLobbyView !== 'room';
    if (ui.title) ui.title.textContent = onlineLobbyView === 'room' ? 'Lobby de partida' : (onlineLobbyView === 'join' ? 'Partidas de amigos' : 'Duelo entre amigos');
    if (ui.copy) ui.copy.textContent = onlineLobbyView === 'room'
      ? 'El Host elige el modo y la arena. Cada jugador selecciona su Spellbook. Cuando ambos estén listos, el duelo comienza automáticamente.'
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
    if (reconnectCandidate) {
      const reconnectRow = document.createElement('article');
      reconnectRow.className = 'online-available-room online-reconnect-room';
      const copy = document.createElement('div');
      copy.className = 'online-available-room-copy';
      const name = document.createElement('strong');
      name.textContent = 'Partida interrumpida';
      const meta = document.createElement('span');
      const remaining = reconnectCandidate.player?.connected === false
        ? Math.max(0, Math.ceil(((Number(reconnectCandidate.player?.lastSeenAt || getServerNow()) + RECONNECT_GRACE_MS) - getServerNow()) / 1000))
        : Math.ceil(RECONNECT_GRACE_MS / 1000);
      meta.textContent = `Sala ${reconnectCandidate.code} · reconexión disponible · ${remaining}s`;
      copy.append(name, meta);
      const reconnect = document.createElement('button');
      reconnect.type = 'button';
      reconnect.textContent = 'RECONECTARSE';
      reconnect.addEventListener('click', () => { reconnect.disabled = true; void reconnectSavedMatch(); });
      reconnectRow.append(copy, reconnect);
      ui.availableRoomsList.appendChild(reconnectRow);
    }
    if (!entries.length && !reconnectCandidate) {
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
    if (ui.availableRoomsList) ui.availableRoomsList.innerHTML = '<div class="online-room-empty">Buscando partidas y reconexiones…</div>';
    const api = await loadFirebase();
    await refreshReconnectCandidate(api);
    const friendIds = await getFriendIds();
    if (!friendIds.length) {
      renderAvailableRooms();
      setStatus(reconnectCandidate ? 'Tienes una partida interrumpida disponible para reconexión.' : 'Todavía no tienes amigos agregados. Añade amigos desde tu perfil para ver sus partidas.', reconnectCandidate ? 'working' : '');
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
        if (String(oldRoom?.hostUid || '') === uid && !getAuthoritativeGameState(oldRoom)?.snapshot) {
          await api.remove(api.ref(db, roomRefPath(normalized)));
        }
      } catch (_) {}
      try { await api.remove(api.ref(db, `${OPEN_ROOMS_ROOT}/${uid}/${normalized}`)); } catch (_) {}
    }
  }

  async function publishOpenRoomListing(api, code, room = null) {
    if (!code || playerSlot !== 1) return;
    const profile = socialProfileCache || await ensureSocialProfile();
    const arenaId = normalizeArenaId(room?.arenaId || roomCache?.arenaId || 'classic');
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

  function getOnlineSpellbookOptions() {
    try { return window.ROK_SPELLBOOK_MATCH?.getOnlineOptions?.() || []; }
    catch (_) { return []; }
  }

  function renderOnlineSpellbookCarousel(localLoadout = null, locked = false) {
    const viewport = ui.spellbookCarouselViewport;
    if (!viewport) return;
    const options = getOnlineSpellbookOptions();
    viewport.replaceChildren();
    if (!options.length) {
      const empty = document.createElement('div');
      empty.className = 'online-carousel-empty';
      empty.textContent = 'No hay Spellbooks con Fuente elemental configurada.';
      viewport.appendChild(empty);
      if (ui.localSpellbookName) ui.localSpellbookName.textContent = 'Sin seleccionar';
      if (ui.spellbookPrevBtn) ui.spellbookPrevBtn.disabled = true;
      if (ui.spellbookNextBtn) ui.spellbookNextBtn.disabled = true;
      return;
    }
    const activeId = String(localLoadout?.id || localLoadout?.spellbookId || window.ROK_SPELLBOOK_MATCH?.getPreferredOnlineId?.() || '');
    const activeIndex = options.findIndex(option => option.id === activeId);
    if (activeIndex >= 0) onlineSpellbookCarouselIndex = activeIndex;
    onlineSpellbookCarouselIndex = ((onlineSpellbookCarouselIndex % options.length) + options.length) % options.length;
    const slots = options.length === 1
      ? [{ index: onlineSpellbookCarouselIndex, role: 'current' }]
      : [
          { index: (onlineSpellbookCarouselIndex - 1 + options.length) % options.length, role: 'previous' },
          { index: onlineSpellbookCarouselIndex, role: 'current' },
          { index: (onlineSpellbookCarouselIndex + 1) % options.length, role: 'next' },
        ];
    slots.forEach(slot => {
      const data = options[slot.index];
      const node = window.ROK_SPELLBOOK_MATCH?.createOnlineOptionElement?.(data.id);
      if (!node) return;
      node.classList.add('online-spellbook-carousel-card', `is-${slot.role}`);
      node.dataset.carouselRole = slot.role;
      node.setAttribute('aria-hidden', slot.role === 'current' ? 'false' : 'true');
      viewport.appendChild(node);
    });
    const current = options[onlineSpellbookCarouselIndex];
    if (ui.localSpellbookName) ui.localSpellbookName.textContent = current?.name || localLoadout?.name || 'Sin seleccionar';
    const disabled = locked || options.length <= 1;
    if (ui.spellbookPrevBtn) ui.spellbookPrevBtn.disabled = disabled;
    if (ui.spellbookNextBtn) ui.spellbookNextBtn.disabled = disabled;
  }

  async function shiftOnlineSpellbook(direction) {
    if (!roomCache || roomCache.status === 'countdown') return;
    const options = getOnlineSpellbookOptions();
    if (options.length <= 1) return;
    onlineSpellbookCarouselIndex = (onlineSpellbookCarouselIndex + (direction < 0 ? -1 : 1) + options.length) % options.length;
    const selected = options[onlineSpellbookCarouselIndex];
    const loadout = window.ROK_SPELLBOOK_MATCH?.getOnlineLoadoutById?.(selected.id);
    if (!loadout) return;
    renderOnlineSpellbookCarousel(loadout, true);
    await setLobbyLoadout(loadout);
  }

  function renderOnlineArenaCarousel(arenaId, locked = false) {
    const arena = getArenaOption(arenaId);
    const concreteIndex = CONCRETE_ARENA_IDS.indexOf(arena.id);
    if (concreteIndex >= 0) onlineArenaCarouselIndex = concreteIndex;
    if (ui.arenaPreview) {
      ui.arenaPreview.src = arena.previewImage;
      ui.arenaPreview.alt = arena.random ? 'Selección aleatoria de arena' : `Preview de ${arena.label}`;
    }
    if (ui.arenaPreviewWrap) ui.arenaPreviewWrap.classList.toggle('is-random', Boolean(arena.random));
    if (ui.arenaName) ui.arenaName.textContent = arena.random ? 'Arena aleatoria' : arena.label;
    const disableArrows = locked || playerSlot !== 1 || CONCRETE_ARENA_IDS.length <= 1;
    if (ui.arenaPrevBtn) ui.arenaPrevBtn.disabled = disableArrows;
    if (ui.arenaNextBtn) ui.arenaNextBtn.disabled = disableArrows;
    if (ui.arenaRandomBtn) {
      ui.arenaRandomBtn.disabled = locked || playerSlot !== 1;
      ui.arenaRandomBtn.classList.toggle('selected', Boolean(arena.random));
      ui.arenaRandomBtn.setAttribute('aria-pressed', arena.random ? 'true' : 'false');
    }
  }

  function renderOnlinePlayStyle(room, locked = false) {
    const playStyle = getLobbyPlayStyle(room);
    const realtime = playStyle === 'realtime';
    const p1 = getRoomPlayerRecord(room, 1);
    const p2 = getRoomPlayerRecord(room, 2);
    const readyLocked = Boolean(p1?.ready || p2?.ready);
    const canEdit = playerSlot === 1 && !locked && !readyLocked;
    if (ui.playStylePanel) {
      ui.playStylePanel.dataset.playStyle = playStyle;
      ui.playStylePanel.classList.toggle('is-guest-view', playerSlot !== 1);
      ui.playStylePanel.classList.toggle('is-locked', !canEdit);
    }
    if (ui.playStyleName) ui.playStyleName.textContent = realtime ? 'Tiempo real' : 'Manual por turnos';
    if (ui.playStyleHelp) {
      ui.playStyleHelp.textContent = readyLocked
        ? 'El modo queda bloqueado mientras algún jugador esté en LISTO.'
        : (playerSlot === 1
          ? 'Tu elección se aplicará automáticamente a ambos jugadores.'
          : 'El Host selecciona el modo que usarán ambos jugadores.');
    }
    const syncButton = (button, selected) => {
      if (!button) return;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.disabled = !canEdit;
    };
    syncButton(ui.playStyleManualBtn, !realtime);
    syncButton(ui.playStyleRealtimeBtn, realtime);
  }

  async function changeLobbyPlayStyle(playStyle) {
    if (!roomPath || playerSlot !== 1 || !roomCache || roomCache.status === 'countdown') return false;
    const p1 = getRoomPlayerRecord(roomCache, 1);
    const p2 = getRoomPlayerRecord(roomCache, 2);
    if (p1?.ready || p2?.ready) {
      setStatus('Cancela LISTO en ambos jugadores antes de cambiar el modo.', 'error');
      return false;
    }
    const normalized = normalizeOnlinePlayStyle(playStyle);
    if (normalized === getLobbyPlayStyle(roomCache)) return true;
    try {
      const api = await loadFirebase();
      const updates = {
        lobbyPlayStyle: normalized,
        ready: false,
        lastSeenAt: api.serverTimestamp(),
      };
      if (p1?.loadout) updates.loadout = withLobbyPlayStyle(p1.loadout, normalized);
      await api.update(api.ref(db, `${roomPath}/players/${uid}`), updates);
      setStatus(normalized === 'realtime'
        ? 'Modo Tiempo real seleccionado para ambos jugadores.'
        : 'Modo Manual seleccionado para ambos jugadores.', 'ok');
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo cambiar el modo del lobby');
      setStatus(readableFirebaseError(error), 'error');
      return false;
    }
  }

  async function shiftOnlineArena(direction) {
    if (playerSlot !== 1 || !roomCache || roomCache.status === 'countdown' || !CONCRETE_ARENA_IDS.length) return;
    const currentId = normalizeArenaId(roomCache.arenaId);
    const currentIndex = CONCRETE_ARENA_IDS.indexOf(currentId);
    if (currentIndex >= 0) onlineArenaCarouselIndex = currentIndex;
    onlineArenaCarouselIndex = (onlineArenaCarouselIndex + (direction < 0 ? -1 : 1) + CONCRETE_ARENA_IDS.length) % CONCRETE_ARENA_IDS.length;
    await changeLobbyArena(CONCRETE_ARENA_IDS[onlineArenaCarouselIndex]);
  }

  function pickRandomConcreteArenaId() {
    if (!CONCRETE_ARENA_IDS.length) return 'classic';
    return CONCRETE_ARENA_IDS[Math.floor(Math.random() * CONCRETE_ARENA_IDS.length)] || 'classic';
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
    renderOnlinePlayStyle(room, room.status === 'countdown');
    renderOnlineSpellbookCarousel(localLoadout, room.status === 'countdown');
    if (ui.roomRole) ui.roomRole.textContent = playerSlot === 1 ? 'HOST · JUGADOR 1' : 'INVITADO · JUGADOR 2';
    if (ui.roomName) ui.roomName.textContent = room.status === 'countdown' ? 'El duelo está por comenzar' : 'Preparando duelo';
    const bothConnected = Boolean(p1?.connected && p2?.connected && room.guestUid);
    if (ui.roomConnection) {
      ui.roomConnection.textContent = bothConnected ? '2/2 CONECTADOS' : '1/2 CONECTADOS';
      ui.roomConnection.classList.toggle('connected', bothConnected);
    }
    const arena = getArenaOption(room.arenaId);
    renderOnlineArenaCarousel(arena.id, room.status === 'countdown');
    if (!arena.random) applyArenaToBattle(arena.id);
    const localReady = Boolean(localRecord?.ready);
    if (ui.readyBtn) {
      ui.readyBtn.textContent = localReady ? 'CANCELAR LISTO' : 'LISTO';
      ui.readyBtn.classList.toggle('is-ready', localReady);
      ui.readyBtn.disabled = Boolean(room.status === 'countdown' || !localLoadout || getLoadoutIssue(localLoadout));
      ui.readyBtn.setAttribute('aria-hidden', 'false');
    }
  }

  function setLobbyOverlayVisibleForMatchIntro(visible) {
    if (!ui.overlay) return;
    ui.overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
    ui.overlay.classList.toggle('visible', Boolean(visible));
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
    try { window.ROK_VERSUS_INTRO?.hideOnline?.(); } catch (_) {}
  }

  function renderLobbyCountdown(startAt) {
    const target = Number(startAt || 0);
    if (!target) { stopLobbyCountdown(); return; }
    if (lobbyCountdownStartAt !== target) {
      stopLobbyCountdown();
      lobbyCountdownStartAt = target;
    }
    if (ui.countdown) {
      ui.countdown.classList.remove('visible');
      ui.countdown.setAttribute('aria-hidden', 'true');
    }
    const arena = getArenaOption(roomCache?.arenaId);
    // Firebase indexa room.players por UID, no por slot 1/2. La pantalla VS de
    // game.js trabaja por lados visuales, así que le entregamos una vista por
    // slots construida a partir de hostUid/guestUid y los loadouts exactos que
    // cada jugador dejó en LISTO.
    const introP1 = getRoomPlayerRecord(roomCache, 1) || {};
    const introP2 = getRoomPlayerRecord(roomCache, 2) || {};
    const introRoom = {
      ...roomCache,
      players: { 1: introP1, 2: introP2 },
    };
    const localIntroRecord = Number(playerSlot) === 2 ? introP2 : introP1;
    const rivalIntroRecord = Number(playerSlot) === 2 ? introP1 : introP2;
    const shown = Boolean(window.ROK_VERSUS_INTRO?.showOnline?.({
      room: introRoom,
      localPlayerSlot: playerSlot,
      localLoadout: localIntroRecord?.loadout || null,
      rivalLoadout: rivalIntroRecord?.loadout || null,
      arena,
      startAt: target,
    }));
    // La cinemática VS es una pantalla completa. Si permanece el lobby visible,
    // su z-index tapa la presentación y el duelo parece comenzar "por detrás".
    // Solo ocultamos el lobby cuando la presentación real está disponible; el
    // contador legado sigue dentro del lobby como fallback.
    setLobbyOverlayVisibleForMatchIntro(!shown);
    if (!shown) {
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
          if (label && label.textContent !== text) label.textContent = text;
        }
        if (remaining <= -700 && lobbyCountdownTimer) {
          window.clearInterval(lobbyCountdownTimer);
          lobbyCountdownTimer = null;
        }
      };
      paint();
      if (!lobbyCountdownTimer) lobbyCountdownTimer = window.setInterval(paint, 100);
    }
  }

  async function setLobbyLoadout(loadout) {
    if (!loadout || getLoadoutIssue(loadout)) {
      setStatus(getLoadoutIssue(loadout) || 'Selecciona un Spellbook válido.', 'error');
      return false;
    }
    if (!roomPath || !playerSlot) return true;
    try {
      const api = await loadFirebase();
      const playStyle = getLobbyPlayStyle(roomCache);
      const synchronizedLoadout = withLobbyPlayStyle(loadout, playStyle);
      await api.update(api.ref(db, `${roomPath}/players/${uid}`), {
        loadout: synchronizedLoadout,
        ...(playerSlot === 1 ? { lobbyPlayStyle: playStyle } : {}),
        ready: false,
        lastSeenAt: api.serverTimestamp(),
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
      const playStyle = getLobbyPlayStyle(roomCache);
      await api.update(api.ref(db, `${roomPath}/players/${uid}`), {
        loadout: withLobbyPlayStyle(loadout, playStyle),
        ...(playerSlot === 1 ? { lobbyPlayStyle: playStyle } : {}),
        ready: !Boolean(localRecord?.ready),
        lastSeenAt: api.serverTimestamp(),
      });
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
    const bothReady = areLobbyPlayersReady(roomCache);
    if (!bothReady) return;
    try {
      const api = await loadFirebase();
      await removeOpenRoomListing(api, roomCode, uid);
      const resolvedArenaId = normalizeArenaId(roomCache.arenaId) === 'random' ? pickRandomConcreteArenaId() : normalizeArenaId(roomCache.arenaId);
      await api.update(api.ref(db, roomPath), { arenaId: resolvedArenaId, status: 'countdown', startAt: Date.now() + LOBBY_COUNTDOWN_MS });
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
    if (!roomPath || !playerSlot || !uid || getAuthoritativeGameState(room)?.snapshot) {
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
    if (playerSlot !== 1 || hostLobbyReconcileBusy || !roomPath || getAuthoritativeGameState(room)?.snapshot) return;
    hostLobbyReconcileBusy = true;
    try {
      const api = await loadFirebase();
      const p1 = getRoomPlayerRecord(room, 1);
      const p2 = getRoomPlayerRecord(room, 2);
      const guestPresent = Boolean(room.guestUid && p2?.uid);
      const bothReady = Boolean(guestPresent && areLobbyPlayersReady(room));

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
    const pending = window.ROK_SPELLBOOK_MATCH?.getPendingOnlineLoadout?.() || null;
    if (pending) return pending;
    const preferredId = window.ROK_SPELLBOOK_MATCH?.getPreferredOnlineId?.() || '';
    return preferredId ? (window.ROK_SPELLBOOK_MATCH?.getOnlineLoadoutById?.(preferredId) || null) : null;
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
    // El snapshot que viaja a RTDB debe ser JSON-safe: este clon elimina
    // undefined y cualquier dato no serializable exactamente igual que
    // Firebase espera. La optimización de Etapa 5 consiste en ejecutarlo una
    // sola vez sobre el snapshot completo, no una vez por cada clave.
    return JSON.parse(JSON.stringify(value));
  }

  function getAuthoritativeGameState(room = roomCache) {
    if (!room || typeof room !== 'object') return null;
    if (room.game?.authoritative?.snapshot) return room.game.authoritative;
    // Compatibilidad de lectura con salas creadas antes de la separación de canales.
    if (room.game?.snapshot) return room.game;
    return null;
  }

  function authoritativeGamePath() {
    return `${roomPath}/game/authoritative`;
  }

  function interactionsPath() {
    return `${roomPath}/game/interactions`;
  }

  function realtimeCommandsPath() {
    return `${roomPath}/game/realtimeCommands`;
  }

  function normalizeOnlinePlayStyle(value) {
    return String(value || '').toLowerCase() === 'realtime' ? 'realtime' : 'manual';
  }

  function isRealtimeOnlineMatch() {
    return Boolean(ROK_ONLINE_MATCH_ACTIVE && normalizeOnlinePlayStyle(state?.playStyle) === 'realtime');
  }

  function isRealtimeAuthority() {
    return Boolean(isRealtimeOnlineMatch() && Number(playerSlot) === 1);
  }

  function matchControlPath() {
    return `${roomPath}/game/matchControl`;
  }

  function currentMatchSerial() {
    return Math.max(1, Number(state.matchSerial || 1));
  }

  function phaseKeyFromSnapshot(snapshot) {
    if (!snapshot) return '';
    return `${Math.max(1, Number(snapshot.matchSerial || 1))}:${Number(snapshot.turnSerial || 0)}:${Number(snapshot.activePlayer || 0)}:${Number(snapshot.phaseIndex || 0)}`;
  }

  function currentLocalPhaseKey() {
    return `${currentMatchSerial()}:${Number(state.turnSerial || 0)}:${Number(state.activePlayer || 0)}:${Number(state.phaseIndex || 0)}`;
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

  function getBattleSnapshotSource() {
    const source = { _schemaVersion: ONLINE_SNAPSHOT_SCHEMA_VERSION };
    SNAPSHOT_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        source[key] = state[key];
        return;
      }
      const fallback = snapshotDefaultValue(key);
      if (fallback !== undefined) source[key] = fallback;
    });
    source.aiEnabled = false;
    return source;
  }

  function stableJsonValue(value) {
    if (Array.isArray(value)) return value.map(entry => stableJsonValue(entry));
    if (!value || typeof value !== 'object') return value;
    const sorted = {};
    Object.keys(value).sort().forEach(key => {
      const entry = value[key];
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') return;
      sorted[key] = stableJsonValue(entry);
    });
    return sorted;
  }

  function stableSnapshotText(value) {
    return JSON.stringify(stableJsonValue(value));
  }

  // Etapa 8 · Canonización de transporte RTDB.
  // Firebase Realtime Database NO conserva null como un valor de objeto: null
  // elimina la rama. Tampoco conserva colecciones vacías como una representación
  // distinguible de una rama ausente, y los arrays con huecos pueden regresar
  // como objetos de claves numéricas. El hash de Etapa 7 se calculaba sobre el
  // JSON previo a ese transporte; por eso una revisión válida podía regresar con
  // otro hash y era rechazada por ambos clientes.
  //
  // Esta proyección calcula la identidad del ESTADO LÓGICO, no de la forma
  // concreta que RTDB utiliza para almacenarlo. Se eliminan valores que RTDB no
  // puede preservar y los arrays se representan de forma dispersa con un marcador
  // explícito, conservando los índices que sí contienen información.
  const INTEGRITY_ABSENT = Symbol('rok-integrity-absent');

  function integrityJsonValue(value) {
    if (value === null || value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      return INTEGRITY_ABSENT;
    }
    if (Array.isArray(value)) {
      const items = {};
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) continue;
        const projected = integrityJsonValue(value[index]);
        if (projected === INTEGRITY_ABSENT) continue;
        items[String(index)] = projected;
      }
      if (!Object.keys(items).length) return INTEGRITY_ABSENT;
      return { __rokIndexed: items };
    }
    if (typeof value === 'object') {
      // Primero retiramos ramas que RTDB no puede conservar. Solo DESPUÉS
      // decidimos si el nodo restante es indexado; de lo contrario un objeto
      // {0: x, nombre: null} cambiaría de identidad al volver de Firebase.
      const projectedEntries = [];
      Object.keys(value).forEach(key => {
        const projected = integrityJsonValue(value[key]);
        if (projected === INTEGRITY_ABSENT) return;
        projectedEntries.push([key, projected]);
      });
      if (!projectedEntries.length) return INTEGRITY_ABSENT;

      // RTDB puede devolver un nodo indexado como Array o como objeto de claves
      // numéricas según su densidad. Para integridad de transporte ambas formas
      // son equivalentes porque RTDB no conserva esa distinción.
      if (projectedEntries.every(([key]) => /^\d+$/.test(key))) {
        const items = {};
        projectedEntries
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .forEach(([key, projected]) => { items[String(Number(key))] = projected; });
        return { __rokIndexed: items };
      }

      const sorted = {};
      projectedEntries
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([key, projected]) => { sorted[key] = projected; });
      return sorted;
    }
    return value;
  }

  function integritySnapshotText(value) {
    const projected = integrityJsonValue(value);
    return JSON.stringify(projected === INTEGRITY_ABSENT ? {} : projected);
  }

  function hashSnapshotText(text = '') {
    // FNV-1a 32-bit: no es una firma criptográfica; sirve para detectar
    // divergencias/corrupción accidental entre el payload escrito y leído.
    let hash = 0x811c9dc5;
    const value = String(text || '');
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  // Simulador deliberadamente conservador del round-trip de RTDB para la
  // prueba de diagnóstico. Representa arrays como objetos numéricos y elimina
  // null/colecciones vacías, que son precisamente las transformaciones que
  // pueden cambiar la forma JSON sin cambiar el estado lógico.
  function simulateRtdbRoundTripValue(value) {
    if (value === null || value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      return INTEGRITY_ABSENT;
    }
    if (Array.isArray(value)) {
      const out = {};
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) continue;
        const child = simulateRtdbRoundTripValue(value[index]);
        if (child === INTEGRITY_ABSENT) continue;
        out[String(index)] = child;
      }
      return Object.keys(out).length ? out : INTEGRITY_ABSENT;
    }
    if (typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(key => {
        const child = simulateRtdbRoundTripValue(value[key]);
        if (child === INTEGRITY_ABSENT) return;
        out[key] = child;
      });
      return Object.keys(out).length ? out : INTEGRITY_ABSENT;
    }
    return value;
  }

  function runTransportHashSelfTest() {
    try {
      const localPacket = makeBattleSnapshotPacket();
      if (!localPacket.snapshot || !localPacket.hash) return { ok: false, reason: 'snapshot-local-inválido' };
      const transported = simulateRtdbRoundTripValue(localPacket.snapshot);
      if (transported === INTEGRITY_ABSENT || !transported || typeof transported !== 'object') {
        return { ok: false, reason: 'snapshot-transportado-vacío' };
      }
      const normalized = normalizeAuthoritativeSnapshot(transported);
      const report = auditSnapshotSource(normalized, { repair: false });
      if (!report.ok) return { ok: false, reason: formatIntegrityIssue(report), report };
      const remoteText = snapshotText(normalized);
      const remoteHash = hashSnapshotText(remoteText);
      return {
        ok: localPacket.hash === remoteHash,
        hashVersion: ONLINE_SNAPSHOT_HASH_VERSION,
        localHash: localPacket.hash,
        transportedHash: remoteHash,
        localTextBytes: localPacket.text.length,
        transportedTextBytes: remoteText.length,
      };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  function runOnlineProtocolSelfTest() {
    const transport = runTransportHashSelfTest();
    const requiredSnapshotKeys = ['playStyle', 'realtime', 'players', 'gameOver', 'matchSerial'];
    const lobbyModeProbe = {
      hostUid: '__host__',
      guestUid: '__guest__',
      players: {
        __host__: { lobbyPlayStyle: 'realtime', loadout: { playStyle: 'manual' } },
        __guest__: { loadout: { playStyle: 'manual' } },
      },
    };
    const lobbyModeProbeResult = getLobbyPlayStyle(lobbyModeProbe);
    const synchronizedGuestProbe = withLobbyPlayStyle(lobbyModeProbe.players.__guest__.loadout, lobbyModeProbeResult);
    const checks = [
      {
        id: 'snapshot-contract',
        ok: requiredSnapshotKeys.every(key => SNAPSHOT_KEYS.includes(key)),
        detail: requiredSnapshotKeys.join(', '),
      },
      {
        id: 'realtime-command-contract',
        ok: ['caster-move', 'combat-mode', 'cast-card', 'thought-pause', 'spell-action-pause', 'progressive-recast', 'power-automation', 'power-arm']
          .every(type => REALTIME_COMMAND_TYPES.includes(type)),
        detail: `${REALTIME_COMMAND_TYPES.length} tipos permitidos`,
      },
      {
        id: 'single-realtime-authority',
        ok: typeof isRealtimeAuthority === 'function' && typeof window.ROK_REALTIME?.applyOnlineCommand === 'function',
        detail: 'Host/J1 publica; Invitado/J2 envía órdenes',
      },
      {
        id: 'single-lobby-play-style',
        ok: lobbyModeProbeResult === 'realtime'
          && synchronizedGuestProbe?.playStyle === 'realtime'
          && typeof changeLobbyPlayStyle === 'function'
          && typeof areLobbyPlayersReady === 'function',
        detail: `${lobbyModeProbeResult} → J2 ${synchronizedGuestProbe?.playStyle || 'sin modo'}`,
      },
      {
        id: 'transport-hash',
        ok: transport.ok === true,
        detail: transport.reason || `${transport.localHash || ''}/${transport.transportedHash || ''}`,
      },
    ];
    return {
      ok: checks.every(check => check.ok),
      schemaVersion: ONLINE_SNAPSHOT_SCHEMA_VERSION,
      hashVersion: ONLINE_SNAPSHOT_HASH_VERSION,
      commandMaxAgeMs: REALTIME_COMMAND_MAX_AGE_MS,
      commandMaxRevisionLag: REALTIME_COMMAND_MAX_REVISION_LAG,
      checks,
      transport,
    };
  }

  function auditSnapshotSource(source, options = {}) {
    try {
      const auditor = window.ROK_STATE_INTEGRITY?.audit;
      if (typeof auditor !== 'function') return { ok: true, issues: [], warnings: [] };
      return auditor(source, { repair: options.repair === true });
    } catch (error) {
      return { ok: false, issues: [{ code: 'integrity-audit-failed', path: 'state', detail: String(error?.message || error) }], warnings: [] };
    }
  }

  function formatIntegrityIssue(report) {
    const first = report?.issues?.[0];
    if (!first) return 'estado inválido';
    return `${first.code}${first.path ? ` @ ${first.path}` : ''}${first.detail ? ` · ${first.detail}` : ''}`;
  }

  function normalizeAuthoritativeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const copy = deepClone(snapshot);
    SNAPSHOT_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(copy, key)) return;
      const fallback = snapshotDefaultValue(key);
      if (fallback !== undefined) copy[key] = deepClone(fallback);
    });
    copy._schemaVersion = Math.max(1, Number(copy._schemaVersion || ONLINE_SNAPSHOT_SCHEMA_VERSION));
    copy.aiEnabled = false;
    copy.playStyle = normalizeOnlinePlayStyle(copy.playStyle);
    if (!copy.realtime || typeof copy.realtime !== 'object') copy.realtime = snapshotDefaultValue('realtime');
    if (typeof ensureRuntimeStateCollections === 'function') ensureRuntimeStateCollections(copy);
    if (!copy.openingExtractionSkippedByPlayer || typeof copy.openingExtractionSkippedByPlayer !== 'object') {
      copy.openingExtractionSkippedByPlayer = { 1: false, 2: false };
    } else {
      copy.openingExtractionSkippedByPlayer = {
        1: copy.openingExtractionSkippedByPlayer[1] === true,
        2: copy.openingExtractionSkippedByPlayer[2] === true,
      };
    }
    copy.openingElementsDealt = copy.openingElementsDealt === true;
    return copy;
  }

  function makeBattleSnapshotPacket() {
    // Primero normalizamos y auditamos el ESTADO LÓGICO que va a viajar. Un
    // valor no JSON-safe o una identidad duplicada no puede convertirse en el
    // estado autoritativo de la sala. El texto/hash usa la proyección canónica
    // de transporte para que escribir -> leer por RTDB sea idempotente.
    try {
      if (typeof ensureRuntimeStateCollections === 'function') ensureRuntimeStateCollections(state);
      const source = getBattleSnapshotSource();
      const repairedReport = auditSnapshotSource(source, { repair: true });
      if (!repairedReport.ok) {
        consistencyStats.rejectedOutgoing += 1;
        consistencyStats.lastIssue = formatIntegrityIssue(repairedReport);
        return { text: '', snapshot: null, hash: '', report: repairedReport, hashVersion: ONLINE_SNAPSHOT_HASH_VERSION };
      }
      const snapshot = normalizeAuthoritativeSnapshot(source);
      const report = auditSnapshotSource(snapshot, { repair: false });
      if (!report.ok) {
        consistencyStats.rejectedOutgoing += 1;
        consistencyStats.lastIssue = formatIntegrityIssue(report);
        return { text: '', snapshot: null, hash: '', report, hashVersion: ONLINE_SNAPSHOT_HASH_VERSION };
      }
      const text = integritySnapshotText(snapshot);
      consistencyStats.validatedOutgoing += 1;
      return { text, snapshot, hash: hashSnapshotText(text), report, hashVersion: ONLINE_SNAPSHOT_HASH_VERSION };
    } catch (error) {
      reportOnlineError(error, 'No se pudo serializar la partida');
      consistencyStats.rejectedOutgoing += 1;
      consistencyStats.lastIssue = String(error?.message || error);
      return { text: '', snapshot: null, hash: '', report: null, hashVersion: ONLINE_SNAPSHOT_HASH_VERSION };
    }
  }

  function makeBattleSnapshot() {
    return makeBattleSnapshotPacket().snapshot;
  }

  function snapshotText(snapshot) {
    try { return integritySnapshotText(snapshot); }
    catch (error) {
      reportOnlineError(error, 'No se pudo serializar la partida');
      return '';
    }
  }

  function validateIncomingAuthoritative(authoritative) {
    if (!authoritative?.snapshot || typeof authoritative.snapshot !== 'object') {
      return { ok: false, reason: 'snapshot ausente' };
    }
    const schemaVersion = Number(authoritative.schemaVersion || authoritative.snapshot?._schemaVersion || 0);
    if (schemaVersion > ONLINE_SNAPSHOT_SCHEMA_VERSION) {
      return { ok: false, reason: `schema ${schemaVersion} no soportado` };
    }
    const normalized = normalizeAuthoritativeSnapshot(authoritative.snapshot);
    if (!normalized) return { ok: false, reason: 'snapshot no normalizable' };
    const report = auditSnapshotSource(normalized, { repair: false });
    if (!report.ok) return { ok: false, reason: formatIntegrityIssue(report), report };
    const text = snapshotText(normalized);
    if (!text) return { ok: false, reason: 'snapshot no serializable', report };
    const hash = hashSnapshotText(text);
    const declaredHash = String(authoritative.snapshotHash || '');
    const hashVersion = Number(authoritative.hashVersion || 0);

    if (schemaVersion >= 5) {
      if (hashVersion !== ONLINE_SNAPSHOT_HASH_VERSION) {
        return { ok: false, reason: `hashVersion ${hashVersion || 'ausente'} no soportado`, report, hash, text, snapshot: normalized };
      }
      if (!declaredHash || declaredHash !== hash) {
        consistencyStats.hashMismatch += 1;
        return { ok: false, reason: `hash ${declaredHash || 'ausente'} != ${hash}`, report, hash, text, snapshot: normalized };
      }
    } else {
      // Migración de una sala creada antes de Etapa 8. El hash v1 se calculaba
      // antes del round-trip de RTDB y puede diferir aunque el estado sea válido.
      // Se audita el payload pero se deja que la próxima escritura lo convierta
      // al esquema/hash actual.
      consistencyStats.legacySnapshots += 1;
    }
    return { ok: true, report, hash, text, snapshot: normalized, schemaVersion, hashVersion: schemaVersion >= 5 ? hashVersion : 1 };
  }


  function flushBattleRender(reason = 'online-state') {
    try {
      if (typeof window.ROK_RENDER_ENGINE?.flush === 'function') {
        window.ROK_RENDER_ENGINE.flush(reason);
        return;
      }
      renderAll();
    } catch (_) {}
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
    const wasLocalStateReady = localStateReady;
    const previousMatchSerial = currentMatchSerial();
    const incomingMatchSerial = Math.max(1, Number(snapshot.matchSerial || 1));
    const matchChanged = incomingMatchSerial !== previousMatchSerial;
    if (matchChanged) {
      try { window.ROK_MATCH_LIFECYCLE?.prepareForIncomingOnlineReset?.(incomingMatchSerial); } catch (_) {}
      resetOnlineMatchEphemeralTracking({ cancelPendingInteractions: true });
    }
    const localHudMode = state.hudMode;
    const localSemiAutoMovement = state.semiAutoMovement;
    const localActiveTab = state.activeTab;
    const localRealtimeSelection = state.realtime?.combatModeSystem ? {
      selectedPlayerId: state.realtime.combatModeSystem.selectedPlayerId,
      selectedUnitId: state.realtime.combatModeSystem.selectedUnitId,
      selectedSpawnId: state.realtime.combatModeSystem.selectedSpawnId,
    } : null;

    applyingRemoteSnapshot = true;
    try {
      // Desacoplar el payload de Firebase una sola vez y repartir después sus
      // ramas. Evita decenas de clones JSON en cada revisión remota.
      const snapshotCopy = deepClone(snapshot);
      SNAPSHOT_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(snapshotCopy, key)) {
          state[key] = snapshotCopy[key];
          return;
        }
        // RTDB puede omitir null/[]/{}. Para los campos reseteables debemos
        // borrar explícitamente el valor local anterior, no conservarlo.
        const fallback = snapshotDefaultValue(key);
        if (fallback !== undefined) state[key] = fallback;
      });
      // RTDB elimina arreglos vacíos y puede devolver arreglos dispersos como
      // objetos numéricos. Reconstruirlos antes de cualquier render o fase.
      if (typeof ensureRuntimeStateCollections === 'function') {
        ensureRuntimeStateCollections(state);
      }
      state.hudMode = localHudMode;
      state.semiAutoMovement = localSemiAutoMovement;
      state.activeTab = localActiveTab;
      if (localRealtimeSelection && state.realtime?.combatModeSystem && Number(localRealtimeSelection.selectedPlayerId) === Number(LOCAL_PLAYER_ID)) {
        state.realtime.combatModeSystem.selectedPlayerId = localRealtimeSelection.selectedPlayerId;
        state.realtime.combatModeSystem.selectedUnitId = localRealtimeSelection.selectedUnitId || '';
        state.realtime.combatModeSystem.selectedSpawnId = localRealtimeSelection.selectedSpawnId || '';
      }
      // Esta respuesta llega dentro de una secuencia local que está esperando
      // al rival. No se limpian selectedMover/quickReactionWindow/candados: son
      // UI y resolvers locales que deben sobrevivir hasta que el flujo padre
      // continúe después de aplicar el resultado remoto.
      ROK_ONLINE_MATCH_ACTIVE = true;
      LOCAL_PLAYER_ID = playerSlot;
      mainMenuBattleStarted = true;
      lastKnownRevision = Math.max(lastKnownRevision, Number(revision || 0));
      lastSnapshotText = makeBattleSnapshotPacket().text;
      localStateReady = true;
      const openingSkip = state.openingExtractionSkippedByPlayer || {};
      const initialOpeningState = Boolean(state.openingElementsDealt)
        && Number(state.turnSerial || 1) <= 1
        && Number(state.phaseIndex || 0) === 0
        && openingSkip[1] !== true
        && openingSkip[2] !== true;
      // actionExecutionLock es runtime local y no forma parte de SNAPSHOT_KEYS.
      // La señal autoritativa de que aún estamos antes de la iniciativa es que
      // los elementos iniciales todavía no han sido repartidos.
      const awaitingInitiativeState = !state.openingElementsDealt && state.gameOver !== true;
      if (awaitingInitiativeState) {
        state.actionExecutionLock = true;
        state.actionExecutionLockReason = 'awaiting-initiative';
      }
      if ((!wasLocalStateReady || matchChanged) && initialOpeningState) {
        try { window.ROK_OPENING_ELEMENTS?.stage?.(); } catch (_) {}
      }
      showBattleScreen();
      flushBattleRender('remote-authoritative-snapshot');
      if (awaitingInitiativeState) {
        // announceOnlineMatchStarted tiene su propia compuerta sala+matchSerial,
        // por lo que es seguro invocarlo ante cada snapshot previo al reparto.
        try { window.ROK_MATCH_LIFECYCLE?.announceOnlineMatchStarted?.({ matchSerial: incomingMatchSerial, remote: true }); } catch (_) {}
      }
    } finally {
      applyingRemoteSnapshot = false;
    }

    const newPhaseKey = currentLocalPhaseKey();
    lastObservedPhaseKey = newPhaseKey;
    if (normalizeOnlinePlayStyle(state.playStyle) === 'realtime') {
      try { window.ROK_REALTIME?.resumeOnlineRuntime?.(); } catch (_) {}
      if (writerUid && writerUid !== uid) {
        turnHandoffPublishPending = false;
        try { window.ROK_DEBUG_RIBBON?.ok?.(`PvP Tiempo real sincronizado · revisión ${lastKnownRevision}`); } catch (_) {}
      }
      return true;
    }
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
    if (phaseDeliveryInFlightKey === key) phaseDeliveryInFlightKey = '';
    pendingPhaseDeliveryContext = null;
    clearPhaseDeliveryRetry();
  }

  function schedulePhaseDeliveryRetry(phaseKey, delayMs = 1200) {
    clearPhaseDeliveryRetry();
    phaseDeliveryRetryTimer = window.setTimeout(() => {
      phaseDeliveryRetryTimer = null;
      if (!ROK_ONLINE_MATCH_ACTIVE || state.gameOver) return;
      if (Number(state.activePlayer) !== Number(LOCAL_PLAYER_ID)) return;
      if (currentLocalPhaseKey() !== phaseKey || lastStartedPhaseKey === phaseKey) return;
      if (phaseDeliveryInFlightKey === phaseKey) return;
      phaseDeliveryScheduledKey = '';
      deliverRemotePhaseIfLocal({ force: true, announce: false, previousPhase: pendingPhaseDeliveryContext });
    }, Math.max(900, Number(delayMs || 0)));
  }

  function deliverRemotePhaseIfLocal(options = {}) {
    if (normalizeOnlinePlayStyle(state.playStyle) === 'realtime') return true;
    if (!ROK_ONLINE_MATCH_ACTIVE || Number(state.activePlayer) !== Number(LOCAL_PLAYER_ID) || state.gameOver) return false;
    if (!state.openingElementsDealt) return false;
    if (state.actionExecutionLock === true && ['awaiting-initiative', 'opening-intro'].includes(String(state.actionExecutionLockReason || ''))) return false;
    const phaseKey = currentLocalPhaseKey();
    if (!phaseKey || lastStartedPhaseKey === phaseKey) return true;
    if (phaseDeliveryInFlightKey === phaseKey && phaseDeliveryPromise) return false;
    if (!options.force && phaseDeliveryScheduledKey === phaseKey) return false;

    clearTimeout(schedulePhaseStartActions.timer);
    clearPhaseDeliveryRetry();
    phaseDeliveryScheduledKey = phaseKey;
    phaseDeliveryInFlightKey = phaseKey;

    const phase = currentPhase();
    const previous = options.previousPhase || pendingPhaseDeliveryContext || null;
    pendingPhaseDeliveryContext = previous;
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
        items.push(
          { text: 'TERMINA EL TURNO', playerId: Number(previous.activePlayer), duration: 950 },
          { text: `JUGADOR ${state.activePlayer}`, playerId: Number(state.activePlayer), duration: 900 },
          { text: 'EXTRACCIÓN', playerId: Number(state.activePlayer), duration: 900 },
        );
      } else {
        items.push({ text: String(phase?.label || 'FASE').toUpperCase(), playerId: Number(state.activePlayer), duration: 860 });
      }
      lastAnnouncedPhaseKey = phaseKey;
    }

    const transitionAnchor = typeof getTransitionAnchorPoint === 'function' ? getTransitionAnchorPoint() : undefined;
    let flowPromise;
    if (typeof schedulePhaseIntroFlow === 'function') {
      flowPromise = Promise.resolve(schedulePhaseIntroFlow(items, {
        allowOffTurnCasterReposition: castingToResolution,
        transitionAnchor,
        phaseKey,
        onlineDelivery: true,
      }));
    } else {
      if (items.length) queueTransitions(items, { anchor: transitionAnchor });
      flowPromise = new Promise(resolve => {
        schedulePhaseStartActions(items.length ? Math.max(0, sumTransitionDurations(items) - 120) : 80);
        window.setTimeout(resolve, items.length ? sumTransitionDurations(items) + 160 : 260);
      });
    }

    phaseDeliveryPromise = flowPromise
      .catch(error => {
        reportOnlineError(error, `No se pudo entregar la fase ${phaseKey}`);
        return false;
      })
      .finally(() => {
        if (phaseDeliveryInFlightKey === phaseKey) phaseDeliveryInFlightKey = '';
        if (phaseDeliveryScheduledKey === phaseKey) phaseDeliveryScheduledKey = '';
        phaseDeliveryPromise = null;
        if (ROK_ONLINE_MATCH_ACTIVE
          && !state.gameOver
          && Number(state.activePlayer) === Number(LOCAL_PLAYER_ID)
          && currentLocalPhaseKey() === phaseKey
          && lastStartedPhaseKey !== phaseKey) {
          schedulePhaseDeliveryRetry(phaseKey, 1200);
        }
      });
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
    if (LOCAL_FILE_TEST_MODE) {
      const notice = document.getElementById('mainMenuNotice');
      if (notice) {
        notice.textContent = 'Versus Online está desactivado en el modo de prueba local. Para Online abre R.O.K desde un dominio autorizado y entonces inicia sesión.';
        notice.classList.add('visible');
      }
      try { console.warn('[ROK] Versus Online bloqueado en modo de prueba local. Usa un dominio autorizado por Firebase para Online.'); } catch (_) {}
      return;
    }
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
    if (roomCode && !getAuthoritativeGameState(roomCache)?.snapshot) {
      await leaveRoom({ silent: true, keepMenu: true, returnToLobby: false });
    }
    closeLobby();
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
      uid = auth.currentUser && !auth.currentUser.isAnonymous ? String(auth.currentUser.uid || '') : '';
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
    reconnectCandidate = null;
  }

  function readSavedSession() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return null;
      const code = normalizeRoomCode(parsed.roomCode || '');
      const slot = Number(parsed.playerSlot || 0);
      const sessionUid = String(parsed.uid || '');
      if (!code || ![1, 2].includes(slot) || !sessionUid) return null;
      return { roomCode: code, playerSlot: slot, uid: sessionUid };
    } catch (_) { return null; }
  }

  function getServerNow() {
    return Date.now() + Number(firebaseServerTimeOffsetMs || 0);
  }

  function hideOpponentReconnectNotice() {
    clearInterval(opponentReconnectTimer);
    opponentReconnectTimer = null;
    opponentReconnectDeadline = 0;
    ui.reconnectNotice?.classList.remove('visible', 'expired');
    ui.reconnectNotice?.setAttribute('aria-hidden', 'true');
    try { releaseGlobalGameplayPause?.('online-opponent-disconnected'); } catch (_) {}
  }

  function finishMatchAfterReconnectTimeout(reason = 'timeout') {
    clearInterval(opponentReconnectTimer);
    opponentReconnectTimer = null;
    opponentReconnectDeadline = 0;
    try { releaseGlobalGameplayPause?.('online-opponent-disconnected'); } catch (_) {}
    setStatus(reason === 'left' ? 'El rival abandonó la partida.' : 'El rival no se reconectó dentro del tiempo permitido.', 'error');
    window.setTimeout(() => {
      try { exitMatchToMainMenu(); }
      catch (_) { try { showMainMenu(); } catch (_) {} }
    }, 900);
  }

  function showOpponentReconnectNotice(opponentRecord = null) {
    const disconnectedAt = Math.max(0, Number(opponentRecord?.lastSeenAt || getServerNow()));
    const deadline = disconnectedAt + RECONNECT_GRACE_MS;
    if (deadline <= getServerNow()) {
      finishMatchAfterReconnectTimeout('timeout');
      return;
    }
    opponentReconnectDeadline = deadline;
    ui.reconnectNotice?.classList.add('visible');
    ui.reconnectNotice?.classList.remove('expired');
    ui.reconnectNotice?.setAttribute('aria-hidden', 'false');
    if (ui.reconnectNoticeText) ui.reconnectNoticeText.textContent = 'El rival se ha desconectado. Esperando reconexión…';
    try { acquireGlobalGameplayPause?.('online-opponent-disconnected'); } catch (_) {}
    clearInterval(opponentReconnectTimer);
    const tick = () => {
      const remaining = Math.max(0, opponentReconnectDeadline - getServerNow());
      if (ui.reconnectSeconds) ui.reconnectSeconds.textContent = String(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        clearInterval(opponentReconnectTimer);
        opponentReconnectTimer = null;
        if (ui.reconnectNotice) ui.reconnectNotice.classList.add('expired');
        if (ui.reconnectNoticeText) ui.reconnectNoticeText.textContent = 'Tiempo de reconexión agotado. La partida terminará.';
        finishMatchAfterReconnectTimeout('timeout');
      }
    };
    tick();
    opponentReconnectTimer = window.setInterval(tick, 250);
  }

  function handleMatchPlayersPresence(players = {}) {
    if (!roomCode || !playerSlot || leavingRoom || !ROK_ONLINE_MATCH_ACTIVE) return;
    roomCache = roomCache && typeof roomCache === 'object' ? roomCache : {};
    roomCache.players = players || {};
    const opponentSlot = playerSlot === 1 ? 2 : 1;
    const opponent = getRoomPlayerRecord(roomCache, opponentSlot);
    if (!opponent) return;
    if (opponent.leftMatch === true) {
      hideOpponentReconnectNotice();
      if (ui.reconnectNotice) {
        ui.reconnectNotice.classList.add('visible', 'expired');
        ui.reconnectNotice.setAttribute('aria-hidden', 'false');
      }
      if (ui.reconnectNoticeText) ui.reconnectNoticeText.textContent = 'El rival abandonó la partida.';
      if (ui.reconnectSeconds) ui.reconnectSeconds.textContent = '0';
      finishMatchAfterReconnectTimeout('left');
      return;
    }
    if (opponent.connected === false) {
      showOpponentReconnectNotice(opponent);
      return;
    }
    hideOpponentReconnectNotice();
    if (ui.badgeText) ui.badgeText.textContent = `PVP conectado · J${playerSlot} · rev ${lastKnownRevision}`;
  }

  async function armPresenceForCurrentConnection(api, generation = roomSessionGeneration) {
    if (generation !== roomSessionGeneration || !roomPath || !uid || !playerSlot) return;
    const presenceRef = api.ref(db, `${roomPath}/players/${uid}`);
    if (presenceDisconnect) {
      try { await presenceDisconnect.cancel(); } catch (_) {}
      presenceDisconnect = null;
    }
    presenceDisconnect = api.onDisconnect(presenceRef);
    await presenceDisconnect.update({
      connected: false,
      lastSeenAt: api.serverTimestamp(),
    });
    await api.update(presenceRef, {
      uid,
      slot: playerSlot,
      connected: true,
      leftMatch: false,
      lastSeenAt: api.serverTimestamp(),
    });
  }

  function attachConnectionPresenceListener(api, generation = roomSessionGeneration) {
    if (connectionUnsubscribe) { try { connectionUnsubscribe(); } catch (_) {} connectionUnsubscribe = null; }
    connectionUnsubscribe = api.onValue(api.ref(db, '.info/connected'), snapshot => {
      if (generation !== roomSessionGeneration || snapshot.val() !== true || leavingRoom || !roomPath || !playerSlot) return;
      void armPresenceForCurrentConnection(api, generation).catch(error => {
        if (generation === roomSessionGeneration) reportOnlineError(error, 'No se pudo restaurar la presencia online');
      });
    });
  }

  async function getReconnectableSavedSession(api) {
    const saved = readSavedSession();
    if (!saved || !uid || saved.uid !== uid) return null;
    try {
      const snapshot = await api.get(api.ref(db, roomRefPath(saved.roomCode)));
      const room = snapshot.val();
      if (!room) { clearSession(); return null; }
      const expectedUid = getRoomPlayerUid(room, saved.playerSlot);
      const authoritative = getAuthoritativeGameState(room);
      const player = getRoomPlayerRecord(room, saved.playerSlot);
      if (expectedUid !== uid || !authoritative?.snapshot || !player || player.leftMatch === true) {
        clearSession();
        return null;
      }
      const lastSeen = Math.max(0, Number(player.lastSeenAt || 0));
      // Después de un refresh, RTDB puede tardar unos instantes en ejecutar
      // onDisconnect de la conexión anterior. Si todavía figura connected=true,
      // la sesión del mismo UID sigue siendo recuperable. El límite de 60 s se
      // aplica en cuanto Firebase confirma connected=false.
      if (player.connected === false && lastSeen && getServerNow() > lastSeen + RECONNECT_GRACE_MS) {
        clearSession();
        return null;
      }
      return { code: saved.roomCode, slot: saved.playerSlot, room, player };
    } catch (error) {
      if (!isPermissionDeniedError(error)) reportOnlineError(error, 'No se pudo revisar una partida para reconexión');
      return null;
    }
  }

  async function refreshReconnectCandidate(api = null) {
    const firebase = api || await loadFirebase();
    reconnectCandidate = await getReconnectableSavedSession(firebase);
    renderAvailableRooms();
    return reconnectCandidate;
  }

  async function reconnectSavedMatch() {
    if (!reconnectCandidate) {
      const api = await loadFirebase();
      reconnectCandidate = await getReconnectableSavedSession(api);
    }
    if (!reconnectCandidate) {
      setStatus('La ventana de reconexión ya no está disponible.', 'error');
      renderAvailableRooms();
      return false;
    }
    setLobbyBusy(true);
    try {
      await attachToRoom(reconnectCandidate.code, reconnectCandidate.slot);
      setStatus('Reconectando a la partida…', 'working');
      reconnectCandidate = null;
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo reconectar a la partida');
      setStatus(readableFirebaseError(error), 'error');
      return false;
    } finally {
      setLobbyBusy(false);
    }
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
        playerRecord.lobbyPlayStyle = 'manual';
        if (selectedLoadout && !getLoadoutIssue(selectedLoadout)) playerRecord.loadout = withLobbyPlayStyle(selectedLoadout, 'manual');
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

      // v9.88 · reservar el único cupo de invitado de forma atómica. Dos amigos
      // que pulsen Unirse al mismo tiempo ya no pueden sobrescribir guestUid ni
      // dejar un tercer registro huérfano dentro de players.
      const guestClaimRef = api.ref(db, `${targetPath}/guestUid`);
      const guestClaim = await api.runTransaction(guestClaimRef, current => {
        const currentUid = String(current || '');
        if (currentUid && currentUid !== uid) return;
        return uid;
      }, { applyLocally: false });
      if (!guestClaim.committed || String(guestClaim.snapshot?.val?.() || '') !== uid) {
        throw new Error('La partida ya tiene un segundo jugador.');
      }

      const claimedRoomSnapshot = await api.get(api.ref(db, targetPath));
      const claimedRoom = claimedRoomSnapshot.val();
      if (!claimedRoom?.hostUid || String(claimedRoom.hostUid) !== hostUid || !['open', 'full'].includes(String(claimedRoom.status || ''))) {
        await api.runTransaction(guestClaimRef, current => String(current || '') === uid ? null : undefined, { applyLocally: false });
        throw new Error('La partida ya no está disponible.');
      }
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
      const lobbyPlayStyle = getLobbyPlayStyle(claimedRoom);
      if (selectedLoadout && !getLoadoutIssue(selectedLoadout)) playerRecord.loadout = withLobbyPlayStyle(selectedLoadout, lobbyPlayStyle);
      try {
        await api.set(api.ref(db, `${targetPath}/players/${uid}`), playerRecord);
      } catch (error) {
        await api.runTransaction(guestClaimRef, current => String(current || '') === uid ? null : undefined, { applyLocally: false }).catch(() => {});
        throw error;
      }
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
    const generation = ++roomSessionGeneration;
    roomCode = normalizeRoomCode(code);
    roomPath = roomRefPath(roomCode);
    playerSlot = Number(slot);
    LOCAL_PLAYER_ID = playerSlot;
    ROK_ONLINE_MATCH_ACTIVE = true;
    state.aiEnabled = false;
    lastKnownRevision = 0;
    lastSnapshotText = '';
    lastAuthoritativeSnapshot = null;
    lastAuthoritativeSnapshotText = '';
    lastAuthoritativeSnapshotHash = '';
    lastObservedPhaseKey = '';
    lastStartedPhaseKey = '';
    phaseDeliveryScheduledKey = '';
    phaseDeliveryInFlightKey = '';
    phaseDeliveryPromise = null;
    lastAnnouncedPhaseKey = '';
    clearPhaseDeliveryRetry();
    turnHandoffPublishPending = false;
    localStateDirty = false;
    localStateReady = false;
    handledInteractionId = '';
    passiveConsistencySuspendUntil = 0;
    handledInteractionIds.clear();
    saveSession();

    try {
      await armPresenceForCurrentConnection(api, generation);
      attachConnectionPresenceListener(api, generation);
    } catch (_) {}

    // En lobby sí observamos la sala completa. Al comenzar el duelo este listener
    // se sustituye por canales pequeños para que un FX no vuelva a descargar toda la sala.
    roomUnsubscribe = api.onValue(api.ref(db, roomPath), snapshot => {
      if (generation !== roomSessionGeneration) return;
      void handleRoomValue(snapshot.val(), generation);
    }, error => {
      if (generation !== roomSessionGeneration) return;
      reportOnlineError(error, 'Se perdió la lectura de la sala');
      setStatus(readableFirebaseError(error), 'error');
    });
    void attachFxListener(api);
  }

  function updateRoomCacheGameAuthoritative(authoritative) {
    roomCache = roomCache && typeof roomCache === 'object' ? roomCache : {};
    roomCache.game = roomCache.game && typeof roomCache.game === 'object' ? roomCache.game : {};
    roomCache.game.authoritative = authoritative || null;
  }

  function handleAuthoritativeValue(authoritative, generation = roomSessionGeneration) {
    if (generation !== roomSessionGeneration || !authoritative?.snapshot || leavingRoom) return;
    const revision = Number(authoritative.revision || 0);
    if (!Number.isFinite(revision) || revision < 1) return;

    const validation = validateIncomingAuthoritative(authoritative);
    if (!validation.ok) {
      consistencyStats.rejectedIncoming += 1;
      consistencyStats.lastIssue = String(validation.reason || 'snapshot remoto inválido');
      reportOnlineError(new Error(`Revisión ${revision} rechazada: ${validation.reason || 'estado inválido'}.`), 'Estado PvP inconsistente');
      return;
    }
    consistencyStats.validatedIncoming += 1;

    const normalizedAuthoritative = {
      ...authoritative,
      schemaVersion: validation.schemaVersion || Number(authoritative.schemaVersion || 0),
      snapshot: validation.snapshot,
      snapshotHash: validation.hash,
      hashVersion: validation.hashVersion || ONLINE_SNAPSHOT_HASH_VERSION,
    };
    updateRoomCacheGameAuthoritative(normalizedAuthoritative);
    lastAuthoritativeSnapshot = deepClone(validation.snapshot);
    lastAuthoritativeSnapshotText = validation.text;
    lastAuthoritativeSnapshotHash = validation.hash;

    const writerUid = String(authoritative.writerUid || '');
    if (!localStateReady || (writerUid !== uid && revision > lastKnownRevision)) {
      applyBattleSnapshot(validation.snapshot, revision, writerUid);
    } else {
      lastKnownRevision = Math.max(lastKnownRevision, revision);
      // Una confirmación de nuestra propia escritura debe actualizar también
      // el texto base usado por el verificador pasivo.
      if (writerUid === uid && revision >= lastKnownRevision) lastSnapshotText = validation.text;
    }
    if (ui.badgeText) ui.badgeText.textContent = `PVP conectado · J${playerSlot} · rev ${lastKnownRevision}`;
    closeLobby();
    showBattleScreen();
    setStatus(`Partida activa · Jugador ${playerSlot}.`, 'ok');
  }

  function trimHandledInteractions() {
    if (handledInteractionIds.size <= 120) return;
    const keep = Array.from(handledInteractionIds).slice(-60);
    handledInteractionIds.clear();
    keep.forEach(id => handledInteractionIds.add(id));
  }

  function normalizeMatchControl(control = null) {
    const value = control && typeof control === 'object' ? control : {};
    return {
      serial: Math.max(1, Number(value.serial || currentMatchSerial() || 1)),
      status: String(value.status || (state.gameOver ? 'finished' : 'playing')),
      winnerPlayer: Number(value.winnerPlayer || 0),
      defeatedPlayer: Number(value.defeatedPlayer || 0),
      matchWins: value.matchWins && typeof value.matchWins === 'object'
        ? { 1: Number(value.matchWins[1] || 0), 2: Number(value.matchWins[2] || 0) }
        : { 1: Number(state.matchWins?.[1] || 0), 2: Number(state.matchWins?.[2] || 0) },
      rematchVotes: value.rematchVotes && typeof value.rematchVotes === 'object' ? value.rematchVotes : {},
      updatedAt: Number(value.updatedAt || 0),
    };
  }

  function hasValidRematchVote(control, slot) {
    const vote = control?.rematchVotes?.[slot];
    if (!vote || typeof vote !== 'object') return false;
    return Number(vote.player || 0) === Number(slot)
      && Number(vote.serial || 0) === Number(control.serial || 0)
      && Boolean(String(vote.uid || ''));
  }

  async function notifyMatchFinished(winnerPlayer, defeatedPlayer) {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot) return false;
    const serial = currentMatchSerial();
    // La derrota es una transición crítica: primero queda confirmada en el
    // snapshot autoritativo y después se abre el protocolo de revancha.
    try { await commitStateBarrier('match-finished'); } catch (_) {}
    try {
      const api = await loadFirebase();
      const controlRef = api.ref(db, matchControlPath());
      const result = await api.runTransaction(controlRef, current => {
        const existing = normalizeMatchControl(current);
        if (Number(existing.serial) > serial) return;
        if (Number(existing.serial) === serial && existing.status === 'starting') return;
        return {
          serial,
          status: 'finished',
          winnerPlayer: Number(winnerPlayer || 0),
          defeatedPlayer: Number(defeatedPlayer || 0),
          matchWins: {
            1: Number(state.matchWins?.[1] || 0),
            2: Number(state.matchWins?.[2] || 0),
          },
          rematchVotes: existing.status === 'finished' ? (current?.rematchVotes || null) : null,
          updatedAt: Date.now(),
        };
      }, { applyLocally: false });
      if (result.committed) await clearRemoteMatchEphemera(api);
      return Boolean(result.committed);
    } catch (error) {
      reportOnlineError(error, 'No se pudo cerrar el match online');
      return false;
    }
  }

  async function requestRematch() {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot) return false;
    const serial = currentMatchSerial();
    try {
      const api = await loadFirebase();
      const controlRef = api.ref(db, matchControlPath());
      const currentSnapshot = await api.get(controlRef);
      const control = normalizeMatchControl(currentSnapshot.val());
      if (Number(control.serial) !== serial || control.status !== 'finished') {
        throw new Error('La partida todavía no está cerrada para revancha.');
      }
      await api.set(api.ref(db, `${matchControlPath()}/rematchVotes/${playerSlot}`), {
        uid,
        player: Number(playerSlot),
        serial,
        requestedAt: Date.now(),
      });
      try { window.ROK_MATCH_LIFECYCLE?.setRematchButtonState?.('requesting', control); } catch (_) {}
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo solicitar la revancha');
      try { window.ROK_MATCH_LIFECYCLE?.setRematchButtonState?.('error'); } catch (_) {}
      return false;
    }
  }

  async function claimOnlineRematchAsHost(control) {
    if (playerSlot !== 1 || startingOnlineRematch || !roomPath) return false;
    const normalized = normalizeMatchControl(control);
    if (normalized.status !== 'finished') return false;
    if (!hasValidRematchVote(normalized, 1) || !hasValidRematchVote(normalized, 2)) return false;
    try {
      const api = await loadFirebase();
      let nextSerial = 0;
      const result = await api.runTransaction(api.ref(db, matchControlPath()), current => {
        const live = normalizeMatchControl(current);
        if (live.status !== 'finished') return;
        if (!hasValidRematchVote(live, 1) || !hasValidRematchVote(live, 2)) return;
        nextSerial = Math.max(1, Number(live.serial || 1)) + 1;
        return {
          serial: nextSerial,
          status: 'starting',
          winnerPlayer: Number(live.winnerPlayer || 0),
          defeatedPlayer: Number(live.defeatedPlayer || 0),
          matchWins: live.matchWins,
          rematchVotes: null,
          startedByUid: uid,
          updatedAt: Date.now(),
        };
      }, { applyLocally: false });
      if (!result.committed || !nextSerial) return false;
      await startOnlineRematchAsHost(nextSerial, normalized.matchWins);
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo coordinar la revancha');
      return false;
    }
  }

  async function startOnlineRematchAsHost(nextSerial, preservedWins = null) {
    if (startingOnlineRematch || playerSlot !== 1 || !roomPath) return false;
    startingOnlineRematch = true;
    localStateReady = false;
    try {
      try { await publishQueueTail; } catch (_) {}
      const api = await loadFirebase();
      await clearRemoteMatchEphemera(api);
      try { window.ROK_MATCH_LIFECYCLE?.prepareForIncomingOnlineReset?.(nextSerial); } catch (_) {}

      const wins = preservedWins && typeof preservedWins === 'object'
        ? { 1: Number(preservedWins[1] || 0), 2: Number(preservedWins[2] || 0) }
        : { 1: Number(state.matchWins?.[1] || 0), 2: Number(state.matchWins?.[2] || 0) };
      const resetOk = window.ROK_MATCH_LIFECYCLE?.resetStateForOnlineRematch?.({
        matchSerial: Math.max(2, Number(nextSerial || 2)),
        matchWins: wins,
      });
      if (resetOk === false) throw new Error('No se pudo reiniciar el estado local del host.');

      applyArenaToBattle(roomCache?.arenaId);
      const lobbyPlayStyle = getLobbyPlayStyle(roomCache);
      const hostLoadout = withLobbyPlayStyle(getRoomPlayerRecord(roomCache, 1)?.loadout, lobbyPlayStyle);
      const guestLoadout = withLobbyPlayStyle(getRoomPlayerRecord(roomCache, 2)?.loadout, lobbyPlayStyle);
      const hostIssue = getLoadoutIssue(hostLoadout);
      const guestIssue = getLoadoutIssue(guestLoadout);
      if (hostIssue || guestIssue) throw new Error(hostIssue || guestIssue || 'Falta un Spellbook válido para la revancha.');
      state.playStyle = lobbyPlayStyle;
      window.ROK_SPELLBOOK_MATCH?.applyLoadoutToPlayer?.(1, hostLoadout);
      window.ROK_SPELLBOOK_MATCH?.applyLoadoutToPlayer?.(2, guestLoadout);
      initializeElementDecks();
      state.gameOver = false;
      if (lobbyPlayStyle === 'realtime') {
        state.openingElementsDealt = true;
        state.actionExecutionLock = false;
        state.actionExecutionLockReason = '';
        window.ROK_REALTIME?.start?.();
      } else {
        state.openingElementsDealt = false;
        state.actionExecutionLock = true;
        state.actionExecutionLockReason = 'awaiting-initiative';
      }
      state.matchSerial = Math.max(2, Number(nextSerial || 2));
      state.matchWins = wins;
      state.aiEnabled = false;
      ROK_ONLINE_MATCH_ACTIVE = true;
      LOCAL_PLAYER_ID = 1;
      mainMenuBattleStarted = true;

      lastSnapshotText = '';
      lastObservedPhaseKey = currentLocalPhaseKey();
      lastStartedPhaseKey = '';
      phaseDeliveryScheduledKey = '';
      phaseDeliveryInFlightKey = '';
      phaseDeliveryPromise = null;
      lastAnnouncedPhaseKey = '';
      pendingPhaseDeliveryContext = null;
      clearPhaseDeliveryRetry();
      localStateDirty = false;
      localStateReady = false;
      showBattleScreen();
      flushBattleRender('online-rematch-reset');
      localStateReady = true;

      const committed = await publishSnapshot({
        force: true,
        status: 'playing',
        barrierReason: `rematch-start:${state.matchSerial}`,
      });
      if (!committed) throw new Error('Firebase no confirmó el estado inicial de la revancha.');

      const control = {
        serial: currentMatchSerial(),
        status: 'playing',
        winnerPlayer: 0,
        defeatedPlayer: 0,
        matchWins: wins,
        rematchVotes: null,
        updatedAt: Date.now(),
      };
      await api.set(api.ref(db, matchControlPath()), control);
      matchControlCache = control;
      startSyncLoop();
      try { window.ROK_MATCH_LIFECYCLE?.announceOnlineMatchStarted?.({ matchSerial: currentMatchSerial(), host: true }); } catch (_) {}
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo iniciar la revancha online');
      localStateReady = true;
      try {
        const api = await loadFirebase();
        await api.update(api.ref(db, matchControlPath()), { status: 'finished', updatedAt: Date.now() });
      } catch (_) {}
      return false;
    } finally {
      startingOnlineRematch = false;
    }
  }

  function handleMatchControlValue(rawControl) {
    if (!rawControl || leavingRoom) return;
    const control = normalizeMatchControl(rawControl);
    matchControlCache = control;
    try { window.ROK_MATCH_LIFECYCLE?.setRematchButtonState?.('', control); } catch (_) {}

    if (control.status === 'finished' && Number(control.serial) === currentMatchSerial()) {
      stopSyncLoop();
      localStateDirty = false;
      try { window.ROK_MATCH_LIFECYCLE?.showOnlineMatchFinished?.(control); } catch (_) {}
      if (playerSlot === 1) void claimOnlineRematchAsHost(control);
      return;
    }

    if (control.status === 'starting' && Number(control.serial) > currentMatchSerial()) {
      stopSyncLoop();
      localStateReady = false;
      try { window.ROK_MATCH_LIFECYCLE?.prepareForIncomingOnlineReset?.(control.serial); } catch (_) {}
      if (playerSlot === 1) void startOnlineRematchAsHost(control.serial, control.matchWins);
      return;
    }

    if (control.status === 'playing' && Number(control.serial) === currentMatchSerial() && localStateReady) {
      startSyncLoop();
    }
  }

  function trimHandledRealtimeCommands() {
    if (handledRealtimeCommandIds.size <= 160) return;
    const keep = Array.from(handledRealtimeCommandIds).slice(-80);
    handledRealtimeCommandIds.clear();
    keep.forEach(id => handledRealtimeCommandIds.add(id));
  }

  async function sendRealtimeCommand(type, payload = {}) {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot || !isRealtimeOnlineMatch()) return false;
    const safeType = String(type || '');
    if (!REALTIME_COMMAND_TYPES.includes(safeType) || state.gameOver) return false;
    if (Number(playerSlot) === 1) return false;
    const opponent = getRoomPlayerRecord(roomCache, 1);
    if (opponent?.connected === false || opponent?.leftMatch === true) return false;
    try {
      const api = await loadFirebase();
      const commandRef = api.push(api.ref(db, realtimeCommandsPath()));
      const id = String(commandRef.key || `rtcmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      await api.set(commandRef, {
        id, type: safeType, player: Number(playerSlot), uid,
        matchSerial: currentMatchSerial(), baseRevision: Math.max(0, Number(lastKnownRevision || 0)),
        payload: deepClone(payload || {}), createdAt: api.serverTimestamp(),
      });
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo enviar la orden de Tiempo real');
      return false;
    }
  }

  async function handleRealtimeCommand(rawCommand, key = '') {
    if (!isRealtimeAuthority() || leavingRoom || !roomPath) return false;
    const command = rawCommand && typeof rawCommand === 'object' ? { ...rawCommand } : null;
    if (!command) return false;
    const id = String(command.id || key || '');
    if (!id || handledRealtimeCommandIds.has(id)) return false;
    realtimeCommandStats.received += 1;

    // Toda orden ya observada se retira del buzón, incluso si quedó obsoleta o
    // no supera la validación. Así una desconexión no vuelve a reproducir una
    // pulsación WASD/kasteo inválido de un match anterior.
    const discardCommand = async () => {
      try {
        const api = await loadFirebase();
        await api.remove(api.ref(db, `${realtimeCommandsPath()}/${id}`));
      } catch (_) {}
    };

    const validMatch = Math.max(1, Number(command.matchSerial || 1)) === currentMatchSerial();
    const validPlayer = Number(command.player || 0) === 2;
    const guestUid = String(roomCache?.guestUid || '');
    const validUid = Boolean(guestUid) && String(command.uid || '') === guestUid;
    const commandType = String(command.type || '');
    const validType = REALTIME_COMMAND_TYPES.includes(commandType);
    const createdAt = Number(command.createdAt || 0);
    const commandAge = createdAt ? getServerNow() - createdAt : Infinity;
    const validFreshness = Number.isFinite(commandAge)
      && commandAge >= -REALTIME_COMMAND_MAX_FUTURE_SKEW_MS
      && commandAge <= REALTIME_COMMAND_MAX_AGE_MS;
    const baseRevision = Math.max(0, Number(command.baseRevision || 0));
    const revisionLag = Math.max(0, Number(lastKnownRevision || 0) - baseRevision);
    const validRevision = baseRevision <= Math.max(0, Number(lastKnownRevision || 0))
      && revisionLag <= REALTIME_COMMAND_MAX_REVISION_LAG;
    if (!validMatch || !validPlayer || !validUid || !validType || !validFreshness || !validRevision) {
      if (!validMatch) realtimeCommandStats.rejectedMatch += 1;
      else if (!validPlayer || !validUid) realtimeCommandStats.rejectedIdentity += 1;
      else if (!validType) realtimeCommandStats.rejectedPayload += 1;
      else if (!validFreshness) realtimeCommandStats.rejectedStale += 1;
      else if (!validRevision) realtimeCommandStats.rejectedRevision += 1;
      handledRealtimeCommandIds.add(id);
      trimHandledRealtimeCommands();
      await discardCommand();
      return false;
    }

    handledRealtimeCommandIds.add(id);
    trimHandledRealtimeCommands();
    try {
      const applied = await Promise.resolve(window.ROK_REALTIME?.applyOnlineCommand?.(deepClone(command)));
      // WASD puede llegar varias veces por segundo. applyOnlineCommand ya marca
      // dirty y el sincronizador publica con debounce de 90 ms; forzar una
      // transacción por tecla serializaría el movimiento detrás de la latencia.
      // Kasteos y cambios de modo sí usan barrera inmediata por ser decisiones
      // discretas de alto valor.
      if (applied && String(command.type || '') !== 'caster-move') {
        await commitStateBarrier(`realtime-command:${command.type || 'unknown'}`);
      }
      if (applied) realtimeCommandStats.applied += 1;
      else realtimeCommandStats.rejectedPayload += 1;
      await discardCommand();
      return Boolean(applied);
    } catch (error) {
      void discardCommand();
      reportOnlineError(error, `No se pudo aplicar la orden RT ${command.type || ''}`);
      return false;
    }
  }

  function attachMatchListeners(api, generation = roomSessionGeneration) {
    if (!roomPath || generation !== roomSessionGeneration) return;
    if (roomUnsubscribe) {
      try { roomUnsubscribe(); } catch (_) {}
      roomUnsubscribe = null;
    }
    if (!authoritativeUnsubscribe) {
      authoritativeUnsubscribe = api.onValue(api.ref(db, authoritativeGamePath()), snapshot => {
        if (generation !== roomSessionGeneration) return;
        handleAuthoritativeValue(snapshot.val(), generation);
      }, error => { if (generation === roomSessionGeneration) reportOnlineError(error, 'Se perdió el canal autoritativo de la partida'); });
    }
    if (!interactionUnsubscribe) {
      interactionUnsubscribe = api.onChildAdded(api.ref(db, interactionsPath()), snapshot => {
        if (generation !== roomSessionGeneration) return;
        const interaction = snapshot.val();
        if (!interaction || String(interaction.id || snapshot.key || '') === '') return;
        void handleIncomingInteraction({ ...interaction, id: String(interaction.id || snapshot.key || '') });
      }, error => reportOnlineError(error, 'Se perdió el canal de ventanas de acción'));
    }
    if (!realtimeCommandUnsubscribe) {
      realtimeCommandUnsubscribe = api.onChildAdded(api.ref(db, realtimeCommandsPath()), snapshot => {
        if (generation !== roomSessionGeneration || Number(playerSlot) !== 1) return;
        const command = snapshot.val();
        if (!command) return;
        const run = () => handleRealtimeCommand(command, snapshot.key || '');
        realtimeCommandTail = realtimeCommandTail.then(run, run);
      }, error => reportOnlineError(error, 'Se perdió el canal de órdenes de Tiempo real'));
    }
    if (!priorityActionUnsubscribe) {
      priorityActionUnsubscribe = api.onValue(api.ref(db, `${roomPath}/game/priorityAction`), snapshot => {
        if (generation !== roomSessionGeneration) return;
        handleIncomingPriorityAction(snapshot.val() || null);
      }, error => reportOnlineError(error, 'Se perdió el canal de acciones prioritarias'));
    }
    if (!matchPlayersUnsubscribe) {
      matchPlayersUnsubscribe = api.onValue(api.ref(db, `${roomPath}/players`), snapshot => {
        if (generation !== roomSessionGeneration) return;
        handleMatchPlayersPresence(snapshot.val() || {});
      });
    }
    if (!matchStatusUnsubscribe) {
      matchStatusUnsubscribe = api.onValue(api.ref(db, `${roomPath}/status`), snapshot => {
        if (generation !== roomSessionGeneration) return;
        roomCache = roomCache && typeof roomCache === 'object' ? roomCache : {};
        roomCache.status = snapshot.val() || roomCache.status || 'playing';
      });
    }
    if (!matchControlUnsubscribe) {
      matchControlUnsubscribe = api.onValue(api.ref(db, matchControlPath()), snapshot => {
        if (generation !== roomSessionGeneration) return;
        handleMatchControlValue(snapshot.val());
      }, error => reportOnlineError(error, 'Se perdió el control de revancha'));
    }
    startSyncLoop();
  }

  async function handleRoomValue(room, generation = roomSessionGeneration) {
    if (generation !== roomSessionGeneration) return;
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

    const authoritative = getAuthoritativeGameState(room);
    if (!authoritative?.snapshot) {
      void configureLobbyDisconnects(room);
      showWaitingRoom();
      renderRoomLobby(room);
      if (playerSlot === 1) void reconcileLobbyAsHost(room);

      const bothConnected = Boolean(room.guestUid && p1?.connected && p2?.connected);
      const bothReady = areLobbyPlayersReady(room);

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
        setLobbyOverlayVisibleForMatchIntro(true);
        if (!room.guestUid) setStatus('Lobby abierto. Esperando que uno de tus amigos se una.', 'working');
        else if (!bothConnected) setStatus('El segundo jugador está en el lobby, pero todavía no terminó de conectar.', 'working');
        else if (!p1?.loadout || !p2?.loadout) setStatus('Ambos están conectados. Falta seleccionar uno o más Spellbooks.', 'working');
        else if (!p1?.ready || !p2?.ready) setStatus('Configuración lista. Ambos jugadores deben pulsar LISTO.', 'working');
        else setStatus('Preparando cuenta regresiva…', 'working');
      }
      return;
    }

    stopLobbyCountdown();
    void cancelLobbyDisconnects();
    handleAuthoritativeValue(authoritative, generation);
    const api = await loadFirebase();
    if (generation !== roomSessionGeneration || leavingRoom) return;
    attachMatchListeners(api, generation);
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
      state.matchSerial = 1;
      LOCAL_PLAYER_ID = 1;
      ROK_ONLINE_MATCH_ACTIVE = true;
      mainMenuBattleStarted = true;
      const hostRecord = getRoomPlayerRecord(roomCache, 1);
      const guestRecord = getRoomPlayerRecord(roomCache, 2);
      const lobbyPlayStyle = getLobbyPlayStyle(roomCache);
      const hostLoadout = withLobbyPlayStyle(hostRecord?.loadout, lobbyPlayStyle);
      const guestLoadout = withLobbyPlayStyle(guestRecord?.loadout, lobbyPlayStyle);
      const hostIssue = getLoadoutIssue(hostLoadout);
      const guestIssue = getLoadoutIssue(guestLoadout);
      if (hostIssue || guestIssue) throw new Error(hostIssue || guestIssue || 'Falta un Spellbook válido.');
      state.playStyle = lobbyPlayStyle;
      window.ROK_SPELLBOOK_MATCH?.applyLoadoutToPlayer?.(1, hostLoadout);
      window.ROK_SPELLBOOK_MATCH?.applyLoadoutToPlayer?.(2, guestLoadout);
      initializeElementDecks();
      if (lobbyPlayStyle === 'realtime') {
        state.openingElementsDealt = true;
        state.actionExecutionLock = false;
        state.actionExecutionLockReason = '';
        window.ROK_REALTIME?.start?.();
      } else {
        state.openingElementsDealt = false;
        state.actionExecutionLock = true;
        state.actionExecutionLockReason = 'awaiting-initiative';
      }
      localStateReady = false;
      lastObservedPhaseKey = currentLocalPhaseKey();
      lastStartedPhaseKey = '';
      phaseDeliveryScheduledKey = '';
      phaseDeliveryInFlightKey = '';
      phaseDeliveryPromise = null;
      lastAnnouncedPhaseKey = '';
      pendingPhaseDeliveryContext = null;
      clearPhaseDeliveryRetry();
      showBattleScreen();
      flushBattleRender('online-match-start');
      localStateReady = true;
      await cancelLobbyDisconnects();
      await publishSnapshot({ force: true, status: 'playing', barrierReason: 'match-start' });
      try {
        const api = await loadFirebase();
        await api.set(api.ref(db, matchControlPath()), {
          serial: currentMatchSerial(),
          status: 'playing',
          rematchVotes: null,
          updatedAt: Date.now(),
        });
        matchControlCache = { serial: currentMatchSerial(), status: 'playing', rematchVotes: null, updatedAt: Date.now() };
        await removeOpenRoomListing(api, roomCode, uid);
      } catch (_) {}
      closeLobby();
      try {
        window.ROK_MATCH_LIFECYCLE?.announceOnlineMatchStarted?.({ matchSerial: currentMatchSerial(), host: true });
      } catch (_) {}
    } catch (error) {
      reportOnlineError(error, 'No se pudo iniciar la batalla online');
      setStatus(readableFirebaseError(error), 'error');
    } finally {
      startingOnlineBattle = false;
      if (!getAuthoritativeGameState(roomCache)?.snapshot) setStartButtonVisible(true, false);
    }
  }

  function verifyPassiveClientConsistency(options = {}) {
    if (!ROK_ONLINE_MATCH_ACTIVE || !localStateReady || leavingRoom || applyingRemoteSnapshot) return true;
    if (!lastAuthoritativeSnapshot || !lastAuthoritativeSnapshotText) return true;
    if (isRealtimeOnlineMatch()) return true;
    if (Number(state.activePlayer) === Number(LOCAL_PLAYER_ID)) return true;
    if (handledInteractionId || Date.now() < passiveConsistencySuspendUntil) return true;
    consistencyStats.passiveChecks += 1;

    const packet = makeBattleSnapshotPacket();
    if (!packet.snapshot || !packet.text) return false;
    if (packet.text === lastAuthoritativeSnapshotText) return true;

    consistencyStats.lastIssue = `desviación pasiva rev ${lastKnownRevision}: local ${packet.hash} / autoridad ${lastAuthoritativeSnapshotHash}`;
    if (options.repair === false) return false;

    // Fuera de nuestro turno no debemos conservar mutaciones lógicas propias.
    // Si no estamos resolviendo una interacción solicitada por el rival, la
    // copia autoritativa confirmada por Firebase reemplaza cualquier deriva.
    consistencyStats.passiveRepairs += 1;
    try {
      applyBattleSnapshot(deepClone(lastAuthoritativeSnapshot), lastKnownRevision, '__consistency_repair__');
      try { window.ROK_DEBUG_RIBBON?.ok?.(`PvP reparó una divergencia local · rev ${lastKnownRevision}`); } catch (_) {}
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo reparar una divergencia PvP');
      return false;
    }
  }


  async function prepareInitiativeRound(round = 1, matchSerial = currentMatchSerial()) {
    if (!roomPath || !uid || !playerSlot || leavingRoom) return false;
    try {
      const api = await loadFirebase();
      await api.update(api.ref(db, `${roomPath}/players/${uid}`), {
        initiativeChoice: null,
        initiativeRound: Math.max(1, Number(round || 1)),
        initiativeMatchSerial: Math.max(1, Number(matchSerial || currentMatchSerial() || 1)),
        initiativeChosenAt: null,
      });
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo preparar Piedra/Papel/Tijera');
      return false;
    }
  }

  async function submitInitiativeChoice(choice = '', round = 1, matchSerial = currentMatchSerial()) {
    const safeChoice = String(choice || '');
    if (!['rock', 'paper', 'scissors'].includes(safeChoice)) return false;
    if (!roomPath || !uid || !playerSlot || leavingRoom) return false;
    try {
      const api = await loadFirebase();
      await api.update(api.ref(db, `${roomPath}/players/${uid}`), {
        initiativeChoice: safeChoice,
        initiativeRound: Math.max(1, Number(round || 1)),
        initiativeMatchSerial: Math.max(1, Number(matchSerial || currentMatchSerial() || 1)),
        initiativeChosenAt: api.serverTimestamp(),
      });
      return true;
    } catch (error) {
      reportOnlineError(error, 'No se pudo registrar Piedra/Papel/Tijera');
      return false;
    }
  }

  function getInitiativeState(round = 1, matchSerial = currentMatchSerial()) {
    const targetRound = Math.max(1, Number(round || 1));
    const targetSerial = Math.max(1, Number(matchSerial || currentMatchSerial() || 1));
    const p1 = getRoomPlayerRecord(roomCache, 1) || {};
    const p2 = getRoomPlayerRecord(roomCache, 2) || {};
    const readChoice = record => {
      if (Number(record?.initiativeRound || 0) !== targetRound) return '';
      if (Number(record?.initiativeMatchSerial || 0) !== targetSerial) return '';
      const choice = String(record?.initiativeChoice || '');
      return ['rock', 'paper', 'scissors'].includes(choice) ? choice : '';
    };
    return {
      round: targetRound,
      matchSerial: targetSerial,
      player1Choice: readChoice(p1),
      player2Choice: readChoice(p2),
    };
  }

  function startSyncLoop() {
    stopSyncLoop();
    syncTimer = window.setInterval(() => {
      // Watchdog de baja frecuencia: solo como red de seguridad para una
      // mutación que no haya emitido dirty. La ruta normal no serializa aquí.
      void considerPublishingLocalState({ watchdog: true });
    }, SYNC_WATCHDOG_MS);
  }

  function stopSyncLoop() {
    if (syncTimer) window.clearInterval(syncTimer);
    syncTimer = null;
    if (publishTimer) window.clearTimeout(publishTimer);
    publishTimer = null;
    localStateDirty = false;
  }

    function markTurnHandoffPending() {
    if (!ROK_ONLINE_MATCH_ACTIVE) return;
    turnHandoffPublishPending = true;
    localStateDirty = true;
    localMutationSerial += 1;
    void commitStateBarrier('turn-handoff');
  }

  function scheduleDirtyPublish(delay = SYNC_DEBOUNCE_MS) {
    if (publishTimer) window.clearTimeout(publishTimer);
    publishTimer = window.setTimeout(() => {
      publishTimer = null;
      void considerPublishingLocalState();
    }, Math.max(0, Number(delay || 0)));
  }

  function markLocalStateDirty(reason = 'state-change') {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomCode || !localStateReady || applyingRemoteSnapshot || leavingRoom) return false;
    const realtimeAuthority = isRealtimeAuthority();
    const ownsTurn = Number(state.activePlayer) === Number(LOCAL_PLAYER_ID);
    if (isRealtimeOnlineMatch() && !realtimeAuthority) return false;
    if (!realtimeAuthority && !ownsTurn && !turnHandoffPublishPending) return false;
    localStateDirty = true;
    localMutationSerial += 1;
    scheduleDirtyPublish();
    return true;
  }

  async function considerPublishingLocalState(options = {}) {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomCode || !localStateReady || applyingRemoteSnapshot || leavingRoom) return false;
    const realtimeAuthority = isRealtimeAuthority();
    const ownsTurn = Number(state.activePlayer) === Number(LOCAL_PLAYER_ID);
    if (isRealtimeOnlineMatch() && !realtimeAuthority) {
      if (options.watchdog) verifyPassiveClientConsistency({ repair: true });
      return false;
    }
    if (!realtimeAuthority && !ownsTurn && !turnHandoffPublishPending) {
      if (options.watchdog) verifyPassiveClientConsistency({ repair: true });
      return false;
    }
    // La ruta normal solo serializa cuando existe una mutación marcada. El
    // watchdog conserva una comprobación periódica para código legado que aún
    // no haya pasado por el marcador de estado.
    if (!localStateDirty && !turnHandoffPublishPending && !options.watchdog) return true;
    const packet = makeBattleSnapshotPacket();
    const nextSnapshot = packet.snapshot;
    const nextText = packet.text;
    if (!nextSnapshot || !nextText) return false;
    if (nextText === lastSnapshotText) {
      localStateDirty = false;
      lastPublishedMutationSerial = localMutationSerial;
      return true;
    }
    const committed = await publishSnapshot({ snapshot: nextSnapshot, snapshotTextValue: nextText });
    if (committed) {
      localStateDirty = localMutationSerial !== lastPublishedMutationSerial;
      if (localStateDirty) scheduleDirtyPublish();
    }
    return committed;
  }

  async function performPublishSnapshot(options = {}) {
    if (isRealtimeOnlineMatch() && !isRealtimeAuthority()) return false;
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot || applyingRemoteSnapshot || leavingRoom) return false;
    publishingSnapshot = true;
    try {
      const api = await loadFirebase();
      let nextSnapshot = options.snapshot || null;
      let nextText = options.snapshotTextValue || '';
      let nextHash = options.snapshotHashValue || '';
      if (!nextSnapshot) {
        const packet = makeBattleSnapshotPacket();
        nextSnapshot = packet.snapshot;
        nextText = packet.text;
        nextHash = packet.hash;
      } else {
        nextSnapshot = normalizeAuthoritativeSnapshot(nextSnapshot);
        const report = auditSnapshotSource(nextSnapshot, { repair: false });
        if (!report.ok) {
          consistencyStats.rejectedOutgoing += 1;
          consistencyStats.lastIssue = formatIntegrityIssue(report);
          reportOnlineError(new Error(consistencyStats.lastIssue), 'Estado PvP local inválido');
          return false;
        }
        if (!nextText) nextText = snapshotText(nextSnapshot);
        if (!nextHash) nextHash = hashSnapshotText(nextText);
      }
      const snapshotMutationSerial = localMutationSerial;
      if (!nextSnapshot || !nextText || !nextHash) return false;
      if (!options.force && nextText === lastSnapshotText) {
        lastPublishedMutationSerial = snapshotMutationSerial;
        localStateDirty = false;
        return true;
      }
      const gameRef = api.ref(db, authoritativeGamePath());
      let committedRevision = 0;
      const result = await api.runTransaction(gameRef, current => {
        const currentRevision = Number(current?.revision || 0);
        const currentWriter = String(current?.writerUid || '');
        // Nunca pisar silenciosamente una revisión del rival que todavía no hemos aplicado.
        if (currentRevision > lastKnownRevision && currentWriter && currentWriter !== uid) return;
        committedRevision = currentRevision + 1;
        return {
          revision: committedRevision,
          parentRevision: currentRevision,
          writerUid: uid,
          writerPlayer: playerSlot,
          phaseKey: phaseKeyFromSnapshot(nextSnapshot),
          matchSerial: Math.max(1, Number(nextSnapshot.matchSerial || 1)),
          schemaVersion: ONLINE_SNAPSHOT_SCHEMA_VERSION,
          hashVersion: ONLINE_SNAPSHOT_HASH_VERSION,
          snapshotHash: nextHash,
          snapshot: nextSnapshot,
          updatedAt: Date.now(),
          barrier: options.barrierReason ? String(options.barrierReason) : null,
        };
      }, { applyLocally: false });
      if (!result.committed) {
        // Forzar una lectura rápida permite aplicar la revisión rival y reintentar por la ruta normal.
        try {
          const latest = await api.get(gameRef);
          const value = latest.val();
          if (value?.snapshot) handleAuthoritativeValue(value);
        } catch (_) {}
        return false;
      }
      lastKnownRevision = Math.max(lastKnownRevision, committedRevision);
      lastSnapshotText = nextText;
      lastAuthoritativeSnapshot = deepClone(nextSnapshot);
      lastAuthoritativeSnapshotText = nextText;
      lastAuthoritativeSnapshotHash = nextHash;
      lastPublishedMutationSerial = snapshotMutationSerial;
      lastObservedPhaseKey = phaseKeyFromSnapshot(nextSnapshot) || lastObservedPhaseKey;
      if (turnHandoffPublishPending && Number(nextSnapshot.activePlayer) !== Number(LOCAL_PLAYER_ID)) {
        turnHandoffPublishPending = false;
      }
      if (options.status && playerSlot === 1 && ['waiting', 'ready', 'playing', 'finished'].includes(options.status)) {
        await api.set(api.ref(db, `${roomPath}/status`), options.status);
      }
      return true;
    } catch (error) {
      reportOnlineError(error, 'Error al guardar el estado PvP');
      return false;
    } finally {
      publishingSnapshot = false;
    }
  }

  function publishSnapshot(options = {}) {
    const request = { ...options };
    const run = () => performPublishSnapshot(request);
    publishQueueTail = publishQueueTail.then(run, run);
    return publishQueueTail;
  }

  function commitStateBarrier(reason = 'critical-state') {
    if (isRealtimeOnlineMatch() && !isRealtimeAuthority()) return Promise.resolve(false);
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !localStateReady) return Promise.resolve(false);
    if (publishTimer) {
      window.clearTimeout(publishTimer);
      publishTimer = null;
    }
    localStateDirty = true;
    localMutationSerial += 1;
    return publishSnapshot({ force: true, barrierReason: reason }).then(committed => {
      if (committed) {
        localStateDirty = localMutationSerial !== lastPublishedMutationSerial;
        if (localStateDirty) scheduleDirtyPublish();
      }
      return committed;
    });
  }


  function clearNetworkCleanupTimers() {
    networkCleanupTimers.forEach(timer => { try { window.clearTimeout(timer); } catch (_) {} });
    networkCleanupTimers.clear();
    if (fxCleanupTimer) { try { window.clearTimeout(fxCleanupTimer); } catch (_) {} }
    fxCleanupTimer = null;
    pendingFxCleanupEntries.clear();
  }

  function scheduleFxCleanupSweep() {
    if (fxCleanupTimer) return;
    const run = async () => {
      fxCleanupTimer = null;
      if (!pendingFxCleanupEntries.size) return;
      const now = Date.now();
      const due = [];
      let nextAt = Infinity;
      pendingFxCleanupEntries.forEach((entry, id) => {
        if (Number(entry.deleteAfter || 0) <= now) due.push([id, entry]);
        else nextAt = Math.min(nextAt, Number(entry.deleteAfter || 0));
      });
      if (due.length) {
        try {
          const api = await loadFirebase();
          await Promise.allSettled(due.map(([id, entry]) => api.remove(api.ref(db, `${entry.roomPath}/game/fxEvents/${id}`))));
        } catch (_) {}
        due.forEach(([id]) => pendingFxCleanupEntries.delete(id));
      }
      if (pendingFxCleanupEntries.size) {
        const wait = Number.isFinite(nextAt) ? Math.max(250, nextAt - Date.now()) : ONLINE_FX_RETENTION_MS;
        fxCleanupTimer = window.setTimeout(run, wait);
      }
    };
    let nextAt = Infinity;
    pendingFxCleanupEntries.forEach(entry => { nextAt = Math.min(nextAt, Number(entry.deleteAfter || 0)); });
    const wait = Number.isFinite(nextAt) ? Math.max(250, nextAt - Date.now()) : ONLINE_FX_RETENTION_MS;
    fxCleanupTimer = window.setTimeout(run, wait);
  }

  function queueFxCleanup(roomPathValue, id) {
    if (!roomPathValue || !id) return;
    pendingFxCleanupEntries.set(String(id), { roomPath: String(roomPathValue), deleteAfter: Date.now() + ONLINE_FX_RETENTION_MS });
    scheduleFxCleanupSweep();
  }

  function cancelPendingInteractionWaits() {
    const aborters = Array.from(pendingInteractionAborters);
    pendingInteractionAborters.clear();
    aborters.forEach(abort => { try { abort(); } catch (_) {} });
  }

  function resetOnlineMatchEphemeralTracking(options = {}) {
    clearNetworkCleanupTimers();
    if (options.cancelPendingInteractions !== false) cancelPendingInteractionWaits();
    handledFxEventIds.clear();
    lastFxSequenceByAuthor.clear();
    outboundFxPublishTail = Promise.resolve(true);
    outboundFxSequence = 0;
    activeParallelFxPlaybacks.clear();
    handledInteractionId = '';
    handledInteractionIds.clear();
    fxPlaybackGeneration += 1;
    remoteFxPlaybackTail = Promise.resolve();
    fxListenerStartedAt = Date.now();
    try { window.ROK_PRIORITY_ACTION?.clearRemote?.(''); } catch (_) {}
    turnHandoffPublishPending = false;
    localStateDirty = false;
    phaseDeliveryScheduledKey = '';
    phaseDeliveryInFlightKey = '';
    phaseDeliveryPromise = null;
    lastStartedPhaseKey = '';
    lastAnnouncedPhaseKey = '';
    pendingPhaseDeliveryContext = null;
    clearPhaseDeliveryRetry();
  }

  async function clearRemoteMatchEphemera(api = null) {
    if (!roomPath) return false;
    const firebase = api || await loadFirebase();
    clearNetworkCleanupTimers();
    cancelPendingInteractionWaits();
    const results = await Promise.allSettled([
      firebase.remove(firebase.ref(db, `${roomPath}/game/fxEvents`)),
      firebase.remove(firebase.ref(db, interactionsPath())),
      firebase.remove(firebase.ref(db, realtimeCommandsPath())),
      firebase.remove(firebase.ref(db, `${roomPath}/game/priorityAction`)),
    ]);
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) {
      reportOnlineError(failed[0].reason || new Error('No se pudieron limpiar todos los canales efímeros.'), 'Limpieza PvP incompleta');
    }
    resetOnlineMatchEphemeralTracking({ cancelPendingInteractions: false });
    return failed.length === 0;
  }

  function trimHandledFxEvents() {
    if (handledFxEventIds.size <= 320) return;
    const keep = Array.from(handledFxEventIds).slice(-160);
    handledFxEventIds.clear();
    keep.forEach(id => handledFxEventIds.add(id));
  }

  function getFxPolicy(type) {
    try {
      const policy = window.ROK_ONLINE_FX?.getPolicy?.(String(type || ''));
      if (policy && typeof policy === 'object') return policy;
    } catch (_) {}
    return null;
  }

  function serverNowMs() {
    return Date.now() + Number(firebaseServerTimeOffsetMs || 0);
  }

  async function performEmitVisualEvent(request) {
    const { safeType, payload, phaseKey, matchSerial, baseRevision, sequence, roomPathValue } = request;
    try {
      const api = await loadFirebase();
      if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot || !localStateReady || applyingRemoteSnapshot || leavingRoom) return false;
      if (!roomPathValue || roomPathValue !== roomPath || Number(matchSerial) !== Number(currentMatchSerial())) return false;
      const policy = getFxPolicy(safeType);
      if (!policy) {
        fxStats.skippedUnsupported += 1;
        return false;
      }
      const eventRef = api.push(api.ref(db, `${roomPathValue}/game/fxEvents`));
      const id = String(eventRef.key || `fx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      const event = {
        id,
        schemaVersion: ONLINE_FX_SCHEMA_VERSION,
        type: safeType,
        authorUid: uid,
        authorPlayer: playerSlot,
        authorSequence: sequence,
        createdAt: api.serverTimestamp(),
        clientCreatedAt: Date.now(),
        phaseKey,
        matchSerial,
        baseRevision,
        playbackMode: policy.playbackMode === 'parallel' ? 'parallel' : 'serial',
        payload,
      };
      handledFxEventIds.add(id);
      trimHandledFxEvents();
      await api.set(eventRef, event);
      fxStats.emitted += 1;
      queueFxCleanup(roomPathValue, id);
      return true;
    } catch (error) {
      fxStats.emitFailed += 1;
      reportOnlineError(error, `No se pudo sincronizar FX ${safeType}`);
      return false;
    }
  }

  function emitVisualEvent(type, payload = {}) {
    if (!ROK_ONLINE_MATCH_ACTIVE || !roomPath || !playerSlot || !localStateReady || applyingRemoteSnapshot || leavingRoom) return Promise.resolve(false);
    const safeType = String(type || '').trim();
    if (!safeType) return Promise.resolve(false);
    const policy = getFxPolicy(safeType);
    if (!policy) {
      fxStats.skippedUnsupported += 1;
      return Promise.resolve(false);
    }
    const request = {
      safeType,
      payload: deepClone(payload || {}),
      phaseKey: currentLocalPhaseKey(),
      matchSerial: currentMatchSerial(),
      baseRevision: Math.max(0, Number(lastKnownRevision || 0)),
      sequence: ++outboundFxSequence,
      roomPathValue: roomPath,
    };
    const publishOne = () => performEmitVisualEvent(request);
    outboundFxPublishTail = outboundFxPublishTail.then(publishOne, publishOne);
    return outboundFxPublishTail;
  }

  async function playIncomingVisualEvent(rawEvent, id, playbackGeneration) {
    if (playbackGeneration !== fxPlaybackGeneration) return false;
    const requiredRevision = Math.max(0, Number(rawEvent.baseRevision || 0));
    if (requiredRevision > lastKnownRevision) {
      fxStats.revisionWaits += 1;
      const ready = await ensureAuthoritativeRevision(requiredRevision);
      if (!ready) {
        fxStats.revisionWaitFailures += 1;
        return false;
      }
    }
    if (playbackGeneration !== fxPlaybackGeneration) return false;
    try {
      const player = window.ROK_ONLINE_FX?.play;
      if (typeof player !== 'function') return false;
      await player({ ...deepClone(rawEvent), id });
      fxStats.played += 1;
      return true;
    } catch (error) {
      reportOnlineError(error, `Error reproduciendo FX ${rawEvent.type || ''}`);
      return false;
    }
  }

  function handleIncomingVisualEvent(rawEvent, key = '') {
    if (!rawEvent || typeof rawEvent !== 'object') return;
    const id = String(rawEvent.id || key || '');
    if (!id) return;
    fxStats.received += 1;
    if (handledFxEventIds.has(id)) {
      fxStats.skippedDuplicate += 1;
      return;
    }
    const authorUid = String(rawEvent.authorUid || '');
    const eventMatchSerial = Math.max(1, Number(rawEvent.matchSerial || 1));
    if (eventMatchSerial !== currentMatchSerial()) {
      fxStats.skippedMatch += 1;
      return;
    }
    const policy = getFxPolicy(rawEvent.type);
    if (!policy) {
      fxStats.skippedUnsupported += 1;
      handledFxEventIds.add(id);
      trimHandledFxEvents();
      return;
    }
    handledFxEventIds.add(id);
    trimHandledFxEvents();
    if (authorUid && authorUid === uid) {
      fxStats.skippedOwn += 1;
      return;
    }

    const authorSequence = Math.max(0, Number(rawEvent.authorSequence || 0));
    if (authorUid && authorSequence > 0) {
      const previousSequence = Math.max(0, Number(lastFxSequenceByAuthor.get(authorUid) || 0));
      if (authorSequence <= previousSequence) {
        fxStats.skippedDuplicate += 1;
        return;
      }
      lastFxSequenceByAuthor.set(authorUid, authorSequence);
    }

    const createdAt = Number(rawEvent.createdAt || 0);
    const maxReplayAgeMs = Math.max(1000, Number(policy.maxReplayAgeMs || ONLINE_FX_DEFAULT_MAX_REPLAY_AGE_MS));
    if (createdAt > 0 && serverNowMs() - createdAt > maxReplayAgeMs) {
      fxStats.skippedStale += 1;
      return;
    }

    const playbackGeneration = fxPlaybackGeneration;
    const playOne = () => playIncomingVisualEvent(rawEvent, id, playbackGeneration);
    if (policy.playbackMode === 'parallel') {
      fxStats.parallelPlayed += 1;
      const promise = Promise.resolve().then(playOne).finally(() => activeParallelFxPlaybacks.delete(promise));
      activeParallelFxPlaybacks.add(promise);
      return;
    }
    fxStats.serialPlayed += 1;
    remoteFxPlaybackTail = remoteFxPlaybackTail.then(playOne, playOne);
  }

  async function attachFxListener(api) {
    if (fxUnsubscribe) {
      try { fxUnsubscribe(); } catch (_) {}
      fxUnsubscribe = null;
    }
    handledFxEventIds.clear();
    lastFxSequenceByAuthor.clear();
    fxListenerStartedAt = Date.now();
    const listenerGeneration = ++fxListenerGeneration;
    const fxRef = api.ref(db, `${roomPath}/game/fxEvents`);
    let floorKey = '';
    try {
      const offsetSnapshot = await api.get(api.ref(db, '.info/serverTimeOffset'));
      firebaseServerTimeOffsetMs = Number(offsetSnapshot.val() || 0);
      // Si el navegador anterior se cerró antes de ejecutar su barrido local,
      // cualquier cliente que vuelva a entrar limpia los FX vencidos.
      const staleCutoff = serverNowMs() - ONLINE_FX_RETENTION_MS;
      const staleSnapshot = await api.get(api.query(
        fxRef,
        api.orderByChild('createdAt'),
        api.endAt(staleCutoff),
        api.limitToFirst(120),
      ));
      const staleRemovals = [];
      staleSnapshot.forEach(child => {
        if (child.key) staleRemovals.push(api.remove(api.ref(db, `${roomPath}/game/fxEvents/${child.key}`)));
      });
      if (staleRemovals.length) await Promise.allSettled(staleRemovals);
      const lastSnapshot = await api.get(api.query(fxRef, api.orderByKey(), api.limitToLast(1)));
      lastSnapshot.forEach(child => { floorKey = String(child.key || floorKey); });
    } catch (_) {}
    if (listenerGeneration !== fxListenerGeneration || leavingRoom || !roomPath) return;
    fxListenerFloorKey = floorKey;
    const listenRef = floorKey
      ? api.query(fxRef, api.orderByKey(), api.startAfter(floorKey))
      : fxRef;
    fxUnsubscribe = api.onChildAdded(listenRef, snapshot => {
      if (listenerGeneration !== fxListenerGeneration) return;
      handleIncomingVisualEvent(snapshot.val(), snapshot.key || '');
    }, error => reportOnlineError(error, 'Se perdió el canal de efectos visuales'));
  }


  function handleIncomingPriorityAction(priorityAction) {
    const active = Boolean(priorityAction && priorityAction.status === 'active');
    const ownerPlayer = Number(priorityAction?.ownerPlayer || 0);
    const actionMatchSerial = Math.max(1, Number(priorityAction?.matchSerial || 1));
    if (priorityAction && actionMatchSerial !== currentMatchSerial()) return false;
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
      matchSerial: currentMatchSerial(),
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
    if (!ROK_ONLINE_MATCH_ACTIVE || Number(defenderId) === Number(LOCAL_PLAYER_ID)) {
      return showCasterDefenseMenu(defenderId, source, amount, options);
    }
    const api = await loadFirebase();
    const barrierCommitted = await commitStateBarrier('before-caster-defense');
    if (!barrierCommitted) return 'none';
    const interactionId = `def_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const interaction = {
      id: interactionId,
      type: 'caster-defense',
      status: 'pending',
      requesterUid: uid,
      requesterPlayer: playerSlot,
      targetPlayer: Number(defenderId),
      baseRevision: lastKnownRevision,
      matchSerial: currentMatchSerial(),
      phaseKey: currentLocalPhaseKey(),
      createdAt: Date.now(),
      payload: {
        source: sourceToInteractionPayload(source),
        amount: Math.max(0, Number(amount || 0)),
        isDistanceAttack: Boolean(options.isDistanceAttack),
        allowCounter: options.allowCounter !== false,
        isDirectAttack: Boolean(options.isDirectAttack),
      },
    };
    const interactionRef = api.ref(db, `${interactionsPath()}/${interactionId}`);
    await api.set(interactionRef, interaction);
    try { log(`Esperando la respuesta defensiva del Jugador ${defenderId}…`); } catch (_) {}

    return await new Promise(resolve => {
      let settled = false;
      let unsubscribe = null;
      let timeoutId = null;
      const finish = async choice => {
        if (settled) return;
        settled = true;
        pendingInteractionAborters.delete(aborter);
        if (unsubscribe) unsubscribe();
        if (timeoutId) window.clearTimeout(timeoutId);
        try { await api.remove(interactionRef); } catch (_) {}
        resolve(['defend', 'counter', 'special-counter', 'none'].includes(choice) ? choice : 'none');
      };
      const aborter = () => { void finish('none'); };
      pendingInteractionAborters.add(aborter);
      unsubscribe = api.onValue(interactionRef, snapshot => {
        const value = snapshot.val();
        if (!value) return;
        if (value.id !== interactionId || value.status !== 'resolved') return;
        void finish(value.response?.choice || 'none');
      }, () => { void finish('none'); });
      timeoutId = window.setTimeout(() => { void finish('none'); }, REMOTE_DEFENSE_TIMEOUT_MS);
    });
  }

  function applyRemoteActionWindowState(snapshot, expectedHash = '') {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.players) return false;
    const normalizedSnapshot = normalizeAuthoritativeSnapshot(snapshot);
    const report = auditSnapshotSource(normalizedSnapshot, { repair: false });
    if (!report.ok) {
      consistencyStats.actionWindowRejected += 1;
      consistencyStats.lastIssue = formatIntegrityIssue(report);
      reportOnlineError(new Error(consistencyStats.lastIssue), 'Respuesta PvP inconsistente');
      return false;
    }
    const normalizedText = snapshotText(normalizedSnapshot);
    const normalizedHash = hashSnapshotText(normalizedText);
    if (expectedHash && String(expectedHash) !== normalizedHash) {
      consistencyStats.actionWindowRejected += 1;
      consistencyStats.hashMismatch += 1;
      consistencyStats.lastIssue = `action-window hash ${expectedHash} != ${normalizedHash}`;
      reportOnlineError(new Error(consistencyStats.lastIssue), 'Respuesta PvP inconsistente');
      return false;
    }
    snapshot = normalizedSnapshot;
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
      lastSnapshotText = makeBattleSnapshotPacket().text;
      flushBattleRender('remote-action-result');
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
    const barrierCommitted = await commitStateBarrier(`before-action-window:${safeKind}`);
    if (!barrierCommitted) return { result: 'sync-conflict', applied: false };
    const interactionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const interactionRef = api.ref(db, `${interactionsPath()}/${interactionId}`);
    const interaction = {
      id: interactionId,
      type: 'action-window',
      kind: safeKind,
      status: 'pending',
      requesterUid: uid,
      requesterPlayer: playerSlot,
      targetPlayer: targetId,
      baseRevision: lastKnownRevision,
      matchSerial: currentMatchSerial(),
      phaseKey: currentLocalPhaseKey(),
      createdAt: Date.now(),
      payload: deepClone(payload || {}),
    };
    await api.set(interactionRef, interaction);

    return await new Promise(resolve => {
      let settled = false;
      let unsubscribe = null;
      let timeoutId = null;
      const finish = async (response, finishOptions = {}) => {
        if (settled) return;
        settled = true;
        pendingInteractionAborters.delete(aborter);
        if (unsubscribe) unsubscribe();
        if (timeoutId) window.clearTimeout(timeoutId);
        let applied = false;
        const returnedSnapshot = response?.snapshot;
        const responseMatchSerial = Math.max(1, Number(response?.matchSerial || interaction.matchSerial || 1));
        const responseBaseRevision = Math.max(0, Number(response?.baseRevision ?? interaction.baseRevision ?? 0));
        const responsePhaseKey = String(response?.phaseKey || interaction.phaseKey || '');
        const expectedPhaseKey = String(interaction.phaseKey || '');
        const responseMetadataValid = responseMatchSerial === currentMatchSerial()
          && responseBaseRevision === Math.max(0, Number(interaction.baseRevision || 0))
          && (!expectedPhaseKey || responsePhaseKey === expectedPhaseKey)
          && (!expectedPhaseKey || phaseKeyFromSnapshot(returnedSnapshot) === expectedPhaseKey);
        if (!finishOptions.skipApply && returnedSnapshot && typeof returnedSnapshot === 'object' && responseMetadataValid) {
          applied = applyRemoteActionWindowState(returnedSnapshot, String(response?.snapshotHash || ''));
          if (applied) await commitStateBarrier(`action-window-result:${safeKind}`);
        } else if (!finishOptions.skipApply && returnedSnapshot && !responseMetadataValid) {
          consistencyStats.actionWindowRejected += 1;
          consistencyStats.lastIssue = `action-window metadata desfasada (${responseBaseRevision}/${responseMatchSerial})`;
        }
        try { await api.remove(interactionRef); } catch (_) {}
        resolve({ result: String(response?.result || 'skipped'), applied });
      };
      const aborter = () => { void finish({ result: 'match-reset' }, { skipApply: true }); };
      pendingInteractionAborters.add(aborter);
      unsubscribe = api.onValue(interactionRef, snapshot => {
        const value = snapshot.val();
        if (!value || value.id !== interactionId || value.status !== 'resolved') return;
        void finish(value.response || { result: 'skipped' });
      }, () => { void finish({ result: 'error' }); });
      timeoutId = window.setTimeout(() => { void finish({ result: 'timeout' }); }, REMOTE_ACTION_WINDOW_TIMEOUT_MS);
    });
  }

  async function ensureAuthoritativeRevision(requiredRevision = 0) {
    const required = Math.max(0, Number(requiredRevision || 0));
    if (!required || lastKnownRevision >= required) return true;
    try {
      const api = await loadFirebase();
      const latest = await api.get(api.ref(db, authoritativeGamePath()));
      const value = latest.val();
      if (value?.snapshot && Number(value.revision || 0) >= required) {
        handleAuthoritativeValue(value);
      }
    } catch (_) {}
    if (lastKnownRevision >= required) return true;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 3500) {
      await new Promise(resolve => window.setTimeout(resolve, 40));
      if (lastKnownRevision >= required) return true;
    }
    return lastKnownRevision >= required;
  }

  async function handleIncomingInteraction(interaction) {
    const generation = roomSessionGeneration;
    if (!interaction || interaction.status !== 'pending' || generation !== roomSessionGeneration || leavingRoom) return;
    if (Math.max(1, Number(interaction.matchSerial || 1)) !== currentMatchSerial()) return;
    if (Number(interaction.targetPlayer) !== Number(LOCAL_PLAYER_ID)) return;
    const interactionId = String(interaction.id || '');
    if (!interactionId || handledInteractionIds.has(interactionId)) return;
    handledInteractionId = interactionId;
    handledInteractionIds.add(interactionId);
    trimHandledInteractions();
    try {
      const api = await loadFirebase();
      if (generation !== roomSessionGeneration || leavingRoom) return;
      const interactionRef = api.ref(db, `${interactionsPath()}/${interactionId}`);
      const revisionReady = await ensureAuthoritativeRevision(interaction.baseRevision);
      if (generation !== roomSessionGeneration || leavingRoom) return;
      if (!revisionReady) {
        reportOnlineError(new Error(`No llegó la revisión ${Number(interaction.baseRevision || 0)} antes de la interacción ${interactionId}.`), 'Ventana online desfasada');
        return;
      }

      if (interaction.type === 'action-window') {
        try {
          const runner = window.ROK_ONLINE_ACTION_WINDOW?.run;
          const result = typeof runner === 'function'
            ? await runner(String(interaction.kind || ''), deepClone(interaction.payload || {}))
            : 'unsupported';
          if (generation !== roomSessionGeneration || leavingRoom) return;
          const responsePacket = makeBattleSnapshotPacket();
          if (!responsePacket.snapshot) throw new Error(`La ventana ${interactionId} produjo un estado inválido.`);
          await api.runTransaction(interactionRef, current => {
            if (!current || current.id !== interactionId || current.status !== 'pending') return;
            return {
              ...current,
              status: 'resolved',
              response: {
                result: typeof result === 'string' ? result : String(result?.result || 'completed'),
                snapshot: responsePacket.snapshot,
                snapshotHash: responsePacket.hash,
                baseRevision: Math.max(0, Number(interaction.baseRevision || 0)),
                matchSerial: currentMatchSerial(),
                phaseKey: String(interaction.phaseKey || currentLocalPhaseKey()),
                uid,
                player: playerSlot,
                resolvedAt: Date.now(),
              },
            };
          }, { applyLocally: false });
        } catch (error) {
          reportOnlineError(error, `Error en ventana remota ${interaction.kind || ''}`);
          try {
            const fallbackPacket = makeBattleSnapshotPacket();
            await api.update(interactionRef, {
              status: 'resolved',
              response: {
                result: 'error',
                snapshot: fallbackPacket.snapshot,
                snapshotHash: fallbackPacket.hash,
                baseRevision: Math.max(0, Number(interaction.baseRevision || 0)),
                matchSerial: currentMatchSerial(),
                phaseKey: String(interaction.phaseKey || currentLocalPhaseKey()),
                uid,
                player: playerSlot,
                resolvedAt: Date.now(),
                fallback: true,
              },
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
        if (generation !== roomSessionGeneration || leavingRoom) return;
        await api.runTransaction(interactionRef, current => {
          if (!current || current.id !== interactionId || current.status !== 'pending') return;
          return {
            ...current,
            status: 'resolved',
            response: { choice: choice || 'none', uid, player: playerSlot, resolvedAt: Date.now() },
          };
        }, { applyLocally: false });
      } catch (error) {
        reportOnlineError(error, 'Error en la defensa remota del Kaster');
        try {
          await api.update(interactionRef, {
            status: 'resolved',
            response: { choice: 'none', uid, player: playerSlot, resolvedAt: Date.now(), fallback: true },
          });
        } catch (_) {}
      }
    } finally {
      if (interaction.type === 'action-window') passiveConsistencySuspendUntil = Date.now() + 5000;
      if (handledInteractionId === interactionId) handledInteractionId = '';
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
    roomSessionGeneration += 1;
    for (const unsubscribe of [
      roomUnsubscribe,
      authoritativeUnsubscribe,
      interactionUnsubscribe,
      realtimeCommandUnsubscribe,
      priorityActionUnsubscribe,
      matchPlayersUnsubscribe,
      matchStatusUnsubscribe,
      matchControlUnsubscribe,
      fxUnsubscribe,
    ]) {
      if (unsubscribe) { try { unsubscribe(); } catch (_) {} }
    }
    roomUnsubscribe = null;
    authoritativeUnsubscribe = null;
    interactionUnsubscribe = null;
    realtimeCommandUnsubscribe = null;
    priorityActionUnsubscribe = null;
    matchPlayersUnsubscribe = null;
    matchStatusUnsubscribe = null;
    matchControlUnsubscribe = null;
    fxUnsubscribe = null;
    fxListenerGeneration += 1;
    fxListenerFloorKey = '';
    fxListenerStartedAt = 0;
    clearNetworkCleanupTimers();
    cancelPendingInteractionWaits();
    handledFxEventIds.clear();
    lastFxSequenceByAuthor.clear();
    handledInteractionId = '';
    passiveConsistencySuspendUntil = 0;
    handledInteractionIds.clear();
    handledRealtimeCommandIds.clear();
    realtimeCommandTail = Promise.resolve(true);
    remoteFxPlaybackTail = Promise.resolve();
    outboundFxPublishTail = Promise.resolve(true);
    activeParallelFxPlaybacks.clear();
    matchControlCache = null;
    lastAuthoritativeSnapshot = null;
    lastAuthoritativeSnapshotText = '';
    lastAuthoritativeSnapshotHash = '';
    if (presenceDisconnect) {
      try { await presenceDisconnect.cancel(); } catch (_) {}
      presenceDisconnect = null;
    }
    if (connectionUnsubscribe) {
      try { connectionUnsubscribe(); } catch (_) {}
      connectionUnsubscribe = null;
    }
    hideOpponentReconnectNotice();
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
    const wasPlaying = Boolean(getAuthoritativeGameState(oldRoom)?.snapshot || oldRoom?.status === 'playing');
    try {
      if (oldRoomPath && oldSlot) {
        try { await clearPriorityAction('', 'leave-room'); } catch (_) {}
        if (wasPlaying && db && firebaseApiPromise) {
          try {
            const api = await firebaseApiPromise;
            await api.update(api.ref(db, `${oldRoomPath}/players/${uid}`), {
              connected: false,
              leftMatch: true,
              lastSeenAt: api.serverTimestamp(),
            });
          } catch (_) {}
        }
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
            await api.update(api.ref(db, `${oldRoomPath}/players/${uid}`), { connected: false, leftMatch: true, lastSeenAt: api.serverTimestamp() });
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
      phaseDeliveryInFlightKey = '';
      phaseDeliveryPromise = null;
      lastAnnouncedPhaseKey = '';
      pendingPhaseDeliveryContext = null;
      clearPhaseDeliveryRetry();
      turnHandoffPublishPending = false;
      localStateReady = false;
      handledInteractionId = '';
      handledInteractionIds.clear();
      localStateDirty = false;
      publishQueueTail = Promise.resolve(false);
      startingOnlineRematch = false;
      matchControlCache = null;
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
    accountUi.skipLogin = document.getElementById('accountSkipLoginBtn');
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

  function publishActiveCasterAvatar(profile = socialProfileCache) {
    const normalized = normalizeProfileAvatarId(profile?.avatarId);
    const url = normalized === CUSTOM_PROFILE_AVATAR_ID ? String(profile?.casterAvatarUrl || '') : '';
    window.ROK_ACTIVE_CASTER_AVATAR_URL = url;
    try {
      window.dispatchEvent(new CustomEvent('rok:caster-avatar-changed', { detail: { url } }));
    } catch (_) {}
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
      publishActiveCasterAvatar(null);
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
    publishActiveCasterAvatar(profile);
  }

  function readableAccountAuthError(error) {
    const code = String(error?.code || '');
    if (code.includes('auth/email-already-in-use')) return 'Ese correo electrónico ya tiene una cuenta.';
    if (code.includes('auth/invalid-email')) return 'El correo electrónico no es válido.';
    if (code.includes('auth/weak-password')) return 'La contraseña es demasiado débil. Usa al menos 6 caracteres.';
    if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password') || code.includes('auth/user-not-found')) return 'Correo o contraseña incorrectos.';
    if (code.includes('auth/too-many-requests')) return 'Demasiados intentos. Espera un momento y vuelve a intentarlo.';
    if (code.includes('auth/requests-from-referer-null-are-blocked')) return 'Este origen local no puede autenticar con Firebase. R.O.K entra en modo de prueba local; para Online usa un dominio autorizado.';
    if (code.includes('auth/network-request-failed')) return 'No se pudo conectar con Firebase. Revisa Internet.';
    if (code.includes('auth/operation-not-allowed')) return 'Activa Email/Password en Firebase Authentication para usar cuentas.';
    if (code === 'rok/auth-required') return error.message;
    return error?.message || 'No se pudo completar la operación de cuenta.';
  }

  async function registerAccount(event) {
    event?.preventDefault?.();
    cacheAccountUi();
    if (LOCAL_FILE_TEST_MODE) {
      enterLocalFileTestMode();
      return true;
    }
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
    if (LOCAL_FILE_TEST_MODE) {
      enterLocalFileTestMode();
      return true;
    }
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
    if (LOCAL_FILE_TEST_MODE) {
      enterLocalFileTestMode();
      return false;
    }
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
    if (LOCAL_FILE_TEST_MODE) {
      enterLocalFileTestMode();
      return true;
    }
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

  function enterLocalFileTestMode() {
    accountAuthReady = true;
    uid = '';
    socialProfileCache = null;
    updateAccountIdentityUi(null);
    showAccountAuthOverlay(false);
    document.body.classList.remove('rok-account-locked');
    if (accountUi.menuName) accountUi.menuName.textContent = 'Prueba local';
    if (accountUi.menuEmail) accountUi.menuEmail.textContent = 'Offline · sin Firebase';
    if (accountUi.hudName) accountUi.hudName.textContent = 'Kaster de prueba';
    window.ROK_LOCAL_TEST_MODE = true;
    try {
      console.info(`[ROK] Prueba local activa: Firebase Auth omitido para ${window.location.origin || window.location.protocol}.`);
    } catch (_) {}
    return true;
  }

  async function initializeAccountAuthentication() {
    cacheAccountUi();

    // IMPORTANTE: no llames a Firebase Auth desde file://, localhost ni una IP privada local.
    // Esto evita auth/requests-from-referer-...-are-blocked y permite probar PvB,
    // Aventura, Manual y Tiempo Real sin que el login bloquee el juego.
    if (LOCAL_FILE_TEST_MODE) {
      enterLocalFileTestMode();
      return;
    }

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
    accountUi.skipLogin?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      enterLocalFileTestMode();
    });
    accountUi.logout?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void logoutAccount(); });
  }

  function readableFirebaseError(error) {
    const code = String(error?.code || '');
    if (code.includes('auth/operation-not-allowed')) return 'Activa el proveedor Email/Password en Firebase Authentication.';
    if (code.includes('permission-denied') || code.includes('PERMISSION_DENIED')) return 'Firebase bloqueó la operación. Revisa las Realtime Database Security Rules.';
        if (code.includes('network-request-failed')) return 'No se pudo conectar con Firebase. Revisa Internet y vuelve a intentar.';
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
    profileUi.casterAvatarUploadTrigger = document.getElementById('casterAvatarUploadTrigger');
    profileUi.casterAvatarSourceInput = document.getElementById('casterAvatarSourceInput');
    profileUi.casterAvatarSourceName = document.getElementById('casterAvatarSourceName');
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
    if (profileUi.casterAvatarSourceName) profileUi.casterAvatarSourceName.textContent = 'Ningún archivo seleccionado';
    if (profileUi.casterAvatarSourcePreview) {
      profileUi.casterAvatarSourcePreview.hidden = true;
      profileUi.casterAvatarSourcePreview.removeAttribute('src');
    }
    if (profileUi.casterAvatarSourceEmpty) profileUi.casterAvatarSourceEmpty.hidden = false;
    refreshCasterAvatarRequestButton();
  }

  async function handleCasterAvatarSourceSelected(fileList) {
    cacheProfileUi();
    const file = fileList?.[0] || null;
    if (!file) {
      setCasterAvatarJobStatus('Sube una foto para comenzar.', '');
      return false;
    }

    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    const supportedType = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(type);
    const supportedExt = /\.(png|jpe?g|webp)$/i.test(name);
    if (!supportedType && !supportedExt) {
      setCasterAvatarJobStatus('Usa una imagen PNG, JPG, JPEG o WEBP.', 'error');
      return false;
    }
    if (Number(file.size || 0) > MAX_CASTER_AVATAR_SOURCE_BYTES) {
      setCasterAvatarJobStatus('La imagen supera el máximo de 10 MB.', 'error');
      return false;
    }

    clearCasterAvatarSourceObjectUrl();
    casterAvatarSourceFile = file;
    if (profileUi.casterAvatarSourceName) profileUi.casterAvatarSourceName.textContent = String(file.name || 'Archivo seleccionado');
    setCasterAvatarJobStatus('Cargando vista previa…', 'working');

    try {
      const previewUrl = await fileToDataUrl(file);
      if (!previewUrl) throw new Error('La imagen no pudo convertirse a vista previa.');

      if (profileUi.casterAvatarSourcePreview) {
        profileUi.casterAvatarSourcePreview.src = previewUrl;
        profileUi.casterAvatarSourcePreview.hidden = false;
      }
      if (profileUi.casterAvatarSourceEmpty) profileUi.casterAvatarSourceEmpty.hidden = true;

      setCasterAvatarJobStatus('Foto preparada. Confirma la autorización y solicita la creación.', '');
      refreshCasterAvatarRequestButton();
      return true;
    } catch (error) {
      casterAvatarSourceFile = null;
      if (profileUi.casterAvatarSourceName) profileUi.casterAvatarSourceName.textContent = 'Ningún archivo seleccionado';
      if (profileUi.casterAvatarSourcePreview) {
        profileUi.casterAvatarSourcePreview.hidden = true;
        profileUi.casterAvatarSourcePreview.removeAttribute('src');
      }
      if (profileUi.casterAvatarSourceEmpty) profileUi.casterAvatarSourceEmpty.hidden = false;
      setCasterAvatarJobStatus('No se pudo cargar la vista previa de esa imagen. Prueba con otro PNG, JPG o WEBP.', 'error');
      refreshCasterAvatarRequestButton();
      return false;
    }
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
    if (status === 'queued') {
      const age = Date.now() - Number(job?.createdAt || Date.now());
      if (age > 30000) setCasterAvatarJobStatus('Solicitud en cola. GitHub Actions todavía no la ha tomado; el proceso automático revisa la cola periódicamente.', 'working');
      else setCasterAvatarJobStatus('Solicitud enviada. Está esperando turno para generar el avatar.', 'working');
    }
    else if (status === 'processing') setCasterAvatarJobStatus('GitHub Actions está generando tu Kaster. Puedes cerrar esta ventana y volver después.', 'working');
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

  async function prepareCasterAvatarSourceForQueue(file) {
    const maxSide = 1024;
    const maxDataUrlChars = 3_500_000;
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file);
    } catch (_) {
      bitmap = null;
    }
    if (!bitmap) {
      const sourceUrl = await fileToDataUrl(file);
      if (sourceUrl.length > maxDataUrlChars) throw new Error('La foto es demasiado pesada para la cola de prueba. Usa una foto más pequeña.');
      return {
        dataUrl: sourceUrl,
        mimeType: String(file.type || 'image/jpeg'),
        width: 0,
        height: 0,
        bytes: Number(file.size || 0),
      };
    }
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    try { bitmap.close(); } catch (_) {}
    const qualities = [0.84, 0.76, 0.68];
    let blob = null;
    let dataUrl = '';
    for (const quality of qualities) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) continue;
      dataUrl = await fileToDataUrl(blob);
      if (dataUrl.length <= maxDataUrlChars) break;
    }
    if (!blob || !dataUrl) throw new Error('No se pudo preparar la foto para la cola de generación.');
    if (dataUrl.length > maxDataUrlChars) throw new Error('La foto sigue siendo demasiado pesada después de optimizarla. Usa una imagen más pequeña.');
    return { dataUrl, mimeType: 'image/jpeg', width, height, bytes: blob.size };
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
          promptVersion: 'rok-caster-avatar-v2',
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
      setCasterAvatarJobStatus('Preparando la foto para enviarla a la cola de GitHub…', 'working');
      const prepared = await prepareCasterAvatarSourceForQueue(file);
      const jobRef = api.push(api.ref(db, `${AVATAR_JOBS_ROOT}/${uid}`));
      const jobId = String(jobRef.key || '');
      if (!jobId) throw new Error('No se pudo crear el identificador de la solicitud.');
      const now = Date.now();
      const jobPayload = {
        uid,
        status: 'queued',
        sourceImageData: prepared.dataUrl,
        sourceImageMime: prepared.mimeType,
        sourceImageWidth: prepared.width,
        sourceImageHeight: prepared.height,
        sourceImageBytes: prepared.bytes,
        promptVersion: 'rok-caster-avatar-github-v1',
        mode: 'github-actions',
        createdAt: now,
        updatedAt: now,
      };
      setCasterAvatarJobStatus('Registrando la solicitud en la cola…', 'working');
      await api.set(jobRef, jobPayload);
      casterAvatarCurrentJobId = jobId;
      clearCasterAvatarSourceSelection();
      if (profileUi.casterAvatarConsent) profileUi.casterAvatarConsent.checked = false;
      renderCasterAvatarJob(jobPayload);
      setCasterAvatarJobStatus('Solicitud creada. GitHub Actions la procesará en la próxima revisión de la cola.', 'working');
      await attachCasterAvatarJobListener(jobId);
      return true;
    } catch (error) {
      const raw = `${String(error?.code || '')} ${String(error?.message || '')}`.toLowerCase();
      let message = readableFirebaseError(error);
      if (isPermissionDeniedError(error)) {
        message = 'Firebase bloqueó avatarJobs. Revisa las Realtime Database Rules del sistema de avatar.';
      }
      setCasterAvatarJobStatus(message, 'error');
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
      socialProfileCache = await applySocialProfilePatch(updates);
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
      const profile = await ensureSocialProfile();
      if (normalized === CUSTOM_PROFILE_AVATAR_ID && !profile.casterAvatarUrl) throw new Error('Todavía no tienes un avatar de Kaster generado.');
      socialProfileCache = await applySocialProfilePatch({ avatarId: normalized, updatedAt: Date.now() });
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
      await ensureSocialProfile();
      socialProfileCache = await applySocialProfilePatch({ displayName, updatedAt: Date.now() });
      if (auth?.currentUser && !auth.currentUser.isAnonymous) await api.authModule.updateProfile(auth.currentUser, { displayName });
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

  async function applySocialProfilePatch(patch = {}) {
    const current = socialProfileCache || buildLocalSocialProfile({ uid });
    const next = { ...current, ...patch, uid, updatedAt: Number(patch.updatedAt || Date.now()) };

    if (isCasterAvatarMockMode() || socialProfileRemoteBlocked) {
      socialProfileCache = next;
      persistLocalSocialProfile(next);
      updateAccountIdentityUi(auth?.currentUser || null, next);
      return { ...next, remote: false };
    }

    try {
      const api = await loadFirebase();
      await api.update(api.ref(db, `socialProfiles/${uid}`), patch);
      socialProfileCache = next;
      persistLocalSocialProfile(next);
      updateAccountIdentityUi(auth?.currentUser || null, next);
      return { ...next, remote: true };
    } catch (error) {
      if (!isPermissionDeniedError(error)) throw error;
      socialProfileRemoteBlocked = true;
      socialProfileCache = next;
      persistLocalSocialProfile(next);
      updateAccountIdentityUi(auth?.currentUser || null, next);
      return { ...next, remote: false };
    }
  }

  async function ensureSocialProfile() {
    if (socialProfileRemoteBlocked) {
      const localProfile = buildLocalSocialProfile({ uid });
      socialProfileCache = { ...localProfile, uid };
      persistLocalSocialProfile(socialProfileCache);
      updateAccountIdentityUi(auth?.currentUser || null, socialProfileCache);
      return socialProfileCache;
    }

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
      const casterAvatarUrl = String(existing.casterAvatarUrl || '');
      const profile = {
        friendCode,
        displayName,
        avatarId: normalizeProfileAvatarId(existing.avatarId),
        casterAvatarUrl,
        level: normalizeAccountLevel(existing.level),
        xp: normalizeAccountXp(existing.xp),
        createdAt: Number(existing.createdAt || Date.now()),
        updatedAt: Date.now(),
      };
      if (profile.avatarId === CUSTOM_PROFILE_AVATAR_ID && !profile.casterAvatarUrl) profile.avatarId = DEFAULT_PROFILE_AVATAR_ID;

      // Compatibilidad con las reglas antiguas de R.O.K: no enviamos el campo
      // casterAvatarUrl hasta que realmente exista. Así el perfil normal no
      // dispara PERMISSION_DENIED antes de desplegar las reglas nuevas.
      const remoteProfile = {
        friendCode: profile.friendCode,
        displayName: profile.displayName,
        avatarId: profile.avatarId,
        level: profile.level,
        xp: profile.xp,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      };
      if (profile.casterAvatarUrl) remoteProfile.casterAvatarUrl = profile.casterAvatarUrl;

      await api.set(profileRef, remoteProfile);
      socialProfileCache = { ...profile, uid };
      persistLocalSocialProfile(socialProfileCache);
      updateAccountIdentityUi(auth?.currentUser || null, socialProfileCache);
      return socialProfileCache;
    } catch (error) {
      if (isCasterAvatarMockMode() || isPermissionDeniedError(error)) {
        if (isPermissionDeniedError(error)) socialProfileRemoteBlocked = true;
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
      await ensureSocialProfile();
      socialProfileCache = await applySocialProfilePatch({ displayName, updatedAt: Date.now() });
      if (auth?.currentUser && !auth.currentUser.isAnonymous) {
        await api.authModule.updateProfile(auth.currentUser, { displayName });
      }
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
    profileUi.casterAvatarUploadTrigger?.addEventListener('click', event => {
      if (event.target === profileUi.casterAvatarSourceInput) return;
      event.preventDefault();
      profileUi.casterAvatarSourceInput?.click();
    });
    profileUi.casterAvatarUploadTrigger?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        profileUi.casterAvatarSourceInput?.click();
      }
    });
    profileUi.casterAvatarSourceInput?.addEventListener('change', event => { void handleCasterAvatarSourceSelected(event.currentTarget.files); });
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
    ui.playStyleManualBtn?.addEventListener('click', () => { void changeLobbyPlayStyle('manual'); });
    ui.playStyleRealtimeBtn?.addEventListener('click', () => { void changeLobbyPlayStyle('realtime'); });
    ui.spellbookPrevBtn?.addEventListener('click', () => { void shiftOnlineSpellbook(-1); });
    ui.spellbookNextBtn?.addEventListener('click', () => { void shiftOnlineSpellbook(1); });
    ui.arenaPrevBtn?.addEventListener('click', () => { void shiftOnlineArena(-1); });
    ui.arenaNextBtn?.addEventListener('click', () => { void shiftOnlineArena(1); });
    ui.arenaRandomBtn?.addEventListener('click', () => { void changeLobbyArena('random'); });
    ui.leaveBtn?.addEventListener('click', () => { void leaveRoom({ silent: false, keepMenu: false }); });
    ui.overlay?.addEventListener('click', event => {
      if (event.target === ui.overlay && !roomCode) closeLobby();
    });

    window.addEventListener('beforeunload', () => {
      if (!roomPath || !playerSlot || !db || !firebaseApiPromise || !uid) return;
      void firebaseApiPromise.then(api => api.update(api.ref(db, `${roomPath}/players/${uid}`), {
        connected: false,
        lastSeenAt: api.serverTimestamp(),
      })).catch(() => {});
    });

    void initializeAccountAuthentication();
  }

  window.ROK_LOCAL_TEST_MODE = LOCAL_FILE_TEST_MODE;

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
    setLobbyPlayStyle: changeLobbyPlayStyle,
    showJoinBrowser,
    leaveRoom,
    reconnectSavedMatch,
    getReconnectCandidate: () => reconnectCandidate,
    requestRemoteCasterDefense,
    requestRemoteActionWindow,
    notifyMatchFinished,
    requestRematch,
    prepareInitiativeRound,
    submitInitiativeChoice,
    getInitiativeState,
    setPriorityAction,
    clearPriorityAction,
    emitVisualEvent,
    markPhaseStarted,
    markTurnHandoffPending,
    publishNow: () => publishSnapshot({ force: true }),
    commitStateBarrier,
    markStateDirty: markLocalStateDirty,
    sendRealtimeCommand,
    isRealtimeAuthority,
    getSession: () => ({
      roomCode,
      playerSlot,
      uid,
      revision: lastKnownRevision,
      active: ROK_ONLINE_MATCH_ACTIVE,
      playStyle: normalizeOnlinePlayStyle(state?.playStyle),
      lobbyPlayStyle: getLobbyPlayStyle(roomCache),
      realtimeAuthority: isRealtimeAuthority(),
      observedPhaseKey: lastObservedPhaseKey,
      startedPhaseKey: lastStartedPhaseKey,
      handoffPending: turnHandoffPublishPending,
      matchSerial: currentMatchSerial(),
      matchStatus: String(matchControlCache?.status || ''),
      pendingInteractionWaits: pendingInteractionAborters.size,
      pendingFxCleanupTimers: pendingFxCleanupEntries.size,
      fxListenerFloorKey,
      fxStats: { ...fxStats },
      realtimeCommandStats: { ...realtimeCommandStats },
      consistency: {
        ...consistencyStats,
        authoritativeHash: lastAuthoritativeSnapshotHash,
        localHash: makeBattleSnapshotPacket().hash,
        authoritativeRevision: lastKnownRevision,
        snapshotSchemaVersion: ONLINE_SNAPSHOT_SCHEMA_VERSION,
        snapshotHashVersion: ONLINE_SNAPSHOT_HASH_VERSION,
      },
    }),
    verifyConsistency: () => verifyPassiveClientConsistency({ repair: false }),
    transportHashSelfTest: runTransportHashSelfTest,
    protocolSelfTest: runOnlineProtocolSelfTest,
    getStressSnapshot: () => {
      const memory = performance?.memory ? {
        usedJSHeapSize: Number(performance.memory.usedJSHeapSize || 0),
        totalJSHeapSize: Number(performance.memory.totalJSHeapSize || 0),
        jsHeapSizeLimit: Number(performance.memory.jsHeapSizeLimit || 0),
      } : null;
      return {
        capturedAt: Date.now(),
        roomCode,
        playerSlot,
        revision: lastKnownRevision,
        matchSerial: currentMatchSerial(),
        phaseKey: currentLocalPhaseKey(),
        domNodes: document?.getElementsByTagName?.('*')?.length || 0,
        memory,
        render: window.ROK_RENDER_ENGINE?.getStats?.() || null,
        fxRuntime: window.ROK_ONLINE_FX?.getStats?.() || null,
        fxNetwork: { ...fxStats },
        consistency: {
          ...consistencyStats,
          authoritativeHash: lastAuthoritativeSnapshotHash,
          localHash: makeBattleSnapshotPacket().hash,
        },
        pendingInteractionWaits: pendingInteractionAborters.size,
        pendingFxCleanupTimers: pendingFxCleanupEntries.size,
        networkCleanupTimers: networkCleanupTimers.size,
        handledInteractions: handledInteractionIds.size,
      };
    },
    resetStressCounters: () => {
      try { window.ROK_RENDER_ENGINE?.resetStats?.(); } catch (_) {}
      try { window.ROK_ONLINE_FX?.resetStats?.(); } catch (_) {}
      Object.assign(fxStats, { emitted: 0, received: 0, played: 0, skippedOwn: 0, skippedOld: 0, skippedDuplicate: 0, skippedMatch: 0, skippedStale: 0, skippedUnsupported: 0, revisionWaits: 0, revisionWaitFailures: 0, parallelPlayed: 0, serialPlayed: 0 });
      Object.assign(realtimeCommandStats, { received: 0, applied: 0, rejectedIdentity: 0, rejectedMatch: 0, rejectedStale: 0, rejectedRevision: 0, rejectedPayload: 0 });
      Object.assign(consistencyStats, { validatedOutgoing: 0, rejectedOutgoing: 0, validatedIncoming: 0, rejectedIncoming: 0, hashMismatch: 0, passiveChecks: 0, passiveRepairs: 0, actionWindowRejected: 0, legacySnapshots: 0, lastIssue: '' });
      return true;
    },
    auditLocalState: () => window.ROK_STATE_INTEGRITY?.audit?.(state, { repair: false }) || { ok: true, issues: [], warnings: [] },
  };

  window.addEventListener('DOMContentLoaded', bindUi);
}());
