const express = require('express');
const bcrypt = require('bcrypt');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = 4000;

app.use(cors());
app.use(bodyParser.json());

let users = []; // Здесь будем хранить пользователей (в памяти)

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

app.listen(4000, '0.0.0.0', () => {
  console.log('Auth-сервер запущен на http://localhost:4000');
});