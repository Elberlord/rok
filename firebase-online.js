import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getDatabase,
  get,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCapopKSADRBnhk7wZVWKcnFG__zl3TYnw",
  authDomain: "rok-rise-of-caster.firebaseapp.com",
  databaseURL: "https://rok-rise-of-caster-default-rtdb.firebaseio.com/",
  projectId: "rok-rise-of-caster",
  storageBucket: "rok-rise-of-caster.firebasestorage.app",
  messagingSenderId: "147189629810",
  appId: "1:147189629810:web:3bebec7a294902545d93eb",
};

const lobby = window.ROK_ONLINE_LOBBY;

if (!lobby) {
  throw new Error('ROK_ONLINE_LOBBY no está disponible. game.js debe cargarse antes de firebase-online.js.');
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

let authPromise = null;
let currentRoom = null;
let roomUnsubscribe = null;
let connectionUnsubscribe = null;
let disconnectRegistration = null;
let hostReadyUpdatePending = false;
let lastDeliveredBattleRevision = 0;

function createUserError(message, code = 'rok-online/error', cause = null) {
  const error = new Error(message);
  error.code = code;
  error.userMessage = message;
  if (cause) error.cause = cause;
  return error;
}

function getFirebaseErrorCode(error) {
  return String(error?.code || error?.message || '');
}

function translateFirebaseError(error, fallback) {
  const code = getFirebaseErrorCode(error);
  if (code.includes('auth/operation-not-allowed')) {
    return createUserError('Activa el proveedor Anónimo en Firebase Authentication.', code, error);
  }
  if (code.includes('auth/unauthorized-domain')) {
    return createUserError(`Agrega ${window.location.hostname} a Authentication > Settings > Authorized domains.`, code, error);
  }
  if (code.includes('auth/network-request-failed') || code.includes('network')) {
    return createUserError('No se pudo conectar con Firebase. Revisa tu conexión a internet.', code, error);
  }
  if (code.includes('PERMISSION_DENIED') || code.includes('permission-denied')) {
    return createUserError('Firebase rechazó la operación. Revisa las reglas publicadas de Realtime Database.', code, error);
  }
  return createUserError(fallback, code || 'rok-online/error', error);
}

async function ensureAuthenticated() {
  if (auth.currentUser) return auth.currentUser;
  if (!authPromise) {
    authPromise = signInAnonymously(auth)
      .then(result => result.user)
      .catch(error => {
        authPromise = null;
        throw translateFirebaseError(error, 'No fue posible identificar al jugador.');
      });
  }
  return authPromise;
}

function clearRoomListener() {
  if (typeof roomUnsubscribe === 'function') roomUnsubscribe();
  roomUnsubscribe = null;
  hostReadyUpdatePending = false;
}

async function cancelDisconnectRegistration() {
  if (!disconnectRegistration) return;
  try { await disconnectRegistration.cancel(); } catch (_) {}
  disconnectRegistration = null;
}

async function writePresence(roomCode, uid, role) {
  const playerRef = ref(database, `rooms/${roomCode}/players/${uid}`);
  await set(playerRef, {
    role,
    connected: true,
    joinedAt: Date.now(),
  });

  const connectedRef = ref(database, `rooms/${roomCode}/players/${uid}/connected`);
  disconnectRegistration = onDisconnect(connectedRef);
  await disconnectRegistration.set(false);
}

function roomPlayerConnected(roomData, uid) {
  if (!uid) return false;
  return roomData?.players?.[uid]?.connected === true;
}

function attachRoomListener(roomCode, role, uid) {
  clearRoomListener();
  const roomRef = ref(database, `rooms/${roomCode}`);
  roomUnsubscribe = onValue(roomRef, snapshot => {
    if (!snapshot.exists()) {
      lobby.setState({ roomStatus: 'missing', opponentConnected: false });
      if (lobby.isOpen()) lobby.setNotice('La sala dejó de estar disponible.', 'error');
      return;
    }

    const roomData = snapshot.val() || {};
    const opponentUid = role === 'host' ? roomData.guestUid : roomData.hostUid;
    const opponentConnected = roomPlayerConnected(roomData, opponentUid);
    const gameData = roomData.game || null;
    lobby.setState({
      roomStatus: roomData.status || 'waiting',
      opponentConnected,
      matchStatus: gameData?.status || (roomData.status === 'playing' ? 'playing' : (roomData.status || 'waiting')),
      battleRevision: Number(gameData?.revision || 0),
    });

    const battleRevision = Number(gameData?.revision || 0);
    let battleState = gameData?.state || null;
    if (typeof gameData?.stateJson === 'string') {
      try { battleState = JSON.parse(gameData.stateJson); }
      catch (error) { lobby.reportError(error, 'Decodificar estado PVP'); }
    }
    if (gameData?.status === 'playing' && battleState && battleRevision >= lastDeliveredBattleRevision) {
      lastDeliveredBattleRevision = battleRevision;
      lobby.receiveBattleSnapshot?.({
        status: gameData.status,
        revision: battleRevision,
        state: battleState,
        stateHash: gameData.stateHash || gameData.stateJson || '',
        updatedBy: gameData.updatedBy || '',
        reason: gameData.reason || '',
        role,
      });
    }

    if (role === 'host' && roomData.guestUid && roomData.status === 'waiting' && !hostReadyUpdatePending) {
      hostReadyUpdatePending = true;
      update(roomRef, { status: 'ready' })
        .catch(error => lobby.reportError(error, 'Actualizar sala PVP a ready'))
        .finally(() => { hostReadyUpdatePending = false; });
    }

    if (!lobby.isOpen()) return;
    if (role === 'host') {
      if (opponentConnected) lobby.setNotice(`Jugador 2 conectado a la sala ${roomCode}. Enlace PVP confirmado.`, 'success');
      else if (roomData.guestUid) lobby.setNotice('El Jugador 2 se desconectó de la sala.', 'warning');
      else lobby.setNotice(`Sala ${roomCode} abierta. Esperando al Jugador 2…`);
    } else if (role === 'guest') {
      if (opponentConnected) lobby.setNotice(`Conectado con el Jugador 1 en la sala ${roomCode}. Enlace PVP confirmado.`, 'success');
      else lobby.setNotice('El Jugador 1 no aparece conectado.', 'warning');
    }
  }, error => {
    lobby.reportError(error, 'Escuchar sala PVP');
    if (lobby.isOpen()) lobby.setNotice(translateFirebaseError(error, 'Se perdió la conexión con la sala.').userMessage, 'error');
  });
}

async function leaveCurrentRoom({ finishHostRoom = false } = {}) {
  const active = currentRoom;
  clearRoomListener();
  await cancelDisconnectRegistration();
  if (!active) return;

  const playerConnectedRef = ref(database, `rooms/${active.roomCode}/players/${active.uid}/connected`);
  try { await set(playerConnectedRef, false); } catch (_) {}

  if (finishHostRoom && active.role === 'host') {
    try { await update(ref(database, `rooms/${active.roomCode}`), { status: 'finished' }); } catch (_) {}
  }
  currentRoom = null;
  lastDeliveredBattleRevision = 0;
}

async function createRoom() {
  const user = await ensureAuthenticated();
  await leaveCurrentRoom({ finishHostRoom: true });

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const roomCode = lobby.createCode();
    const roomRef = ref(database, `rooms/${roomCode}`);
    try {
      // Las reglas de Realtime Database autorizan la creación campo por campo.
      // update() conserva una sola operación atómica, pero valida cada hijo
      // (hostUid, status y createdAt) contra su regla específica.
      await update(roomRef, {
        hostUid: user.uid,
        status: 'waiting',
        createdAt: Date.now(),
      });
      await writePresence(roomCode, user.uid, 'host');
      currentRoom = { roomCode, role: 'host', uid: user.uid };
      attachRoomListener(roomCode, 'host', user.uid);
      return { roomCode, role: 'host', uid: user.uid, status: 'waiting' };
    } catch (error) {
      lastError = error;
    }
  }
  throw translateFirebaseError(lastError, 'No se pudo crear una sala disponible.');
}

async function joinRoom(rawCode) {
  const user = await ensureAuthenticated();
  const roomCode = lobby.normalizeCode(rawCode);
  if (roomCode.length !== 6) throw createUserError('El código debe tener seis caracteres.', 'rok-online/invalid-code');
  await leaveCurrentRoom({ finishHostRoom: true });

  const roomRef = ref(database, `rooms/${roomCode}`);
  let roomSnapshot;
  try {
    roomSnapshot = await get(roomRef);
  } catch (error) {
    const code = getFirebaseErrorCode(error);
    if (code.includes('PERMISSION_DENIED') || code.includes('permission-denied')) {
      throw createUserError('La sala no existe, ya terminó o el código es incorrecto.', 'rok-online/room-unavailable', error);
    }
    throw translateFirebaseError(error, 'No fue posible buscar la sala.');
  }

  if (!roomSnapshot.exists()) throw createUserError('No existe una sala con ese código.', 'rok-online/room-not-found');
  const roomData = roomSnapshot.val() || {};
  if (roomData.status !== 'waiting') throw createUserError('La sala ya no está esperando jugadores.', 'rok-online/room-not-waiting');
  if (roomData.hostUid === user.uid) throw createUserError('Este navegador ya es el creador de la sala.', 'rok-online/same-player');
  if (roomData.guestUid && roomData.guestUid !== user.uid) throw createUserError('La sala ya tiene dos jugadores.', 'rok-online/room-full');

  const guestRef = ref(database, `rooms/${roomCode}/guestUid`);
  let transactionResult;
  try {
    transactionResult = await runTransaction(guestRef, currentGuestUid => {
      if (currentGuestUid === null || currentGuestUid === user.uid) return user.uid;
      return undefined;
    }, { applyLocally: false });
  } catch (error) {
    throw translateFirebaseError(error, 'No fue posible ocupar el espacio del Jugador 2.');
  }

  if (!transactionResult.committed || transactionResult.snapshot.val() !== user.uid) {
    throw createUserError('La sala ya tiene dos jugadores.', 'rok-online/room-full');
  }

  try {
    await writePresence(roomCode, user.uid, 'guest');
  } catch (error) {
    throw translateFirebaseError(error, 'Se reservó la sala, pero no se pudo registrar la presencia del Jugador 2.');
  }

  currentRoom = { roomCode, role: 'guest', uid: user.uid };
  attachRoomListener(roomCode, 'guest', user.uid);
  return { roomCode, role: 'guest', uid: user.uid, status: 'ready' };
}

async function startBattle(initialState) {
  const active = currentRoom;
  if (!active || active.role !== 'host') throw createUserError('Solo el Jugador 1 puede iniciar el duelo.', 'rok-online/host-only');
  const roomRef = ref(database, `rooms/${active.roomCode}`);
  const roomSnapshot = await get(roomRef);
  const roomData = roomSnapshot.val() || {};
  if (!roomData.guestUid) throw createUserError('El Jugador 2 todavía no se ha unido.', 'rok-online/guest-missing');
  const stateJson = JSON.stringify(initialState);
  const stateHash = stateJson;
  const gamePayload = {
    status: 'playing',
    revision: 1,
    stateJson,
    stateHash,
    reason: 'match-start',
    updatedBy: active.uid,
    updatedAt: Date.now(),
    startedAt: Date.now(),
  };
  try {
    await update(roomRef, { status: 'playing', game: gamePayload });
  } catch (error) {
    throw translateFirebaseError(error, 'Firebase no permitió iniciar el duelo.');
  }
  lastDeliveredBattleRevision = 1;
  return { revision: 1, stateHash };
}

async function publishBattleState(payload = {}) {
  const active = currentRoom;
  if (!active) throw createUserError('No existe una sala PVP activa.', 'rok-online/no-room');
  const gameRef = ref(database, `rooms/${active.roomCode}/game`);
  let result;
  try {
    result = await runTransaction(gameRef, current => {
      if (!current || current.status !== 'playing') return undefined;
      if (payload.stateHash && current.stateHash === payload.stateHash) return current;
      const revision = Math.max(0, Number(current.revision || 0)) + 1;
      const stateJson = JSON.stringify(payload.state || {});
      return {
        ...current,
        status: 'playing',
        revision,
        stateJson,
        stateHash: payload.stateHash || stateJson,
        reason: String(payload.reason || 'state-change').slice(0, 80),
        updatedBy: active.uid,
        updatedAt: Date.now(),
      };
    }, { applyLocally: false });
  } catch (error) {
    throw translateFirebaseError(error, 'No se pudo sincronizar el estado del duelo.');
  }
  if (!result.committed) throw createUserError('La partida ya no está disponible.', 'rok-online/game-unavailable');
  const revision = Number(result.snapshot.val()?.revision || 0);
  lastDeliveredBattleRevision = Math.max(lastDeliveredBattleRevision, revision);
  return { revision };
}

async function leaveRoom() {
  await leaveCurrentRoom({ finishHostRoom: true });
}

lobby.registerAdapter({ createRoom, joinRoom, startBattle, publishBattleState, leaveRoom });
lobby.setState({ firebaseReady: true });

connectionUnsubscribe = onValue(ref(database, '.info/connected'), snapshot => {
  lobby.setState({ firebaseConnected: snapshot.val() === true });
});

ensureAuthenticated()
  .then(user => {
    lobby.setState({ authenticated: true, uid: user.uid, authError: '' });
    if (lobby.isOpen()) lobby.setNotice('Conexión lista. Puedes crear una sala o unirte mediante un código.', 'success');
  })
  .catch(error => {
    const translated = error?.userMessage ? error : translateFirebaseError(error, 'No fue posible iniciar Firebase Authentication.');
    lobby.setState({ authenticated: false, authError: translated.userMessage });
    lobby.setNotice(translated.userMessage, 'error');
    lobby.reportError(error, 'Firebase Authentication');
  });

window.addEventListener('beforeunload', () => {
  if (typeof connectionUnsubscribe === 'function') connectionUnsubscribe();
});

window.ROK_FIREBASE_ONLINE = {
  getCurrentRoom: () => currentRoom ? { ...currentRoom } : null,
  getUid: () => auth.currentUser?.uid || '',
  getDatabaseUrl: () => firebaseConfig.databaseURL,
  startBattle,
  publishBattleState,
};
