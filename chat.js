const CLIENT_VERSION = "1.0.3";

let peer;
let myId = null;
let sharedKey = null;
const connections = new Map(); // peerId -> DataConnection
const messageHistory = new Map(); // peerId -> [messages]

const usernameEl = document.getElementById("username");
const passwordEl = document.getElementById("password");
const authStatusEl = document.getElementById("authStatus");
const authContainer = document.getElementById("authContainer");
const chatContainer = document.getElementById("chatContainer");
const myIdEl = document.getElementById("my-id");
const copyIdBtn = document.getElementById("copyIdBtn");
const connectToEl = document.getElementById("connectTo");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.querySelector("button[onclick='sendMsg()']");
const chatLog = document.getElementById("chatLog");
const keyInput = document.getElementById("keyInput");
const cipherSelect = document.getElementById("cipherSelect");
const keyStatus = document.getElementById("keyStatus");
const connectionStatus = document.getElementById("connectionStatus");
const chatListItems = document.getElementById("chatListItems");

let currentPeer = null;

function saveHistoryToStorage() {
  const history = {};
  for (let [peerId, messages] of messageHistory.entries()) {
    history[peerId] = messages;
  }
  localStorage.setItem("chat-history-" + myId, JSON.stringify(history));
}

function loadHistoryFromStorage() {
  const raw = localStorage.getItem("chat-history-" + myId);
  if (!raw) return;
  try {
    const history = JSON.parse(raw);
    for (let peerId in history) {
      messageHistory.set(peerId, history[peerId]);
      addToChatList(peerId);
    }
  } catch {}
}

function deleteChat(peerId) {
  messageHistory.delete(peerId);
  saveHistoryToStorage();
  const li = [...chatListItems.children].find(li => li.dataset.peerId === peerId);
  if (li) li.remove();
  if (currentPeer === peerId) {
    currentPeer = null;
    chatLog.value = "";
    msgInput.disabled = true;
    sendBtn.disabled = true;
    connectionStatus.textContent = "\ud83d\udceb \u0427\u0430\u0442 \u0443\u0434\u0430\u043b\u0451\u043d";
  }
}

function log(message, outgoing = false, peerId = currentPeer) {
  const prefix = outgoing ? '>> ' : '<< ';
  const formatted = `${prefix}${message}\n`;
  if (!messageHistory.has(peerId)) messageHistory.set(peerId, []);
  messageHistory.get(peerId).push(formatted);
  if (peerId === currentPeer) {
    chatLog.value += formatted;
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  saveHistoryToStorage();
}

async function register() {
  const username = usernameEl.value.trim();
  const password = passwordEl.value.trim();
  if (!username || !password) {
    authStatusEl.textContent = "Введите логин и пароль";
    return;
  }

  try {
    const res = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    authStatusEl.textContent = "✅ Регистрация успешна. Теперь войдите.";
  } catch (e) {
    authStatusEl.textContent = "❌ " + e.message;
  }
}

async function login() {
  const username = usernameEl.value.trim();
  const password = passwordEl.value.trim();

  if (!username || !password) {
    authStatusEl.textContent = "Введите логин и пароль";
    return;
  }

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message);

    startPeer(username, data.peerId);
  } catch (e) {
    authStatusEl.textContent = "❌ " + e.message;
  }
}

function startPeer(username, suggestedId) {
peer = new Peer(suggestedId || undefined, {
  host: location.hostname,
  port: location.protocol === "https:" ? 443 : 80,
  path: "/", // важно: путь изменён
  secure: location.protocol === "https:"
});

  peer.on("open", async id => {
    myId = id;
    myIdEl.textContent = id;
    authContainer.style.display = "none";
    chatContainer.style.display = "flex";
    connectionStatus.textContent = "✅ Готов к подключению...";
    loadHistoryFromStorage();

    try {
      await fetch("/updatePeerId", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, peerId: id })
      });
    } catch (e) {
      console.error("Не удалось обновить peerId на сервере", e);
    }

    fetch("version.json").then(r => r.json()).then(({ version }) => {
      if (version !== CLIENT_VERSION) {
        alert(`Доступна новая версия чата: ${version}`);
        location.reload();
      }
    }).catch(() => {});
  });

  peer.on("connection", conn => {
    if (conn.peer === myId) return;
    setupConnection(conn);
  });

  peer.on("error", err => {
    console.error(err);
    alert("Ошибка PeerJS: " + err.message);
  });
}


function connectToPeer() {
  const peerId = connectToEl.value.trim();
  if (!peerId || peerId === myId) return alert("Невозможно подключиться к себе");
  if (connections.has(peerId)) return switchChat(peerId);

  const conn = peer.connect(peerId);
  setupConnection(conn);
}

function setupConnection(conn) {
  const peerId = conn.peer;

  conn.on("open", () => {
    connections.set(peerId, conn);
    addToChatList(peerId);
    switchChat(peerId);
    log("🔗 Соединено с " + peerId, false, peerId);
    conn.send({ type: "version", version: CLIENT_VERSION });
  });

  conn.on("data", async data => {
    if (typeof data === "object" && data.type === "version") {
      if (data.version !== CLIENT_VERSION) {
        log(`⚠️ У собеседника версия ${data.version}`, false, peerId);
      }
      return;
    }

    if (cipherSelect.value === "aes" && sharedKey) {
      try {
        data = await decryptMessage(data);
      } catch (e) {
        log("Ошибка расшифровки", false, peerId);
        return;
      }
    }
    log(data, false, peerId);
  });

  conn.on("close", () => {
    connections.delete(peerId);
    if (currentPeer === peerId) {
      log("🔌 Чат закрылся: " + peerId, false, peerId);
      connectionStatus.textContent = "❌ Соединение закрыто";
      msgInput.disabled = true;
      sendBtn.disabled = true;
    }
  });
}

function switchChat(peerId) {
  if (!connections.has(peerId) && !messageHistory.has(peerId)) return;
  currentPeer = peerId;
  connectionStatus.textContent = "💬 Общение с " + peerId;
  msgInput.disabled = false;
  sendBtn.disabled = false;
  chatLog.value = "";
  const history = messageHistory.get(peerId) || [];
  chatLog.value = history.join("");
  chatLog.scrollTop = chatLog.scrollHeight;
}

function sendMsg() {
  const msg = msgInput.value.trim();
  if (!msg || !currentPeer) return;

  const conn = connections.get(currentPeer);
  if (!conn?.open) return;

  if (cipherSelect.value === "aes" && sharedKey) {
    encryptMessage(msg).then(enc => conn.send(enc));
  } else {
    conn.send(msg);
  }
  log(msg, true);
  msgInput.value = "";
}

function deriveKey() {
  const password = keyInput.value;
  if (!password) return alert("Введите пароль для ключа");

  const enc = new TextEncoder();
  window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]).then(baseKey => {
    return window.crypto.subtle.deriveKey({
      name: "PBKDF2",
      salt: enc.encode("peerjs-chat"),
      iterations: 100000,
      hash: "SHA-256"
    }, baseKey, { name: "AES-GCM", length: 128 }, false, ["encrypt", "decrypt"]);
  }).then(key => {
    sharedKey = key;
    keyStatus.textContent = "🔐 Ключ установлен";
  }).catch(() => alert("Ошибка при создании ключа"));
}

async function encryptMessage(message) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(message);
  const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, enc);
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) };
}

async function decryptMessage({ iv, data }) {
  const buffer = new Uint8Array(data);
  const ivArray = new Uint8Array(iv);
  const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: ivArray }, sharedKey, buffer);
  return new TextDecoder().decode(decrypted);
}

function addToChatList(peerId) {
  if ([...chatListItems.children].some(li => li.dataset.peerId === peerId)) return;

  const li = document.createElement("li");
  li.dataset.peerId = peerId;
  li.style.display = "flex";
  li.style.justifyContent = "space-between";
  li.style.alignItems = "center";
  li.style.padding = "4px 0";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = peerId;
  nameSpan.style.cursor = "pointer";
  nameSpan.onclick = () => switchChat(peerId);

  const delBtn = document.createElement("button");
  delBtn.innerHTML = "&times;";
  delBtn.title = "Удалить чат";
  delBtn.style.border = "none";
  delBtn.style.background = "transparent";
  delBtn.style.cursor = "pointer";
  delBtn.style.fontSize = "14px";
  delBtn.style.color = "#999";
  delBtn.style.width = "20px";
  delBtn.style.height = "20px";
  delBtn.style.lineHeight = "20px";
  delBtn.style.textAlign = "center";
  delBtn.style.borderRadius = "4px";

  delBtn.onmouseenter = () => delBtn.style.color = "#d00";
  delBtn.onmouseleave = () => delBtn.style.color = "#999";
  delBtn.onclick = (e) => {
    e.stopPropagation();
    deleteChat(peerId);
  };

  li.appendChild(nameSpan);
  li.appendChild(delBtn);
  chatListItems.appendChild(li);
}

function clearChatList() {
  chatListItems.innerHTML = "";
}

copyIdBtn.onclick = () => {
  navigator.clipboard.writeText(myId).then(() => {
    copyIdBtn.textContent = "✅";
    setTimeout(() => copyIdBtn.textContent = "📋", 1000);
  });
};