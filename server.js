const express = require('express');
const { ExpressPeerServer } = require('peer');
const bcrypt = require('bcrypt');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const path = require("path"); // Оставляем только здесь!

const app = express();
const server = http.createServer(app);
const peerServer = ExpressPeerServer(server, { path: '/peerjs' });
app.use('/peerjs', peerServer);
// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname))); // Отдаём фронтенд

// In-memory storage
let users = [];

app.post('/register', async (req, res) => {
  const { username, password, peerId } = req.body;
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ message: 'Пользователь уже существует' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  users.push({ username, passwordHash, peerId });
  res.json({ message: 'Регистрация успешна' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ message: 'Пользователь не найден' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ message: 'Неверный пароль' });
  res.json({ message: 'Успешный вход', peerId: user.peerId });
});

app.post('/updatePeerId', (req, res) => {
  const { username, peerId } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ message: 'Пользователь не найден' });
  user.peerId = peerId;
  res.json({ message: 'Peer ID обновлён' });
});

// Загружаем index.html по умолчанию
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
