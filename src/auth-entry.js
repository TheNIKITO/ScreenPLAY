// Contas do ScreenPLAY (Firebase): login com e-mail e senha, nick único e conferência de identidade.
// Empacotado por `npm run build:auth` em auth-bundle.js, que expõe window.SPAuth para o renderer.
//
// No Firestore:
//   usernames/{nick em minúsculas} -> { uid, name }   reserva do nick (garante que é único)
//   users/{uid}                    -> { name, nameLower }
//   profiles/{uid}                 -> { photo, fx }   foto (data URL pequena) e efeito no nome
//   presence/{uid}                 -> { on, at }      online/offline (o app avisa a cada 4 min e ao fechar)
//   invites/{código}               -> { gid }   convite de um grupo
//   groups/{gid}                   -> { name, photo, ownerUid, invite, memberUids, members: {uid: {name, via}}, createdAt }
//     channels/{cid}               -> { name, type: 'text' | 'stream', pos }
//       messages/{mid}             -> { uid, name, text, at, att? }   att = anexo (imagem ou arquivo)
//     files/{fid}                  -> { uid, chunks }   anexo guardado em pedaços: files/{fid}/chunks/{0..n} -> { d }
//     rooms/{cid}                  -> { people: [{uid, name, live}], at, by }   quem está em cada sala
//   dms/{uidA_uidB}                -> { uids, names, via, at, last, read }   mensagem privada (mesmas messages/ e files/)
// As regras de segurança (coladas no console do Firebase) só deixam cada um mexer na própria conta
// e só o dono do grupo mexer nos canais.

import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const CONFIG = {
  apiKey: 'AIzaSyDM-mLaWjPnIWCjhRk1PYdsRU_rsruvrxQ',
  authDomain: 'screenplay-77fc4.firebaseapp.com',
  projectId: 'screenplay-77fc4',
  storageBucket: 'screenplay-77fc4.firebasestorage.app',
  messagingSenderId: '1050907060931',
  appId: '1:1050907060931:web:19c89fb0dc481d0e8c1076',
};
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let auth = null;
let db = null;
let emulator = false;
let profile = null;            // { uid, email, nick, nickKey } — null se não estiver logado
let version = 0;               // cada leitura do perfil ganha um número; só a mais nova vale
const listeners = new Set();

function fail(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// Nick: 3 a 20 caracteres; letras (com acento), números, espaço, _ - .
const NICK_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 _.-]{3,20}$/;
function checkNick(raw) {
  const display = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!NICK_RE.test(display) || !/[A-Za-zÀ-ÖØ-öø-ÿ0-9]/.test(display)) throw fail('nick/invalid');
  return { display, key: display.toLowerCase() };
}

async function loadProfile(user) {
  if (!user) return null;
  let nick = '';
  let nickKey = '';
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      nick = snap.data().name || '';
      nickKey = snap.data().nameLower || '';
    }
  } catch (err) {
    console.warn('[conta] perfil', err && err.code);
    nick = user.displayName || '';   // sem internet pro banco: usa o nome guardado na conta
    nickKey = nick.toLowerCase();
  }
  return { uid: user.uid, email: user.email || '', nick, nickKey };
}

function emit() {
  for (const cb of listeners) {
    try { cb(profile); } catch (err) { console.error(err); }
  }
}

// Reserva o nick para a conta (e libera o antigo, numa troca), tudo de uma vez.
async function claimNick(user, nick, oldKey) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'usernames', nick.key);
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().uid !== user.uid) throw fail('nick/taken');
    if (!snap.exists()) tx.set(ref, { uid: user.uid, name: nick.display });
    tx.set(doc(db, 'users', user.uid), { name: nick.display, nameLower: nick.key });
    if (oldKey && oldKey !== nick.key) tx.delete(doc(db, 'usernames', oldKey));
  });
  await updateProfile(user, { displayName: nick.display });
  await user.getIdToken(true);   // a credencial passa a levar o nick novo
}

// ---------------- conferência de identidade (dentro das salas) ----------------
// Cada pessoa manda a credencial (ID token) da conta; quem cuida da sala confere a assinatura do
// Google e usa o nick que está DENTRO dela — ninguém consegue entrar com o nome de outro.
let jwksCache = { at: 0, keys: new Map() };
const b64urlBytes = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function googleKey(kid) {
  if (!jwksCache.keys.has(kid) || Date.now() - jwksCache.at > 3600 * 1000) {
    const res = await fetch(JWKS_URL);
    const { keys } = await res.json();
    jwksCache = { at: Date.now(), keys: new Map(keys.map((k) => [k.kid, k])) };
  }
  const jwk = jwksCache.keys.get(kid);
  if (!jwk) return null;
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

async function verifyToken(token) {
  try {
    if (typeof token !== 'string' || token.split('.').length !== 3) return null;
    const [h, p, sig] = token.split('.');
    const header = b64urlJson(h);
    const claims = b64urlJson(p);
    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== CONFIG.projectId) return null;
    if (claims.iss !== `https://securetoken.google.com/${CONFIG.projectId}`) return null;
    if (!claims.sub || claims.exp < now - 60 || claims.iat > now + 300) return null;
    if (emulator) {
      if (header.alg !== 'none' && header.alg !== 'RS256') return null;   // o emulador local não assina
    } else {
      if (header.alg !== 'RS256') return null;
      const key = await googleKey(header.kid);
      if (!key) return null;
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
      if (!ok) return null;
    }
    return { uid: claims.sub, name: claims.name || '' };
  } catch (err) {
    console.warn('[conta] credencial inválida', err);
    return null;
  }
}

// ---------------- perfil (foto e efeito no nome) ----------------
// As fotos ficam no próprio Firestore como texto (data URL), já reduzidas pelo app para 160x160.
const PHOTO_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const PHOTO_MAX = 150000;
const FX_LIST = ['', 'fire', 'bolt', 'water', 'ice', 'neon', 'rainbow'];
const cleanPhoto = (p) => (typeof p === 'string' && p.length <= PHOTO_MAX && PHOTO_RE.test(p) ? p : '');
function checkPhoto(p) {
  if (p && !cleanPhoto(p)) throw fail('photo/invalid');
  return p || '';
}
const profileFrom = (d) => ({ photo: cleanPhoto(d && d.photo), fx: d && FX_LIST.includes(d.fx) ? d.fx : '' });

// ---------------- grupos (estilo Discord) ----------------
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAGE = 50;   // mensagens por vez
function inviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');
}
const oneLine = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
function groupName(raw) {
  const name = oneLine(raw, 40);
  if (!name) throw fail('group/name');
  return name;
}
function channelName(raw) {
  const name = oneLine(raw, 30);
  if (!name) throw fail('channel/name');
  return name;
}
function whoAmI() {
  if (!auth || !auth.currentUser || !profile || !profile.nick) throw fail('auth/no-user');
  return { uid: auth.currentUser.uid, nick: profile.nick };
}
const millis = (t) => (t && t.toMillis ? t.toMillis() : 0);
const groupRef = (gid) => doc(db, 'groups', gid);
const channelsCol = (gid) => collection(db, 'groups', gid, 'channels');
const messagesCol = (gid, cid) => collection(db, 'groups', gid, 'channels', cid, 'messages');
const roomsCol = (gid) => collection(db, 'groups', gid, 'rooms');

function groupFrom(snap) {
  const d = snap.data({ serverTimestamps: 'estimate' });
  return {
    id: snap.id,
    name: d.name || '',
    photo: cleanPhoto(d.photo),
    ownerUid: d.ownerUid || '',
    invite: d.invite || '',
    memberUids: Array.isArray(d.memberUids) ? d.memberUids : [],
    members: d.members && typeof d.members === 'object' ? d.members : {},
    createdAt: millis(d.createdAt),
  };
}
const THUMB_RE = /^data:image\/(webp|jpeg|png|gif);base64,[A-Za-z0-9+/=]+$/;
// Anexo de uma mensagem: { kind: 'image' | 'file', name, size, mime, fid, chunks (+ w, h, thumb nas imagens) }
function attFrom(a) {
  if (!a || typeof a !== 'object' || typeof a.fid !== 'string' || !a.fid) return null;
  const chunks = Number(a.chunks) || 0;
  if (chunks < 1 || chunks > 16) return null;
  const base = {
    name: String(a.name || 'arquivo').slice(0, 120), size: Number(a.size) || 0,
    mime: String(a.mime || '').slice(0, 100), fid: a.fid, chunks,
  };
  if (a.kind === 'image' && typeof a.thumb === 'string' && THUMB_RE.test(a.thumb)) {
    return { kind: 'image', ...base, w: Number(a.w) || 0, h: Number(a.h) || 0, thumb: a.thumb };
  }
  if (a.kind === 'file') return { kind: 'file', ...base };
  return null;
}
function messageFrom(snap) {
  const d = snap.data({ serverTimestamps: 'estimate' });
  return {
    id: snap.id, uid: d.uid || '', name: d.name || '', text: d.text || '', att: attFrom(d.att),
    at: millis(d.at) || Date.now(), pending: snap.metadata.hasPendingWrites, cursor: snap,
  };
}
function watchError(what, onError) {
  return (err) => {
    console.warn(`[${what}]`, err && err.code);
    if (onError) onError(err);
  };
}

// ---------------- conversas (canais de texto e mensagens privadas) ----------------
// t = { gid, cid } (canal de texto de um grupo) ou { did } (mensagem privada).
// Anexos ficam no próprio Firestore, em pedaços de texto base64 (o Storage do Firebase exige plano pago).
const CHUNK_BYTES = 540000;   // múltiplo de 3: o base64 de cada pedaço emenda direitinho com o próximo
const chatMsgs = (t) => (t.did ? collection(db, 'dms', t.did, 'messages') : messagesCol(t.gid, t.cid));
const chatFiles = (t) => (t.did ? collection(db, 'dms', t.did, 'files') : collection(db, 'groups', t.gid, 'files'));

// Apaga um anexo (pedaços + ficha) dentro de um lote.
function deleteFileIn(batch, files, fid, chunks) {
  for (let i = 0; i < chunks; i++) batch.delete(doc(files, fid, 'chunks', String(i)));
  batch.delete(doc(files, fid));
}
// Apaga as mensagens de uma conversa (aos poucos) e os anexos delas.
async function clearChat(t) {
  for (let page = 0; page < 200; page++) {
    const qs = await getDocs(query(chatMsgs(t), limit(25)));
    if (qs.empty) return;
    const batch = writeBatch(db);
    for (const m of qs.docs) {
      batch.delete(m.ref);
      const a = attFrom(m.data().att);
      if (a) deleteFileIn(batch, chatFiles(t), a.fid, a.chunks);
    }
    await batch.commit();
    if (qs.size < 25) return;
  }
}
// Apaga anexos que sobraram (ex.: envio que caiu no meio).
async function clearFiles(files) {
  for (let page = 0; page < 200; page++) {
    const qs = await getDocs(query(files, limit(25)));
    if (qs.empty) return;
    const batch = writeBatch(db);
    for (const f of qs.docs) deleteFileIn(batch, files, f.id, Math.min(16, Number(f.data().chunks) || 0));
    await batch.commit();
    if (qs.size < 25) return;
  }
}

const Groups = {
  // Meus grupos, ao vivo (entrar, sair, renomear, apagar aparecem na hora).
  watchGroups(cb, onError) {
    const { uid } = whoAmI();
    const q = query(collection(db, 'groups'), where('memberUids', 'array-contains', uid));
    return onSnapshot(q, (qs) => cb(qs.docs.map(groupFrom)), watchError('grupos', onError));
  },

  // Cria o grupo já com um canal de texto e uma sala de transmissão.
  async createGroup(rawName) {
    const { uid, nick } = whoAmI();
    const name = groupName(rawName);
    for (let attempt = 0; ; attempt++) {
      const gid = doc(collection(db, 'groups')).id;
      const code = inviteCode();
      const batch = writeBatch(db);
      batch.set(doc(db, 'invites', code), { gid });
      batch.set(groupRef(gid), {
        name, ownerUid: uid, invite: code, memberUids: [uid],
        members: { [uid]: { name: nick, via: '' } }, createdAt: serverTimestamp(),
      });
      batch.set(doc(channelsCol(gid)), { name: 'geral', type: 'text', pos: 1 });
      batch.set(doc(channelsCol(gid)), { name: 'Transmissão', type: 'stream', pos: 2 });
      try {
        await batch.commit();
        return gid;
      } catch (err) {
        if (err.code === 'permission-denied' && attempt < 2) continue;   // código de convite repetido (raríssimo)
        throw err;
      }
    }
  },

  // Entra num grupo pelo código de convite.
  async joinGroup(rawCode) {
    const { uid, nick } = whoAmI();
    const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) throw fail('invite/invalid');
    const inv = await getDoc(doc(db, 'invites', code));
    if (!inv.exists()) throw fail('invite/not-found');
    const gid = inv.data().gid;
    try {
      const g = await getDocFromServer(groupRef(gid));   // só quem já é membro consegue ler
      if (g.exists()) return { gid, name: g.data().name || '', already: true };
    } catch { /* ainda não é membro: normal */ }
    await updateDoc(groupRef(gid), { memberUids: arrayUnion(uid), [`members.${uid}`]: { name: nick, via: code } });
    const g = await getDoc(groupRef(gid));
    return { gid, name: g.exists() ? g.data().name || '' : '', already: false };
  },

  async leaveGroup(gid) {
    const { uid } = whoAmI();
    await updateDoc(groupRef(gid), { memberUids: arrayRemove(uid), [`members.${uid}`]: deleteField() });
  },

  // Nome e/ou foto do grupo (só o dono).
  async updateGroup(gid, patch) {
    const data = {};
    if ('name' in patch) data.name = groupName(patch.name);
    if ('photo' in patch) data.photo = checkPhoto(patch.photo);
    if (Object.keys(data).length) await updateDoc(groupRef(gid), data);
  },

  // Troca o código de convite (o antigo para de funcionar).
  async newInvite(gid) {
    const snap = await getDoc(groupRef(gid));
    const old = snap.exists() ? snap.data().invite : '';
    for (let attempt = 0; ; attempt++) {
      const code = inviteCode();
      const batch = writeBatch(db);
      if (old) batch.delete(doc(db, 'invites', old));
      batch.set(doc(db, 'invites', code), { gid });
      batch.update(groupRef(gid), { invite: code });
      try {
        await batch.commit();
        return code;
      } catch (err) {
        if (err.code === 'permission-denied' && attempt < 2) continue;
        throw err;
      }
    }
  },

  // Apaga o grupo inteiro: mensagens, canais, salas, convite.
  async deleteGroup(gid) {
    const g = await getDoc(groupRef(gid));
    if (!g.exists()) return;
    const chans = await getDocs(channelsCol(gid));
    for (const ch of chans.docs) {
      if (ch.data().type === 'text') await clearChat({ gid, cid: ch.id });
    }
    await clearFiles(collection(db, 'groups', gid, 'files'));
    const rooms = await getDocs(roomsCol(gid));
    const batch = writeBatch(db);
    for (const ch of chans.docs) batch.delete(ch.ref);
    for (const r of rooms.docs) batch.delete(r.ref);
    if (g.data().invite) batch.delete(doc(db, 'invites', g.data().invite));
    batch.delete(groupRef(gid));
    await batch.commit();
  },

  // Meu nome dentro do grupo acompanha o usuário da conta.
  async syncMemberName(gid) {
    const { uid, nick } = whoAmI();
    await updateDoc(groupRef(gid), { [`members.${uid}.name`]: nick });
  },

  // Quem cuida de uma sala confere aqui se a pessoa é mesmo do grupo (lendo direto do servidor).
  async isMember(gid, uid) {
    try {
      const snap = await getDocFromServer(groupRef(gid));
      return snap.exists() && (snap.data().memberUids || []).includes(uid);
    } catch {
      return false;
    }
  },

  // ----- canais -----
  watchChannels(gid, cb, onError) {
    return onSnapshot(query(channelsCol(gid), orderBy('pos')), (qs) => {
      cb(qs.docs.map((s) => ({ id: s.id, name: s.data().name || '', type: s.data().type, pos: s.data().pos || 0 })));
    }, watchError('canais', onError));
  },
  async createChannel(gid, rawName, type) {
    if (type !== 'text' && type !== 'stream') throw fail('channel/type');
    const ref = doc(channelsCol(gid));
    await setDoc(ref, { name: channelName(rawName), type, pos: Date.now() });
    return ref.id;
  },
  async renameChannel(gid, cid, rawName) {
    await updateDoc(doc(channelsCol(gid), cid), { name: channelName(rawName) });
  },
  async deleteChannel(gid, cid) {
    await clearChat({ gid, cid });
    const batch = writeBatch(db);
    batch.delete(doc(channelsCol(gid), cid));
    batch.delete(doc(roomsCol(gid), cid));
    await batch.commit();
  },

  // ----- quem está em cada sala de transmissão -----
  watchRooms(gid, cb, onError) {
    return onSnapshot(roomsCol(gid), (qs) => {
      const out = {};
      for (const s of qs.docs) {
        const d = s.data({ serverTimestamps: 'estimate' });
        out[s.id] = { people: Array.isArray(d.people) ? d.people : [], at: millis(d.at) || Date.now() };
      }
      cb(out);
    }, watchError('salas', onError));
  },
  async setRoom(gid, cid, people) {
    const { uid } = whoAmI();
    await setDoc(doc(roomsCol(gid), cid), { people: people.slice(0, 30), at: serverTimestamp(), by: uid });
  },
};

const Chat = {
  chunkBytes: CHUNK_BYTES,
  // As 50 mais novas, ao vivo. cb(lista do mais velho pro mais novo, temMaisAntigas)
  watch(t, cb, onError) {
    const q = query(chatMsgs(t), orderBy('at', 'desc'), limit(PAGE));
    return onSnapshot(q, { includeMetadataChanges: true }, (qs) => {
      cb(qs.docs.map(messageFrom).reverse(), qs.size >= PAGE);
    }, watchError('mensagens', onError));
  },
  async older(t, oldest) {
    const qs = await getDocs(query(chatMsgs(t), orderBy('at', 'desc'), startAfter(oldest.cursor), limit(PAGE)));
    return { list: qs.docs.map(messageFrom).reverse(), more: qs.size >= PAGE };
  },
  async send(t, raw, att) {
    const { uid, nick } = whoAmI();
    const text = String(raw || '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
    if (!text && !att) return;
    const data = { uid, name: nick, text, at: serverTimestamp() };
    if (att) data.att = att;
    if (!t.did) {
      await addDoc(chatMsgs(t), data);
      return;
    }
    // Mensagem privada: a conversa guarda a última mensagem (pra lista e pro aviso de não lida).
    const preview = (text || (att.kind === 'image' ? '🖼️ Imagem' : `📎 ${att.name}`)).slice(0, 120);
    const batch = writeBatch(db);
    batch.set(doc(chatMsgs(t)), data);
    batch.update(doc(db, 'dms', t.did), {
      at: serverTimestamp(), last: { uid, text: preview, at: serverTimestamp() },
      [`names.${uid}`]: nick, [`read.${uid}`]: serverTimestamp(),
    });
    await batch.commit();
  },
  async remove(t, m) {
    const batch = writeBatch(db);
    batch.delete(doc(chatMsgs(t), m.id));
    if (m.att) deleteFileIn(batch, chatFiles(t), m.att.fid, m.att.chunks);
    await batch.commit();
  },
  // Guarda um anexo: parts = pedaços em base64 (até 16). onProgress(0..1)
  async upload(t, parts, onProgress) {
    const { uid } = whoAmI();
    if (!parts.length || parts.length > 16) throw fail('file/too-big');
    const ref = doc(chatFiles(t));
    await setDoc(ref, { uid, chunks: parts.length });
    for (let i = 0; i < parts.length; i++) {
      await setDoc(doc(ref, 'chunks', String(i)), { d: parts[i] });
      if (onProgress) onProgress((i + 1) / parts.length);
    }
    return { fid: ref.id, chunks: parts.length };
  },
  // Baixa um anexo: devolve os pedaços em base64, na ordem.
  async download(t, att, onProgress) {
    const out = [];
    for (let i = 0; i < att.chunks; i++) {
      const s = await getDoc(doc(chatFiles(t), att.fid, 'chunks', String(i)));
      if (!s.exists()) throw fail('file/missing');
      out.push(String(s.data().d || ''));
      if (onProgress) onProgress((i + 1) / att.chunks);
    }
    return out;
  },
};

// ---------------- mensagens privadas ----------------
const dmId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
function dmFrom(snap) {
  const d = snap.data({ serverTimestamps: 'estimate' });
  const read = {};
  for (const [k, v] of Object.entries(d.read || {})) read[k] = millis(v);
  return {
    id: snap.id,
    uids: Array.isArray(d.uids) ? d.uids : [],
    names: d.names && typeof d.names === 'object' ? d.names : {},
    at: millis(d.at),
    read,
    last: d.last && typeof d.last === 'object'
      ? { uid: d.last.uid || '', text: String(d.last.text || ''), at: millis(d.last.at) }
      : null,
  };
}
const Dms = {
  idFor: dmId,
  // Minhas conversas privadas, ao vivo.
  watch(cb, onError) {
    const { uid } = whoAmI();
    const q = query(collection(db, 'dms'), where('uids', 'array-contains', uid));
    return onSnapshot(q, (qs) => cb(qs.docs.map(dmFrom)), watchError('privadas', onError));
  },
  // Abre (ou cria) a conversa com alguém de um grupo em comum (viaGid).
  async ensure(otherUid, viaGid) {
    const { uid, nick } = whoAmI();
    if (!otherUid || otherUid === uid) throw fail('dm/self');
    const did = dmId(uid, otherUid);
    const ref = doc(db, 'dms', did);
    const exists = async () => {
      try { return (await getDoc(ref)).exists(); } catch { return false; }   // sem permissão = ainda não existe
    };
    if (await exists()) return did;
    const other = await getDoc(doc(db, 'users', otherUid));
    if (!other.exists()) throw fail('dm/no-user');
    try {
      await setDoc(ref, {
        uids: [uid, otherUid].sort(), names: { [uid]: nick, [otherUid]: other.data().name },
        via: viaGid, at: serverTimestamp(), read: {},
      });
    } catch (err) {
      if (await exists()) return did;   // a outra pessoa abriu a conversa no mesmo instante
      throw err;
    }
    return did;
  },
  async markRead(did) {
    const { uid, nick } = whoAmI();
    await updateDoc(doc(db, 'dms', did), { [`read.${uid}`]: serverTimestamp(), [`names.${uid}`]: nick });
  },
};

// ---------------- o que o app usa ----------------
window.SPAuth = {
  groups: Groups,
  chat: Chat,
  dms: Dms,
  // Liga o Firebase. Resolve com o perfil atual (ou null) assim que souber se já tem alguém logado.
  init(opts = {}) {
    const app = initializeApp(CONFIG);
    auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
    auth.languageCode = 'pt-BR';   // e-mails do Firebase (recuperar senha) em português
    db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
    if (opts.emulator) {
      emulator = true;
      const [host, authPort = '9099', dbPort = '8080'] = String(opts.emulator).split(':');
      connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
      connectFirestoreEmulator(db, host, Number(dbPort));
    }
    return new Promise((resolve) => {
      let first = true;
      onAuthStateChanged(auth, async (user) => {
        const v = ++version;
        const p = await loadProfile(user);
        if (first) { first = false; resolve(p); }
        if (v !== version) return;   // criar conta / trocar nick já mandou um perfil mais novo
        profile = p;
        emit();
      });
    });
  },
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  profile() { return profile; },

  checkNick(raw) { return checkNick(raw); },
  async nickAvailable(raw) {
    const nick = checkNick(raw);
    const snap = await getDoc(doc(db, 'usernames', nick.key));
    return !snap.exists() || (profile && snap.data().uid === profile.uid);
  },

  async signIn(email, password) {
    await signInWithEmailAndPassword(auth, String(email).trim(), password);
  },

  async signUp(rawNick, email, password) {
    const nick = checkNick(rawNick);
    const taken = await getDoc(doc(db, 'usernames', nick.key));
    if (taken.exists()) throw fail('nick/taken');
    const cred = await createUserWithEmailAndPassword(auth, String(email).trim(), password);
    try {
      await claimNick(cred.user, nick, null);
    } catch (err) {
      await deleteUser(cred.user).catch(() => {});   // não deixa conta sem nick para trás
      throw err;
    }
    const v = ++version;
    const p = await loadProfile(cred.user);
    if (v === version) { profile = p; emit(); }
  },

  // Para contas que ficaram sem nick (ex.: a internet caiu bem na hora de criar).
  async setNick(rawNick) {
    const user = auth.currentUser;
    if (!user) throw fail('auth/no-user');
    const nick = checkNick(rawNick);
    await claimNick(user, nick, profile && profile.nickKey);
    const v = ++version;
    const p = await loadProfile(user);
    if (v === version) { profile = p; emit(); }
    return p;
  },

  async resetPassword(email) {
    await sendPasswordResetEmail(auth, String(email).trim());
  },

  async signOut() {
    await signOut(auth);
  },

  async idToken() {
    return auth.currentUser ? auth.currentUser.getIdToken() : '';
  },

  verifyToken,

  // Perfil público de qualquer conta, ao vivo.
  watchProfile(uid, cb) {
    return onSnapshot(doc(db, 'profiles', uid),
      (snap) => cb(profileFrom(snap.exists() ? snap.data() : null)),
      () => cb(profileFrom(null)));
  },
  // Online/offline de qualquer conta, ao vivo. cb({ on, at, pending }) — ou cb(null, erro).
  watchPresence(uid, cb) {
    return onSnapshot(doc(db, 'presence', uid), (snap) => {
      const d = snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : null;
      cb({ on: !!(d && d.on), at: d ? millis(d.at) : 0, pending: snap.metadata.hasPendingWrites });
    }, (err) => cb(null, err));
  },
  async setPresence(on) {
    const { uid } = whoAmI();
    await setDoc(doc(db, 'presence', uid), { on: !!on, at: serverTimestamp() });
  },
  // Muda o meu perfil: { photo } e/ou { fx }.
  async saveProfile(patch) {
    const { uid } = whoAmI();
    const data = {};
    if ('photo' in patch) data.photo = checkPhoto(patch.photo);
    if ('fx' in patch) {
      if (!FX_LIST.includes(patch.fx)) throw fail('fx/invalid');
      data.fx = patch.fx;
    }
    await setDoc(doc(db, 'profiles', uid), data, { merge: true });
  },
};
