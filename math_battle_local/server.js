const express = require("express");
const mongoose = require("mongoose");
const QRCode = require("qrcode");
const os = require("os");
const path = require("path");
require("dotenv").config();

const app = express();

/* Render/Proxy ард ажиллахад https хаяг зөв үүсэхийн тулд */
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const memoryClasses = [];
let ClassModel = null;
const teacherTokens = new Set();
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || "math2026";
const crypto = require("crypto");

/*
  -----------------------------------------
  CORS: Vercel frontend → Render backend
  -----------------------------------------
*/
const ALLOWED_ORIGINS = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (
    origin &&
    (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))
  ) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      ALLOWED_ORIGINS.length === 0 ? "*" : origin,
    );
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, x-teacher-token",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/* Багшийн API-г token-оор хамгаална */
function requireTeacher(req, res, next) {
  const token = String(req.headers["x-teacher-token"] || req.query.token || "");
  if (!token || !teacherTokens.has(token)) {
    return res.status(401).json({ ok: false, message: "Нэвтрээгүй байна." });
  }
  next();
}

const STAGE_META = {
  1: {
    title: "Зэрэг ↔ Утга",
    subtitle: "Тооцооллын үндэс",
    type: "match",
    total: 10,
  },
  2: {
    title: "10-ын зэрэг",
    subtitle: "Арга зүй, жишээ",
    type: "quiz",
    total: 5,
    timerSec: 10,
  },
  3: {
    title: "Аравтын бутархай",
    subtitle: "10, 100, 1000, 10000-аар үржүүлэх / хуваах",
    type: "fill",
    total: 9,
    timerSec: 15,
  },
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatPlain(value) {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(10))).replace(/\.?0+$/, "");
}

function formatDisplay(value) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";

  if (Math.abs(value) >= 1000 && Number.isInteger(value)) {
    return Math.trunc(value).toLocaleString("en-US");
  }

  if (Math.abs(value) < 1 && value !== 0) {
    const s = value.toFixed(10).replace(/\.?0+$/, "");
    return s;
  }

  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

function powerHtml(exp) {
  return `10<sup>${exp}</sup>`;
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

function getBaseUrl(req) {
  const forwardedHost = req.headers["x-forwarded-host"];
  const hostHeader = forwardedHost
    ? String(forwardedHost).split(",")[0].trim()
    : req.get("host");

  if (
    hostHeader &&
    !hostHeader.startsWith("localhost") &&
    !hostHeader.startsWith("127.0.0.1") &&
    !hostHeader.startsWith("::1")
  ) {
    return `${req.protocol}://${hostHeader}`;
  }

  return `http://${getLocalIp()}:${PORT}`;
}

function makeClassCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += chars[randomInt(0, chars.length - 1)];
  }
  return code;
}

function makeChoices(correct) {
  const answer = formatPlain(correct);
  const distractors = new Set([answer]);
  const numeric = Number(correct);

  while (distractors.size < 4) {
    let candidate;
    if (Math.abs(numeric) > 0 && Math.abs(numeric) < 1) {
      const shift = pick([0.1, 10, 100, 0.01]);
      candidate = formatPlain(roundNice(numeric * shift));
    } else if ([10, 100, 1000, 10000, 100000].includes(numeric)) {
      candidate = formatPlain(
        pick([10, 100, 1000, 10000, 100000].filter((x) => x !== numeric)),
      );
    } else {
      const offset = randomInt(1, 5) * (randomInt(0, 1) === 0 ? 1 : -1);
      const scale = pick([1, 10, Math.max(1, Math.abs(numeric) / 10)]);
      candidate = formatPlain(roundNice(numeric + offset * scale));
    }
    if (
      candidate !== answer &&
      candidate !== "NaN" &&
      candidate !== "Infinity"
    ) {
      distractors.add(candidate);
    }
  }

  return {
    answer,
    answerDisplay: formatDisplay(Number(answer)),
    choices: shuffle(Array.from(distractors)).map((c) => ({
      value: c,
      display: formatDisplay(Number(c)),
    })),
  };
}

/** Stage 1: matching pairs — unique exponents from -7..7 */
function generateMatchRound() {
  const pool = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
  const exponents = shuffle(pool).slice(0, 10);

  const pairs = exponents.map((exp) => {
    const value = Math.pow(10, exp);
    return {
      id: `e${exp}`,
      exponent: exp,
      powerHtml: powerHtml(exp),
      powerText: `10^${exp}`,
      value,
      valueKey: formatPlain(value),
      valueDisplay: formatDisplay(value),
    };
  });

  return {
    type: "match",
    exponents: shuffle(
      pairs.map((p) => ({
        id: p.id,
        exponent: p.exponent,
        powerHtml: p.powerHtml,
        valueKey: p.valueKey,
      })),
    ),
    values: shuffle(
      pairs.map((p) => ({
        id: `v${p.id}`,
        valueKey: p.valueKey,
        valueDisplay: p.valueDisplay,
        matchId: p.id,
      })),
    ),
    pairs: pairs.map((p) => ({
      id: p.id,
      exponent: p.exponent,
      valueKey: p.valueKey,
    })),
  };
}

function generateStageTwoQuestion() {
  const a = randomInt(1, 9);
  const b = randomInt(1, 5);
  const value = a * Math.pow(10, b);
  const { answer, answerDisplay, choices } = makeChoices(value);

  return {
    promptHtml: `${a} × ${powerHtml(b)} = ?`,
    prompt: `${a} × 10^${b} = ?`,
    choices,
    answer,
    answerDisplay,
    explanation: "10-ын зэрэгтэй үржүүлээд тоог ол.",
  };
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function roundNice(n) {
  return Number(Number(n.toPrecision(12)));
}

function fmtNum(n) {
  const v = roundNice(n);
  if (Number.isInteger(v)) return String(v);
  return String(v);
}

function oneDecimal() {
  return roundNice(randomInt(11, 99) + randomInt(1, 9) / 10);
}

function twoDecimal() {
  return roundNice(randomInt(1, 9) + randomInt(10, 99) / 100);
}

function makeFillProblem(label, parts, answer) {
  const ans = roundNice(answer);
  const { answer: answerKey, answerDisplay, choices } = makeChoices(ans);
  const blankHtml = '<span class="blank-box">□</span>';
  const htmlLeft = parts.leftHtml.replace("□", blankHtml);
  const htmlRight = parts.rightHtml.replace("□", blankHtml);

  return {
    label,
    instruction: "Хоосон нүдэнд тохирох тоог нөхөж бич.",
    promptHtml: `<div class="fill-q"><span class="fill-label">${label}.</span> <span class="fill-eq">${htmlLeft} = ${htmlRight}</span></div>`,
    prompt: `${label}. ${parts.leftText} = ${parts.rightText}`,
    choices,
    answer: answerKey,
    answerDisplay: fmtNum(ans),
    explanation: "Аравтын цэгийг зөв тийш/зүүн тийш шилжүүл.",
  };
}

/** Stage 3: 9 fill-blank problems (а–и), decimal ×÷ by powers of 10 */
function generateStageThreeSet() {
  const problems = [];

  // а. A × □ = B  (blank = factor)
  {
    const A = oneDecimal();
    const f = pick([0.1, 0.01, 0.001, 0.0001]);
    const B = roundNice(A * f);
    problems.push(
      makeFillProblem(
        "а",
        {
          leftHtml: `${fmtNum(A)} × □`,
          rightHtml: fmtNum(B),
          leftText: `${fmtNum(A)} × □`,
          rightText: fmtNum(B),
        },
        f,
      ),
    );
  }

  // б. □ × D = R  (blank = left factor)
  {
    const D = pick([0.001, 0.01, 0.1]);
    const blank = pick([12.5, 34.8, 56.2, 78.4, 9.6, 45]);
    const R = roundNice(blank * D);
    problems.push(
      makeFillProblem(
        "б",
        {
          leftHtml: `□ × ${fmtNum(D)}`,
          rightHtml: fmtNum(R),
          leftText: `□ × ${fmtNum(D)}`,
          rightText: fmtNum(R),
        },
        blank,
      ),
    );
  }

  // в. N ÷ D = □  (blank = quotient)
  {
    const N = pick([315, 482, 750, 1260, 840]);
    const D = pick([10, 100, 1000, 10000]);
    const Q = roundNice(N / D);
    problems.push(
      makeFillProblem(
        "в",
        {
          leftHtml: `${fmtNum(N)} ÷ ${fmtNum(D)}`,
          rightHtml: "□",
          leftText: `${fmtNum(N)} ÷ ${fmtNum(D)}`,
          rightText: "□",
        },
        Q,
      ),
    );
  }

  // г. N × M = □  (blank = product), M is 10/100/1000/10000
  {
    const N = twoDecimal();
    const M = pick([10, 100, 1000, 10000]);
    const P = roundNice(N * M);
    problems.push(
      makeFillProblem(
        "г",
        {
          leftHtml: `${fmtNum(N)} × ${fmtNum(M)}`,
          rightHtml: "□",
          leftText: `${fmtNum(N)} × ${fmtNum(M)}`,
          rightText: "□",
        },
        P,
      ),
    );
  }

  // д. N × D = □  (blank = product), D is 0.1/0.01/...
  {
    const N = pick([2020, 3505, 1280, 450, 9090]);
    const D = pick([0.1, 0.01, 0.001]);
    const P = roundNice(N * D);
    problems.push(
      makeFillProblem(
        "д",
        {
          leftHtml: `${fmtNum(N)} × ${fmtNum(D)}`,
          rightHtml: "□",
          leftText: `${fmtNum(N)} × ${fmtNum(D)}`,
          rightText: "□",
        },
        P,
      ),
    );
  }

  // е. N × □ = R  (blank = factor), R much larger
  {
    const N = pick([0.25, 0.4, 0.125, 0.8, 0.05]);
    const f = pick([1000, 10000, 100]);
    const R = roundNice(N * f);
    problems.push(
      makeFillProblem(
        "е",
        {
          leftHtml: `${fmtNum(N)} × □`,
          rightHtml: fmtNum(R),
          leftText: `${fmtNum(N)} × □`,
          rightText: fmtNum(R),
        },
        f,
      ),
    );
  }

  // ж. N × □ = R  (blank = factor), R much smaller
  {
    const N = pick([0.09, 0.8, 0.6, 0.25, 0.12]);
    const f = pick([0.001, 0.0001, 0.01]);
    const R = roundNice(N * f);
    problems.push(
      makeFillProblem(
        "ж",
        {
          leftHtml: `${fmtNum(N)} × □`,
          rightHtml: fmtNum(R),
          leftText: `${fmtNum(N)} × □`,
          rightText: fmtNum(R),
        },
        f,
      ),
    );
  }

  // з. N × □ = R  (blank = factor)
  {
    const N = pick([0.007, 0.005, 0.002, 0.008]);
    const f = pick([1000, 10000, 100000]);
    const R = roundNice(N * f);
    problems.push(
      makeFillProblem(
        "з",
        {
          leftHtml: `${fmtNum(N)} × □`,
          rightHtml: fmtNum(R),
          leftText: `${fmtNum(N)} × □`,
          rightText: fmtNum(R),
        },
        f,
      ),
    );
  }

  // и. N ÷ □ = R  (blank = divisor)  → N = R * blank
  {
    const R = pick([25, 40, 50, 80, 125, 350]);
    const blank = pick([0.001, 0.01, 0.1, 0.0001]);
    const left = roundNice(R * blank);
    problems.push(
      makeFillProblem(
        "и",
        {
          leftHtml: `${fmtNum(left)} ÷ □`,
          rightHtml: fmtNum(R),
          leftText: `${fmtNum(left)} ÷ □`,
          rightText: fmtNum(R),
        },
        blank,
      ),
    );
  }

  return problems;
}

function generateStageQuestions(stage, total) {
  if (stage === 1) return generateMatchRound();
  if (stage === 2)
    return Array.from({ length: total }, () => generateStageTwoQuestion());
  return generateStageThreeSet();
}

function emptyScores() {
  return { stage1: 0, stage2: 0, stage3: 0, total: 0 };
}

function hasStageAnswers(student, stage) {
  const responses = student.responses || {};
  const list = responses[`stage${stage}`];
  return Array.isArray(list) && list.length > 0;
}

function isStudentFinished(student) {
  return !!(student && (student.finished || hasStageAnswers(student, 3)));
}

function studentPlayStatus(student) {
  if (!student) return "unknown";
  if (isStudentFinished(student)) return "finished";
  if (
    hasStageAnswers(student, 1) ||
    hasStageAnswers(student, 2) ||
    hasStageAnswers(student, 3)
  ) {
    return "in_progress";
  }
  return "waiting";
}

function summarizeStudent(student) {
  const scores = student.scores || emptyScores();
  const status = studentPlayStatus(student);
  return {
    name: student.name,
    joinedAt: student.joinedAt,
    finished: status === "finished",
    finishedAt: student.finishedAt || null,
    playingStage: Number(student.playingStage || 0),
    status,
    statusLabel:
      status === "finished"
        ? "Дууссан"
        : status === "in_progress"
          ? "Хийж байна"
          : "Хүлээж байна",
    scores: {
      stage1: Number(scores.stage1 || 0),
      stage2: Number(scores.stage2 || 0),
      stage3: Number(scores.stage3 || 0),
      total: Number(scores.total || 0),
    },
    responses: student.responses || { stage1: [], stage2: [], stage3: [] },
  };
}

function computeStageScore(stage, answers) {
  if (!Array.isArray(answers)) return 0;
  const correct = answers.filter((a) => a && a.isCorrect).length;
  const wrong = answers.filter((a) => a && a.isCorrect === false).length;
  if (stage === 1) {
    // Зөв хос бүр +1, буруу оролдлого бүр −1 (0-ээс доош буухгүй)
    return Math.max(0, correct - wrong);
  }
  return correct;
}

async function connectDatabase() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.log("MongoDB URI not set — running with in-memory storage");
    return;
  }

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log("MongoDB connected");

    const classSchema = new mongoose.Schema(
      {
        code: { type: String, required: true, unique: true },
        className: String,
        joinUrl: String,
        qrDataUrl: String,
        students: [
          {
            name: String,
            joinedAt: Date,
            finished: { type: Boolean, default: false },
            finishedAt: Date,
            playingStage: { type: Number, default: 0 },
            scores: {
              stage1: { type: Number, default: 0 },
              stage2: { type: Number, default: 0 },
              stage3: { type: Number, default: 0 },
              total: { type: Number, default: 0 },
            },
            responses: {
              stage1: Array,
              stage2: Array,
              stage3: Array,
            },
          },
        ],
        gameStarted: { type: Boolean, default: false },
        currentStage: { type: Number, default: 0 },
        status: { type: String, default: "waiting" },
        startedAt: Date,
        createdAt: { type: Date, default: Date.now },
      },
      { collection: "math_classes" },
    );

    ClassModel =
      mongoose.models.MathClass || mongoose.model("MathClass", classSchema);
  } catch (error) {
    console.warn(
      "MongoDB unavailable, using in-memory storage:",
      error.message,
    );
  }
}

async function saveClass(room) {
  if (ClassModel) {
    const exists = await ClassModel.findOne({ code: room.code });
    if (!exists) {
      await ClassModel.create(room);
    }
    return room;
  }

  const existing = memoryClasses.find((item) => item.code === room.code);
  if (!existing) memoryClasses.push(room);
  return room;
}

async function getClassByCode(code) {
  const normalizedCode = String(code || "").toUpperCase();

  if (ClassModel) {
    return ClassModel.findOne({ code: normalizedCode }).lean();
  }

  return memoryClasses.find((room) => room.code === normalizedCode) || null;
}

async function createClassRoom(className, req) {
  const code = makeClassCode();
  const joinUrl = `${getBaseUrl(req)}/?c=${code}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    type: "image/png",
  });

  const room = {
    code,
    className,
    joinUrl,
    qrDataUrl,
    students: [],
    gameStarted: false,
    currentStage: 0,
    status: "waiting",
    startedAt: null,
    createdAt: new Date(),
  };

  return saveClass(room);
}

async function startGameForClass(code) {
  const normalizedCode = String(code || "").toUpperCase();

  if (ClassModel) {
    const room = await ClassModel.findOne({ code: normalizedCode });
    if (!room) return null;

    if (!room.students || room.students.length === 0) {
      return {
        error: "Бэлэн хүүхэд байхгүй тул тоглоом эхлүүлэх боломжгүй байна.",
      };
    }

    room.gameStarted = true;
    room.currentStage = 1;
    room.status = "in_progress";
    room.startedAt = new Date();
    await room.save();
    return room.toObject();
  }

  const room = memoryClasses.find((item) => item.code === normalizedCode);
  if (!room) return null;

  if (!room.students || room.students.length === 0) {
    return {
      error: "Бэлэн хүүхэд байхгүй тул тоглоом эхлүүлэх боломжгүй байна.",
    };
  }

  room.gameStarted = true;
  room.currentStage = 1;
  room.status = "in_progress";
  room.startedAt = new Date();
  return room;
}

async function stopGameForClass(code) {
  const normalizedCode = String(code || "").toUpperCase();

  if (ClassModel) {
    const room = await ClassModel.findOne({ code: normalizedCode });
    if (!room) return null;
    room.gameStarted = false;
    room.status = "stopped";
    await room.save();
    return room.toObject();
  }

  const room = memoryClasses.find((item) => item.code === normalizedCode);
  if (!room) return null;
  room.gameStarted = false;
  room.status = "stopped";
  return room;
}

async function removeStudentFromClass(code, name) {
  const normalizedCode = String(code || "").toUpperCase();
  const studentName = String(name || "")
    .trim()
    .toLowerCase();
  if (!studentName) return { error: "Нэр оруулна уу." };

  if (ClassModel) {
    const room = await ClassModel.findOne({ code: normalizedCode });
    if (!room) return null;
    const before = (room.students || []).length;
    room.students = (room.students || []).filter(
      (s) => s.name.toLowerCase() !== studentName,
    );
    if (room.students.length === before) {
      return { error: "Сурагч олдсонгүй." };
    }
    await room.save();
    return { room: room.toObject() };
  }

  const room = memoryClasses.find((item) => item.code === normalizedCode);
  if (!room) return null;
  const before = (room.students || []).length;
  room.students = (room.students || []).filter(
    (s) => s.name.toLowerCase() !== studentName,
  );
  if (room.students.length === before) {
    return { error: "Сурагч олдсонгүй." };
  }
  return { room };
}

function newStudentRecord(studentName) {
  return {
    name: studentName,
    joinedAt: new Date(),
    finished: false,
    finishedAt: null,
    playingStage: 0,
    scores: emptyScores(),
    responses: { stage1: [], stage2: [], stage3: [] },
  };
}

async function addStudentToClass(code, name) {
  const normalizedCode = String(code || "").toUpperCase();
  const studentName = String(name || "").trim();
  if (!studentName) return null;

  if (ClassModel) {
    const room = await ClassModel.findOne({ code: normalizedCode });
    if (!room) return null;

    const existing = (room.students || []).find(
      (s) => s.name.toLowerCase() === studentName.toLowerCase(),
    );
    if (existing && isStudentFinished(existing)) {
      return {
        room: room.toObject(),
        alreadyFinished: true,
        student: existing,
      };
    }

    if (!existing) {
      room.students.push(newStudentRecord(studentName));
      await room.save();
    }
    return { room: room.toObject(), alreadyFinished: false };
  }

  const room = memoryClasses.find((item) => item.code === normalizedCode);
  if (!room) return null;
  if (!room.students) room.students = [];

  const existing = room.students.find(
    (s) => s.name.toLowerCase() === studentName.toLowerCase(),
  );
  if (existing && isStudentFinished(existing)) {
    return { room, alreadyFinished: true, student: existing };
  }

  if (!existing) {
    room.students.push(newStudentRecord(studentName));
  }
  return { room, alreadyFinished: false };
}

function applyStageAnswers(target, stage, answers) {
  if (isStudentFinished(target)) {
    return {
      error: "Та аль хэдийн шалгалт өгсөн байна. Дахин өгөх боломжгүй.",
    };
  }

  const key = `stage${stage}`;
  if (!target.responses)
    target.responses = { stage1: [], stage2: [], stage3: [] };
  if (!target.scores) target.scores = emptyScores();

  if (hasStageAnswers(target, stage)) {
    return {
      error: `Үе ${stage}-ийн хариулт аль хэдийн илгээгдсэн. Дахин илгээх боломжгүй.`,
    };
  }

  const stageScore = computeStageScore(stage, answers);
  target.responses[key] = answers;
  target.scores[key] = stageScore;
  target.scores.total =
    Number(target.scores.stage1 || 0) +
    Number(target.scores.stage2 || 0) +
    Number(target.scores.stage3 || 0);

  if (stage === 3) {
    target.finished = true;
    target.finishedAt = new Date();
  }

  target.playingStage = stage;
  return { ok: true };
}

async function updateLiveProgress(code, studentName, payload) {
  const normalizedCode = String(code || "").toUpperCase();
  const name = String(studentName || "").trim();
  const stage = Number(payload.stage) || 0;
  const score = Math.max(0, Number(payload.score) || 0);

  if (ClassModel) {
    const room = await ClassModel.findOne({ code: normalizedCode });
    if (!room) return null;
    let target = (room.students || []).find(
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    if (!target) {
      room.students.push(newStudentRecord(name));
      target = room.students[room.students.length - 1];
    }
    if (isStudentFinished(target)) {
      return { error: "Шалгалт аль хэдийн дууссан.", room: room.toObject() };
    }
    if (!target.scores) target.scores = emptyScores();
    if (stage >= 1 && stage <= 3) {
      target.playingStage = stage;
      target.scores[`stage${stage}`] = score;
      target.scores.total =
        Number(target.scores.stage1 || 0) +
        Number(target.scores.stage2 || 0) +
        Number(target.scores.stage3 || 0);
    }
    await room.save();
    return { room: room.toObject() };
  }

  const room = memoryClasses.find((item) => item.code === normalizedCode);
  if (!room) return null;
  let target = (room.students || []).find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
  if (!target) {
    room.students.push(newStudentRecord(name));
    target = room.students[room.students.length - 1];
  }
  if (isStudentFinished(target)) {
    return { error: "Шалгалт аль хэдийн дууссан.", room };
  }
  if (!target.scores) target.scores = emptyScores();
  if (stage >= 1 && stage <= 3) {
    target.playingStage = stage;
    target.scores[`stage${stage}`] = score;
    target.scores.total =
      Number(target.scores.stage1 || 0) +
      Number(target.scores.stage2 || 0) +
      Number(target.scores.stage3 || 0);
  }
  return { room };
}

async function recordStageAnswers(code, studentName, stage, answers) {
  const normalizedCode = String(code || "").toUpperCase();
  const name = String(studentName || "").trim();

  if (ClassModel) {
    const room = await ClassModel.findOne({ code: normalizedCode });
    if (!room) return null;

    let target = (room.students || []).find(
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    if (!target) {
      room.students.push(newStudentRecord(name));
      target = room.students[room.students.length - 1];
    }

    const result = applyStageAnswers(target, stage, answers);
    if (result.error) return { error: result.error, room: room.toObject() };

    await room.save();
    return { room: room.toObject() };
  }

  const room = memoryClasses.find((item) => item.code === normalizedCode);
  if (!room) return null;

  let target = (room.students || []).find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
  if (!target) {
    room.students.push(newStudentRecord(name));
    target = room.students[room.students.length - 1];
  }

  const result = applyStageAnswers(target, stage, answers);
  if (result.error) return { error: result.error, room };

  return { room };
}

async function deleteClassByCode(code) {
  const normalizedCode = String(code || "").toUpperCase();

  if (ClassModel) {
    const result = await ClassModel.deleteOne({ code: normalizedCode });
    return result.deletedCount > 0;
  }

  const idx = memoryClasses.findIndex((item) => item.code === normalizedCode);
  if (idx === -1) return false;
  memoryClasses.splice(idx, 1);
  return true;
}

function findStudentInRoom(room, name) {
  const n = String(name || "")
    .trim()
    .toLowerCase();
  return (room.students || []).find((s) => s.name.toLowerCase() === n) || null;
}

function mapClassSummary(room) {
  const students = (room.students || []).map(summarizeStudent);
  students.sort((a, b) => (b.scores.total || 0) - (a.scores.total || 0));
  const finishedCount = students.filter((s) => s.finished).length;
  return {
    code: room.code,
    className: room.className,
    joinUrl: room.joinUrl,
    qrDataUrl: room.qrDataUrl || null,
    students,
    studentCount: students.length,
    finishedCount,
    gameStarted: !!room.gameStarted,
    currentStage: Number(room.currentStage || 0),
    status: room.status || (room.gameStarted ? "in_progress" : "waiting"),
    createdAt: room.createdAt,
    stages: STAGE_META,
  };
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

/* QR join холбоос: /?c=CODE → join хуудас */
app.get("/", (req, res) => {
  if (req.query.c) {
    return res.sendFile(path.join(publicDir, "join.html"));
  }

  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    return res.redirect(302, frontendUrl);
  }

  res.redirect(302, "/join");
});

app.get("/join", (req, res) => {
  res.sendFile(path.join(publicDir, "join.html"));
});

app.get("/student", (req, res) => {
  res.sendFile(path.join(publicDir, "student.html"));
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, mode: ClassModel ? "mongo" : "memory" });
});

app.post("/api/teacher/login", (req, res) => {
  const password = String((req.body && req.body.password) || "");
  const username =
    String((req.body && req.body.username) || "").trim() || "bagsh";

  if (password !== TEACHER_PASSWORD) {
    return res.status(401).json({ message: "Нууц үг буруу байна." });
  }

  const token = crypto.randomBytes(24).toString("hex");
  teacherTokens.add(token);
  res.json({
    ok: true,
    token,
    username,
    message: "Амжилттай нэвтэрлээ.",
  });
});

app.post("/api/teacher/logout", (req, res) => {
  const token = String(
    (req.body && req.body.token) || req.headers["x-teacher-token"] || "",
  );
  teacherTokens.delete(token);
  res.json({ ok: true });
});

app.get("/api/teacher/me", (req, res) => {
  const token = String(req.headers["x-teacher-token"] || req.query.token || "");
  if (!token || !teacherTokens.has(token)) {
    return res.status(401).json({ ok: false, message: "Нэвтрээгүй байна." });
  }
  res.json({ ok: true });
});

app.post("/api/student/progress", async (req, res) => {
  const { code, name, stage, score } = req.body || {};
  if (!code || !name || !Number(stage)) {
    return res.status(400).json({ message: "Мэдээлэл дутуу." });
  }
  const updated = await updateLiveProgress(code, name, {
    stage: Number(stage),
    score,
  });
  if (!updated) return res.status(404).json({ message: "Анги олдсонгүй." });
  if (updated.error) return res.status(409).json({ message: updated.error });

  const student = findStudentInRoom(updated.room, name);
  res.json({
    ok: true,
    scores: student ? summarizeStudent(student).scores : emptyScores(),
    playingStage: student ? Number(student.playingStage || 0) : 0,
  });
});

app.post("/api/teacher/class", requireTeacher, async (req, res) => {
  const className = String(req.body.className || "").trim();
  if (!className) {
    return res.status(400).json({ message: "Ангины нэр оруулна уу." });
  }

  const room = await createClassRoom(className, req);
  return res.json({
    className: room.className,
    code: room.code,
    joinUrl: room.joinUrl,
    qrDataUrl: room.qrDataUrl,
    stages: STAGE_META,
  });
});

app.get("/api/teacher/classes", requireTeacher, async (req, res) => {
  let classes = [];

  if (ClassModel) {
    classes = await ClassModel.find({}).sort({ createdAt: -1 }).lean();
  } else {
    classes = [...memoryClasses].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );
  }

  res.json({ classes: classes.map(mapClassSummary), stages: STAGE_META });
});

app.get("/api/class/:code", async (req, res) => {
  const room = await getClassByCode(req.params.code);
  if (!room) {
    return res.status(404).json({ message: "Анги олдсонгүй." });
  }

  res.json(mapClassSummary(room));
});

app.post("/api/teacher/class/:code/start", requireTeacher, async (req, res) => {
  const room = await startGameForClass(req.params.code);
  if (!room) {
    return res.status(404).json({ message: "Анги олдсонгүй." });
  }

  if (room.error) {
    return res.status(400).json({ message: room.error });
  }

  res.json({
    ok: true,
    code: room.code,
    className: room.className,
    gameStarted: true,
    currentStage: 1,
    message: "3 үе шаттай тоглоом эхлүүллээ.",
  });
});

app.post("/api/teacher/class/:code/stop", requireTeacher, async (req, res) => {
  const room = await stopGameForClass(req.params.code);
  if (!room) {
    return res.status(404).json({ message: "Анги олдсонгүй." });
  }
  res.json({
    ok: true,
    code: room.code,
    className: room.className,
    gameStarted: false,
    status: "stopped",
    message: "Тоглоомыг зогсоолоо.",
  });
});

app.delete(
  "/api/teacher/class/:code/student",
  requireTeacher,
  async (req, res) => {
    const name = String(
      (req.body && req.body.name) || req.query.name || "",
    ).trim();
    if (!name) {
      return res.status(400).json({ message: "Сурагчийн нэр оруулна уу." });
    }

    const result = await removeStudentFromClass(req.params.code, name);
    if (!result) {
      return res.status(404).json({ message: "Анги олдсонгүй." });
    }
    if (result.error) {
      return res.status(404).json({ message: result.error });
    }

    res.json({
      ok: true,
      message: `${name} ангиас гарлаа.`,
      class: mapClassSummary(result.room),
    });
  },
);

app.delete("/api/teacher/class/:code", requireTeacher, async (req, res) => {
  const ok = await deleteClassByCode(req.params.code);
  if (!ok) {
    return res.status(404).json({ message: "Анги олдсонгүй." });
  }
  res.json({ ok: true, message: "Анги устгагдлаа." });
});

app.get("/api/student/status", async (req, res) => {
  const code = String(req.query.code || "")
    .trim()
    .toUpperCase();
  const name = String(req.query.name || "").trim();
  if (!code || !name) {
    return res.status(400).json({ message: "Код болон нэр шаардлагатай." });
  }

  const room = await getClassByCode(code);
  if (!room) {
    return res.status(404).json({ message: "Анги олдсонгүй." });
  }

  const student = findStudentInRoom(room, name);
  if (!student) {
    return res.json({
      ok: true,
      exists: false,
      finished: false,
      gameStarted: !!room.gameStarted,
      className: room.className,
      code: room.code,
    });
  }

  const summary = summarizeStudent(student);
  return res.json({
    ok: true,
    exists: true,
    finished: summary.finished,
    status: summary.status,
    scores: summary.scores,
    gameStarted: !!room.gameStarted,
    className: room.className,
    code: room.code,
    stagesDone: {
      stage1: hasStageAnswers(student, 1),
      stage2: hasStageAnswers(student, 2),
      stage3: hasStageAnswers(student, 3),
    },
  });
});

app.post("/api/student/join", async (req, res) => {
  const code = String(req.body.code || "")
    .trim()
    .toUpperCase();
  const name = String(req.body.name || "").trim();

  if (!code || !name) {
    return res.status(400).json({ message: "Анги болон нэрээ оруулна уу." });
  }

  const room = await getClassByCode(code);
  if (!room) {
    return res.status(404).json({ message: "Ийм анги олдсонгүй." });
  }

  const result = await addStudentToClass(code, name);
  if (!result) {
    return res.status(400).json({ message: "Нэрийг хадгалж чадсангүй." });
  }

  if (result.alreadyFinished) {
    const summary = summarizeStudent(result.student);
    return res.status(409).json({
      ok: false,
      alreadyFinished: true,
      message:
        "Энэ нэрээр шалгалт аль хэдийн өгсөн байна. Дахин өгөх боломжгүй.",
      className: result.room.className,
      code: result.room.code,
      studentName: name,
      scores: summary.scores,
    });
  }

  return res.json({
    ok: true,
    className: result.room.className,
    code: result.room.code,
    studentName: name,
    joinUrl: `${getBaseUrl(req)}/student?code=${result.room.code}&name=${encodeURIComponent(name)}`,
  });
});

app.get("/api/questions/:stage", (req, res) => {
  const stage = Number(req.params.stage) || 1;
  const meta = STAGE_META[stage] || STAGE_META[1];
  const payload = generateStageQuestions(stage, meta.total);

  if (meta.type === "match") {
    return res.json({
      stage,
      title: meta.title,
      subtitle: meta.subtitle,
      type: "match",
      timerSec: 0,
      match: payload,
    });
  }

  res.json({
    stage,
    title: meta.title,
    subtitle: meta.subtitle,
    type: meta.type || "quiz",
    instruction: stage === 3 ? "Хоосон нүдэнд тохирох тоог нөхөж бич." : null,
    timerSec: meta.timerSec || 10,
    questions: payload,
  });
});

app.post("/api/student/submit", async (req, res) => {
  const { code, name, stage, answers } = req.body || {};
  if (!code || !name || !Number(stage) || !Array.isArray(answers)) {
    return res.status(400).json({ message: "Хариултын мэдээлэл дутуу байна." });
  }

  const updated = await recordStageAnswers(code, name, Number(stage), answers);
  if (!updated) {
    return res.status(404).json({ message: "Анги олдсонгүй." });
  }

  if (updated.error) {
    return res
      .status(409)
      .json({ message: updated.error, alreadyFinished: true });
  }

  const room = updated.room;
  const student = findStudentInRoom(room, name);

  res.json({
    ok: true,
    code: room.code,
    message: "Хариулт хадгалагдлаа.",
    finished: student ? isStudentFinished(student) : false,
    scores: student ? summarizeStudent(student).scores : emptyScores(),
  });
});

app.listen(PORT, () => {
  console.log(`Math battle server running on http://localhost:${PORT}`);
});

connectDatabase();
