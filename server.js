// server.js
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");

// --- PASTE YOUR DETAILS HERE ---
const token = "8350824476:AAEk31F_TaraYZBfwltuBU9Ebvc11AV4b-k";

// Get your Chat ID from @userinfobot on Telegram
const chatId = "1283168709";
const bot = new TelegramBot(token, { polling: true });
const app = express();

app.use(cors());
app.use(express.json());

let currentPatientStatus = "Awake";
let expressionDurations = {
  Happy: 0,
  Surprised: 0,
  Neutral: 0,
  Angry: 0,
};

app.post("/notify", (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).send({ error: "Message is required" });
  }
  bot
    .sendMessage(chatId, message)
    .then(() => {
      console.log(`Alert sent to Telegram: "${message}"`);
      res.status(200).send({ status: "Alert sent successfully" });
    })
    .catch((error) => {
      console.error("Telegram Error:", error);
      res.status(500).send({ error: "Failed to send alert" });
    });
});

app.post("/update-status", (req, res) => {
  const { status } = req.body;
  if (status) {
    currentPatientStatus = status;
    res.status(200).send({ message: "Status updated successfully" });
  } else {
    res.status(400).send({ error: "Status is required" });
  }
});

app.post("/update-expressions", (req, res) => {
  const { durations } = req.body;
  if (durations) {
    expressionDurations = durations;
    res.status(200).send({ message: "Expressions updated" });
  } else {
    res.status(400).send({ error: "Durations are required" });
  }
});

bot.onText(/\/status|\/sleep status/i, (msg) => {
  const fromId = msg.chat.id;
  const reply = `The patient's current status is: *${currentPatientStatus}*`;
  bot.sendMessage(fromId, reply, { parse_mode: "Markdown" });
});

bot.onText(/\/expressioninfo/i, (msg) => {
  const fromId = msg.chat.id;
  let reply = "*Patient Expression Report:*\n\n";

  for (const expression in expressionDurations) {
    const totalSeconds = Math.round(expressionDurations[expression]);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    reply += `*- ${expression}:* ${hours}h ${minutes}m ${seconds}s\n`;
  }

  bot.sendMessage(fromId, reply, { parse_mode: "Markdown" });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
