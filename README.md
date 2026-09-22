# Math Battle (MERN)

10-ын зэргийн 3 үе шаттай ангийн тоглоом: багш хяналтын самбар + сурагчийн нэвтрэх/тоглоом.

## Бүтэц (MERN)

```
math_game/
├── frontend/              # React + Vite + Tailwind (багшийн login + хяналтын самбар)
│   ├── src/App.jsx        # Login ба Dashboard
│   ├── vercel.json        # Vercel build тохиргоо
│   └── .env.example       # VITE_API_BASE
└── math_battle_local/     # Node + Express + MongoDB (API + сурагчийн хуудас)
    ├── server.js          # REST API, CORS, token хамгаалалт
    ├── render.yaml        # Render deploy тохиргоо
    ├── public/            # join.html, student.html (сурагчийн тал)
    └── .env.example       # MONGO_URI, TEACHER_PASSWORD, CORS_ORIGIN, FRONTEND_URL
```

- **MongoDB** — Atlas (`math_classes` collection)
- **Express** — REST API (`math_battle_local/server.js`)
- **React** — багшийн интерфейс (`frontend/`)
- **Node** — серверийн runtime

## Локал ажиллуулах

```powershell
# 1) Backend (порт 3000)
cd math_battle_local
npm install
copy .env.example .env   # MONGO_URI, TEACHER_PASSWORD утгуудаа оруулна уу
npm run dev

# 2) Frontend (порт 4173, /api → localhost:3000 proxy)
cd frontend
npm install
npm run dev
```

- Багш: http://localhost:4173 → нэвтрэх нэр `bagsh`, нууц үг `.env` дахь `TEACHER_PASSWORD`
- Сурагч: QR холбоос `http://localhost:3000/?c=АНГИИН_КОД`

## Онлайн байршуулах (Vercel + Render)

### Алхам 1 — Backend → Render

1. GitHub репод `math_battle_local/` хавтсыг push хийнэ үү.
2. [Render](https://dashboard.render.com) → **New +** → **Web Service** → репо сонгонэ.
3. Тохиргоо (render.yaml-аар автоматаар уншигдана):
   - **Root Directory:** `math_battle_local`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Health Check:** `/api/health`
4. **Environment** хэсэгт утгуудыг оруулна уу:
   | Түлхүүр | Утга |
   |---|---|
   | `MONGO_URI` | MongoDB Atlas холбоос |
   | `TEACHER_PASSWORD` | Багшийн нууц үг |
   | `CORS_ORIGIN` | `https://<таны-vercel-домен>` |
   | `FRONTEND_URL` | `https://<таны-vercel-домен>` |
   | `NODE_ENV` | `production` |
5. Deploy → URL жишээ: `https://math-battle-api.onrender.com`
   - Шалгах: `https://math-battle-api.onrender.com/api/health` → `{"ok":true,...}`

> Render free plan нойрдож магадгүй — анхны хүсэлт 30–60 сек аажим байна.

### Алхам 2 — Frontend → Vercel

1. [Vercel](https://vercel.com) → **Add New → Project** → репо сонгонэ.
2. Тохиргоо:
   - **Root Directory:** `frontend`
   - Framework: Vite, Build: `npm run build`, Output: `dist` (vercel.json-аар уншигдана)
3. **Environment Variables:**
   | Түлхүүр | Утга |
   |---|---|
   | `VITE_API_BASE` | `https://math-battle-api.onrender.com` |
4. Deploy → URL жишээ: `https://math-battle.vercel.app`

### Алхам 3 — Холбох

1. Render service-ийн Environment дээр `CORS_ORIGIN` болон `FRONTEND_URL`-д
   Vercel URL-аа оруулаад **Manual Deploy** хийнэ үү.
2. Dashboard дээр анги үүсгэхэд QR холбоос Render домэйнаас үүснэ
   (`https://math-battle-api.onrender.com/?c=КОД`) — сурагч QR-аар шууд нэгдэнэ.
3. QR шинэчлэх: анги устгаад дахин үүсгэ (joinUrl шинэ домэйноор бичигдэнэ).

## API хураангуй

| Мөр | Тэмдэглэл |
|---|---|
| `POST /api/teacher/login` | нууц үг → token |
| `GET /api/teacher/classes` | **token шаардлагатай** |
| `POST /api/teacher/class` | анги үүсгэх · **token** |
| `POST /api/teacher/class/:code/start` · `/stop` | тоглоом эхлэх/зогсоох · **token** |
| `DELETE /api/teacher/class/:code` · `/:code/student` | устгах/гаргах · **token** |
| `POST /api/student/join` · `/submit` · `/progress` | сурагчийн үйлдэл (нээлттэй) |
| `GET /api/questions/:stage` | 3 үе шатын асуулт |
| `GET /api/health` | серверийн байдал |

Токен бүх хүсэлт: header `x-teacher-token: <token>`.

## Аюулгүй байдлын зөвлөмж

- `TEACHER_PASSWORD`-оо өөрчилнө үү (`math2026` анхдагч).
- `.env` файлыг реподоо commit хийхгүй байх (`.gitignore`-д байгаа эсэхийг шалгаарай).
- Token нь серверийн санах ойд байдаг тул сервер дахин аадагдахад хүчингүй болно —
  энэ нь зорилтот аюулгүй байдлын хэлбэр (redeploy-ээр шинэчлэгдэнэ).