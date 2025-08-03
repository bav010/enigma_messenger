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
    connectionStatus.textContent = "📭 Чат удалён";
  }
}

function log(message, outgoing = false, peerId = currentPeer) {
  if (!peerId) {
    console.error("Попытка логирования без peerId");
    return;
  }
  
  const prefix = outgoing ? '>> ' : '<< ';
  const formatted = `${prefix}${message}\n`;
  
  console.log(`Логируем сообщение для ${peerId}: ${formatted.trim()}`);
  
  if (!messageHistory.has(peerId)) {
    messageHistory.set(peerId, []);
    console.log(`Создана новая история для ${peerId}`);
  }
  
  messageHistory.get(peerId).push(formatted);
  
  // Обновляем отображение только если это текущий чат
  if (peerId === currentPeer) {
    chatLog.value += formatted;
    chatLog.scrollTop = chatLog.scrollHeight;
    console.log(`Обновлен интерфейс чата для ${peerId}`);
  } else {
    console.log(`Сообщение сохранено для ${peerId}, но не отображено (текущий чат: ${currentPeer})`);
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
  // Определяем настройки в зависимости от окружения
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  
  const peerConfig = {
    host: location.hostname,
    path: "/peerjs",
    secure: location.protocol === 'https:',
    debug: 2 // Включаем отладку для диагностики
  };

  // Для локального окружения указываем порт
  if (isLocalhost) {
    peerConfig.port = location.port || (location.protocol === 'https:' ? 443 : 80);
  }
  // Для продакшена (Render) порт не указываем - будет использоваться стандартный

  console.log('PeerJS config:', peerConfig);

  peer = new Peer(suggestedId || undefined, peerConfig);

  peer.on("open", async id => {
    console.log('PeerJS connected with ID:', id);
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
    console.log(`Входящее соединение от ${conn.peer}`);
    if (conn.peer === myId) return;
    
    conn.on("open", () => {
      console.log(`Входящее соединение открыто от ${conn.peer}`);
      setupConnection(conn);
    });
  });

  peer.on("disconnected", () => {
    console.warn("⚠️ PeerJS: disconnected");
    connectionStatus.textContent = "⚠️ Потеряно соединение с сервером PeerJS";
    
    // Попытка переподключения через 3 секунды
    setTimeout(() => {
      if (peer.disconnected) {
        console.log("Попытка переподключения...");
        peer.reconnect();
      }
    }, 3000);
  });

  peer.on("error", err => {
    console.error("PeerJS error:", err);
    let errorMessage = "Неизвестная ошибка";
    
    if (err.type === 'network') {
      errorMessage = "Ошибка сети. Проверьте подключение к интернету";
    } else if (err.type === 'peer-unavailable') {
      errorMessage = "Собеседник недоступен";
    } else if (err.type === 'server-error') {
      errorMessage = "Ошибка сервера PeerJS";
    }
    
    alert("Ошибка PeerJS: " + errorMessage);
    connectionStatus.textContent = "❌ " + errorMessage;
  });
}

function connectToPeer() {
  const peerId = connectToEl.value.trim();
  if (!peerId || peerId === myId) return alert("Невозможно подключиться к себе");
  if (connections.has(peerId)) return switchChat(peerId);

  console.log(`Попытка подключения к ${peerId}`);
  const conn = peer.connect(peerId);

  conn.on("open", () => {
    console.log(`Исходящее соединение открыто с ${peerId}`);
    setupConnection(conn);
  });

  conn.on("error", err => {
    console.error("Ошибка соединения:", err);
    alert("Ошибка подключения к " + peerId);
  });
}

function setupConnection(conn) {
  const peerId = conn.peer;

  conn.on("open", () => {
    console.log(`Соединение открыто с ${peerId}`);
    connections.set(peerId, conn);
    addToChatList(peerId);
    
    // ВСЕГДА переключаемся на новый чат при установке соединения
    switchChat(peerId);
    
    log("🔗 Соединено с " + peerId, false, peerId);
    conn.send({ type: "version", version: CLIENT_VERSION });
  });

  conn.on("data", async data => {
    console.log(`Получены данные от ${peerId}:`, data);
    
    if (typeof data === "object" && data.type === "version") {
      if (data.version !== CLIENT_VERSION) {
        log(`⚠️ У собеседника версия ${data.version}`, false, peerId);
      }
      return;
    }

    // Расшифровка если включено шифрование
    let message = data;
    if (cipherSelect.value === "aes" && sharedKey) {
      try {
        message = await decryptMessage(data);
      } catch (e) {
        console.error("Ошибка расшифровки:", e);
        log("❌ Ошибка расшифровки", false, peerId);
        return;
      }
    }
    
    // Если нет активного чата, автоматически переключиться на отправителя
    if (!currentPeer) {
      console.log(`Автоматически переключаемся на чат с ${peerId}`);
      switchChat(peerId);
    }
    
    // Логируем сообщение
    log(message, false, peerId);
    
    // Если сообщение не от текущего активного собеседника, показать уведомление
    if (currentPeer !== peerId) {
      console.log(`Новое сообщение от ${peerId}: ${message}`);
      
      // Добавить визуальный индикатор непрочитанного сообщения
      const chatItem = [...chatListItems.children].find(li => li.dataset.peerId === peerId);
      if (chatItem) {
        chatItem.style.fontWeight = 'bold';
        chatItem.style.backgroundColor = '#e3f2fd';
      }
    }
  });

  conn.on("close", () => {
    console.log(`Соединение закрыто с ${peerId}`);
    connections.delete(peerId);
    if (currentPeer === peerId) {
      log("🔌 Чат закрылся: " + peerId, false, peerId);
      connectionStatus.textContent = "❌ Соединение закрыто";
      msgInput.disabled = true;
      sendBtn.disabled = true;
    }
  });

  conn.on("error", (err) => {
    console.error(`Ошибка соединения с ${peerId}:`, err);
  });
}

function switchChat(peerId) {
  if (!connections.has(peerId) && !messageHistory.has(peerId)) return;
  
  currentPeer = peerId;
  connectionStatus.textContent = "💬 Общение с " + peerId;
  msgInput.disabled = false;
  sendBtn.disabled = false;
  
  // Очистить визуальные индикаторы непрочитанных сообщений
  const chatItem = [...chatListItems.children].find(li => li.dataset.peerId === peerId);
  if (chatItem) {
    chatItem.style.fontWeight = 'normal';
    chatItem.style.backgroundColor = 'transparent';
  }
  
  // Загрузить историю чата
  chatLog.value = "";
  const history = messageHistory.get(peerId) || [];
  chatLog.value = history.join("");
  chatLog.scrollTop = chatLog.scrollHeight;
  
  console.log(`Переключился на чат с ${peerId}, история: ${history.length} сообщений`);
}

function sendMsg() {
  const msg = msgInput.value.trim();
  if (!msg || !currentPeer) return;

  const conn = connections.get(currentPeer);
  if (!conn?.open) {
    alert("Соединение с собеседником потеряно");
    return;
  }

  console.log(`Отправляем сообщение "${msg}" для ${currentPeer}`);

  if (cipherSelect.value === "aes" && sharedKey) {
    encryptMessage(msg).then(enc => {
      conn.send(enc);
      console.log("Зашифрованное сообщение отправлено");
    }).catch(err => {
      console.error("Ошибка шифрования:", err);
      alert("Ошибка при шифровании сообщения");
    });
  } else {
    conn.send(msg);
    console.log("Незашифрованное сообщение отправлено");
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
  nameSpan.onclick = () => {
    console.log(`Переключение на чат с ${peerId} по клику`);
    switchChat(peerId);
  };

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
  
  console.log(`Добавлен в список чатов: ${peerId}`);
}

function clearChatList() {
  chatListItems.innerHTML = "";
}

// Добавляем обработчик для Enter в поле сообщения
msgInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    sendMsg();
  }
});

copyIdBtn.onclick = () => {
  navigator.clipboard.writeText(myId).then(() => {
    copyIdBtn.textContent = "✅";
    setTimeout(() => copyIdBtn.textContent = "📋", 1000);
  });
};