const express = require("express");
const { ExpressPeerServer } = require("peer");
const bcrypt = require("bcrypt");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const path = require("path");

const app = express();
const server = http.createServer(app);

// Настройка PeerJS сервера с более подробной конфигурацией
const peerServer = ExpressPeerServer(server, {
  path: "/",
  proxied: true, // Обязательно для Render/Heroku
  allow_discovery: true,
  generateClientId: () => {
    // Генерируем уникальный ID для клиента
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
});

// Обработка событий PeerJS сервера
peerServer.on('connection', (client) => {
  console.log(`PeerJS: Клиент подключился с ID: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`PeerJS: Клиент отключился с ID: ${client.getId()}`);
});

// Монтируем PeerJS сервер
app.use("/peerjs", peerServer);

// Middleware
app.use(cors({
  origin: true, // Разрешаем все источники для разработки
  credentials: true
}));
app.use(bodyParser.json());

// Обслуживание статических файлов
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, path) => {
    // Устанавливаем правильные заголовки для статических файлов
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

// In-memory users (временно, заменить на БД)
let users = [];

// API маршруты
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: "Логин и пароль обязательны" });
    }
    
    if (users.find((u) => u.username === username)) {
      return res.status(400).json({ message: "Пользователь уже существует" });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    users.push({ username, passwordHash, peerId: null });
    
    console.log(`Зарегистрирован новый пользователь: ${username}`);
    res.json({ message: "Регистрация успешна" });
  } catch (error) {
    console.error("Ошибка при регистрации:", error);
    res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: "Логин и пароль обязательны" });
    }
    
    const user = users.find((u) => u.username === username);
    if (!user) {
      return res.status(400).json({ message: "Пользователь не найден" });
    }
    
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ message: "Неверный пароль" });
    }
    
    console.log(`Пользователь ${username} вошёл в систему`);
    res.json({ message: "Успешный вход", peerId: user.peerId });
  } catch (error) {
    console.error("Ошибка при входе:", error);
    res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

app.post("/updatePeerId", (req, res) => {
  try {
    const { username, peerId } = req.body;
    
    if (!username || !peerId) {
      return res.status(400).json({ message: "Логин и PeerID обязательны" });
    }
    
    const user = users.find((u) => u.username === username);
    if (!user) {
      return res.status(400).json({ message: "Пользователь не найден" });
    }
    
    user.peerId = peerId;
    console.log(`Обновлён PeerID для ${username}: ${peerId}`);
    res.json({ message: "Peer ID обновлён" });
  } catch (error) {
    console.error("Ошибка при обновлении PeerID:", error);
    res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

// Маршрут для главной страницы
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Обработка статуса PeerJS сервера
app.get("/peerjs/status", (req, res) => {
  res.json({ 
    status: "online",
    clients: peerServer._clients ? Object.keys(peerServer._clients).length : 0,
    timestamp: new Date().toISOString()
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error("Ошибка сервера:", err);
  res.status(500).json({ message: "Внутренняя ошибка сервера" });
});

// Обработка 404
app.use((req, res) => {
  console.log(`404: ${req.method} ${req.url}`);
  res.status(404).json({ message: "Страница не найдена" });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📡 PeerJS сервер доступен по адресу /peerjs`);
  console.log(`🌐 Веб-интерфейс доступен по адресу /`);
});