import { useCallback, useEffect, useMemo, useState } from 'react'

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
const AUTH_KEY = 'math_battle_teacher_auth'

const getApiUrl = (path) => {
  if (API_BASE) return `${API_BASE}${path}`
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return `http://localhost:3000${path}`
  }
  return path
}

const readAuth = () => {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null')
  } catch {
    return null
  }
}

/* Багшийн API хүсэлтүүдэд token нэмнэ */
const teacherHeaders = () => ({
  'Content-Type': 'application/json',
  'x-teacher-token': readAuth()?.token || '',
})

const stageSteps = [
  ['Шаг 1', 'Зэрэг ↔ Утга', 'Тооцооллын үндэс · буруу = −1'],
  ['Шаг 2', '10-ын зэрэг', 'Арга зүй, жишээ · 10 сек'],
  ['Шаг 3', 'Аравтын бутархай', '□ нөхөх · 15 сек'],
]

function statusBadge(student) {
  if (student.finished || student.status === 'finished') {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">Дууссан</span>
  }
  if (student.status === 'in_progress') {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">Хийж байна · Үе {student.playingStage || '?'}</span>
  }
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">Хүлээж байна</span>
}

function roomLabel(room) {
  if (room.status === 'stopped') return { text: 'Зогссон', cls: 'bg-orange-100 text-orange-700' }
  if (room.gameStarted) return { text: 'Live', cls: 'bg-emerald-100 text-emerald-700' }
  return { text: 'Хүлээж байна', cls: 'bg-slate-100 text-slate-600' }
}

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('bagsh')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(getApiUrl('/api/teacher/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Нэвтэрч чадсангүй')
      onLogin({ token: data.token, username: data.username || username })
    } catch (err) {
      setError(err.message || 'Алдаа гарлаа')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-800 via-violet-700 to-purple-800 p-4 text-white">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/20 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-100">Math Battle</p>
        <h1 className="mt-2 text-2xl font-black">Багш нэвтрэх</h1>
        <p className="mt-1 text-sm text-indigo-100">Ангийн хяналтын самбар руу орохын тулд нэвтэрнэ үү.</p>

        <label className="mt-6 block text-sm font-semibold text-indigo-50">Нэр</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 outline-none placeholder:text-indigo-200"
          placeholder="bagsh"
        />

        <label className="mt-4 block text-sm font-semibold text-indigo-50">Нууц үг</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 outline-none placeholder:text-indigo-200"
          placeholder="Нууц үг"
          required
        />

        {error && <p className="mt-3 rounded-xl bg-rose-500/20 px-3 py-2 text-sm text-rose-100">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-xl bg-white px-4 py-3 font-bold text-violet-800 transition hover:bg-indigo-50 disabled:opacity-60"
        >
          {loading ? 'Шалгаж байна...' : 'Нэвтрэх'}
        </button>
        <p className="mt-4 text-center text-xs text-indigo-200">Анхны нууц үг: math2026</p>
      </form>
    </div>
  )
}

function App() {
  const [auth, setAuth] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null')
    } catch {
      return null
    }
  })
  const [classes, setClasses] = useState([])
  const [className, setClassName] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [selectedCode, setSelectedCode] = useState(null)

  const handleLogin = (next) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(next))
    setAuth(next)
  }

  const handleLogout = async () => {
    try {
      await fetch(getApiUrl('/api/teacher/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-teacher-token': auth?.token || '' },
        body: JSON.stringify({ token: auth?.token }),
      })
    } catch {
      /* ignore */
    }
    localStorage.removeItem(AUTH_KEY)
    setAuth(null)
  }

  const loadClasses = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/teacher/classes'), {
        headers: teacherHeaders(),
      })
      if (!res.ok) throw new Error('Ангиудыг татаж чадсангүй')
      const data = await res.json()
      setClasses(data.classes || [])
      setError('')
    } catch (err) {
      setError(err.message || 'Алдаа гарлаа')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!auth) return undefined
    loadClasses()
    const timer = setInterval(loadClasses, 2000)
    return () => clearInterval(timer)
  }, [auth, loadClasses])

  const totalStudents = useMemo(
    () => classes.reduce((sum, item) => sum + (item.students || []).length, 0),
    [classes]
  )
  const liveCount = useMemo(() => classes.filter((c) => c.gameStarted).length, [classes])
  const selected = classes.find((c) => c.code === selectedCode) || classes[0] || null

  useEffect(() => {
    if (selected && !selectedCode) setSelectedCode(selected.code)
  }, [selected, selectedCode])

  const handleCreateClass = async (event) => {
    event.preventDefault()
    if (!className.trim()) {
      setError('Ангины нэрээ оруулна уу.')
      return
    }
    setCreating(true)
    setError('')
    try {
      const res = await fetch(getApiUrl('/api/teacher/class'), {
        method: 'POST',
        headers: teacherHeaders(),
        body: JSON.stringify({ className }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Анги үүсгэж чадсангүй')
      setClassName('')
      await loadClasses()
      setSelectedCode(data.code)
    } catch (err) {
      setError(err.message || 'Анги үүсгэж чадсангүй')
    } finally {
      setCreating(false)
    }
  }

  const handleStartGame = async (code) => {
    try {
      const res = await fetch(getApiUrl(`/api/teacher/class/${code}/start`), {
        method: 'POST',
        headers: teacherHeaders(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Тоглоом эхлүүлж чадсангүй')
      await loadClasses()
    } catch (err) {
      setError(err.message || 'Тоглоом эхлүүлж чадсангүй')
    }
  }

  const handleStopGame = async (code) => {
    if (!window.confirm('Тоглоомыг зогсоох уу?')) return
    try {
      const res = await fetch(getApiUrl(`/api/teacher/class/${code}/stop`), {
        method: 'POST',
        headers: teacherHeaders(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Зогсоож чадсангүй')
      await loadClasses()
    } catch (err) {
      setError(err.message || 'Зогсоож чадсангүй')
    }
  }

  const handleDeleteClass = async (code, name) => {
    if (!window.confirm(`«${name}» ангийг устгах уу?`)) return
    try {
      const res = await fetch(getApiUrl(`/api/teacher/class/${code}`), {
        method: 'DELETE',
        headers: teacherHeaders(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Устгаж чадсангүй')
      if (selectedCode === code) setSelectedCode(null)
      await loadClasses()
    } catch (err) {
      setError(err.message || 'Устгаж чадсангүй')
    }
  }

  const handleKick = async (code, name) => {
    if (!window.confirm(`«${name}»-ийг гаргах уу?`)) return
    try {
      const res = await fetch(getApiUrl(`/api/teacher/class/${code}/student`), {
        method: 'DELETE',
        headers: teacherHeaders(),
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Гаргаж чадсангүй')
      await loadClasses()
    } catch (err) {
      setError(err.message || 'Гаргаж чадсангүй')
    }
  }

  if (!auth) return <LoginPage onLogin={handleLogin} />

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="bg-gradient-to-r from-indigo-700 via-violet-700 to-purple-700 text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-100">Math Battle</p>
            <h1 className="mt-2 text-2xl font-black sm:text-3xl">Ангиудын хяналтын самбар</h1>
            <p className="mt-1 text-sm text-indigo-100">Сайн байна уу, {auth.username}!</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form onSubmit={handleCreateClass} className="flex flex-wrap items-center gap-2">
              <input
                value={className}
                onChange={(event) => setClassName(event.target.value)}
                placeholder="Ангины нэр"
                className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-indigo-100 outline-none"
              />
              <button
                type="submit"
                disabled={creating}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/25 transition hover:bg-white/20 disabled:opacity-60"
              >
                {creating ? 'Үүсгэж байна...' : '+ Анги үүсгэх'}
              </button>
            </form>
            <button type="button" onClick={handleLogout} className="rounded-xl bg-rose-500/80 px-4 py-2 text-sm font-semibold hover:bg-rose-500">
              Гарах
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 h-2 w-12 rounded-full bg-indigo-500" />
            <div className="text-sm text-slate-500">Нийт анги</div>
            <div className="mt-2 text-3xl font-black text-slate-900">{classes.length}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 h-2 w-12 rounded-full bg-emerald-500" />
            <div className="text-sm text-slate-500">Нийт оюутан</div>
            <div className="mt-2 text-3xl font-black text-slate-900">{totalStudents}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 h-2 w-12 rounded-full bg-rose-500" />
            <div className="text-sm text-slate-500">Идэвхтэй</div>
            <div className="mt-2 text-3xl font-black text-slate-900">{liveCount ? 'Live' : '0'}</div>
            <div className="text-xs text-slate-400">{liveCount} анги тоглож байна</div>
          </div>
        </section>

        {error && (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        )}

        <section className="mt-8 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="mb-5">
            <h2 className="text-xl font-bold text-slate-900">Ангиуд</h2>
            <p className="text-sm text-slate-500">QR код, join холбоос, сурагчийн бүртгэл · 2 сек тутамд шинэчлэгдэнэ</p>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500">Ангиудыг ачааллаж байна...</div>
          ) : classes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
              Одоогоор анги байхгүй байна. Анги үүсгээд QR холбоосыг ашиглаарай.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {classes.map((item) => {
                const badge = roomLabel(item)
                return (
                  <div
                    key={item.code}
                    className={`rounded-2xl border p-5 transition ${selectedCode === item.code ? 'border-indigo-400 bg-indigo-50/40 ring-2 ring-indigo-200' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <button type="button" className="w-full text-left" onClick={() => setSelectedCode(item.code)}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm text-slate-500">{item.className}</div>
                          <div className="mt-1 text-2xl font-black text-slate-900">{item.code}</div>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badge.cls}`}>{badge.text}</span>
                      </div>
                    </button>

                    {item.qrDataUrl && (
                      <div className="mt-4 rounded-xl bg-white p-2 shadow-sm">
                        <img src={item.qrDataUrl} alt="QR code" className="mx-auto h-28 w-28 object-contain" />
                      </div>
                    )}

                    <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4 text-sm text-slate-600">
                      <span>Суралцагчид</span>
                      <span className="font-bold text-slate-900">{(item.students || []).length}</span>
                    </div>

                    <div className="mt-4 rounded-xl bg-white px-3 py-2 text-xs text-slate-600 break-all ring-1 ring-slate-200">
                      {item.joinUrl || 'Join url байхгүй'}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <a
                        href={item.joinUrl || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 rounded-xl bg-slate-900 px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-slate-700"
                      >
                        Нээх
                      </a>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(item.joinUrl || '')}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Copy
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleStartGame(item.code)}
                        disabled={item.gameStarted}
                        className={`rounded-xl px-3 py-2 text-sm font-bold transition ${
                          item.gameStarted ? 'cursor-not-allowed bg-emerald-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-500'
                        }`}
                      >
                        {item.gameStarted ? 'Эхэлсэн' : 'Эхлүүлэх'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStopGame(item.code)}
                        disabled={!item.gameStarted}
                        className={`rounded-xl px-3 py-2 text-sm font-bold transition ${
                          item.gameStarted ? 'bg-orange-500 text-white hover:bg-orange-400' : 'cursor-not-allowed bg-slate-200 text-slate-400'
                        }`}
                      >
                        Зогсоох
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteClass(item.code, item.className)}
                      className="mt-2 w-full rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-500"
                    >
                      Анги устгах
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {selected && (
          <section className="mt-8 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selected.className} · шууд оноо</h2>
                <p className="text-sm text-slate-500">
                  Код {selected.code} · Дууссан {selected.finishedCount || 0}/{selected.students?.length || 0}
                  {selected.gameStarted ? ' · Тоглоом явж байна' : ''}
                </p>
              </div>
            </div>

            {(selected.students || []).length === 0 ? (
              <p className="text-sm text-slate-500">Сурагч нэгдээгүй байна.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 pr-2">Сурагч</th>
                      <th className="pb-2 px-2">Төлөв</th>
                      <th className="pb-2 px-2 text-center">Үе1</th>
                      <th className="pb-2 px-2 text-center">Үе2</th>
                      <th className="pb-2 px-2 text-center">Үе3</th>
                      <th className="pb-2 px-2 text-center">Нийт</th>
                      <th className="pb-2 pl-2 text-right">Үйлдэл</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.students || []).map((s) => (
                      <tr key={s.name} className="border-b border-slate-100">
                        <td className="py-3 pr-2 font-bold text-slate-900">{s.name}</td>
                        <td className="py-3 px-2">{statusBadge(s)}</td>
                        <td className="py-3 px-2 text-center font-semibold">{s.scores?.stage1 ?? 0}</td>
                        <td className="py-3 px-2 text-center font-semibold">{s.scores?.stage2 ?? 0}</td>
                        <td className="py-3 px-2 text-center font-semibold">{s.scores?.stage3 ?? 0}</td>
                        <td className="py-3 px-2 text-center text-lg font-black text-indigo-700">{s.scores?.total ?? 0}</td>
                        <td className="py-3 pl-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleKick(selected.code, s.name)}
                            className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                          >
                            Гаргах
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-xl font-bold text-slate-900">Тоглоомын үе шатууд</h3>
            <div className="mt-5 space-y-4">
              {stageSteps.map(([step, title, description], index) => (
                <div key={step} className="flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-sm font-black text-white">
                    {index + 1}
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">{step}</div>
                    <div className="text-sm font-semibold text-slate-700">{title}</div>
                    <div className="text-xs text-slate-500">{description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-700 p-6 text-white shadow-lg">
            <p className="text-xs uppercase tracking-[0.24em] text-indigo-100">QRCode</p>
            <div className="mt-6 rounded-2xl bg-white p-5 text-center text-slate-900 shadow-inner">
              {selected?.qrDataUrl ? (
                <img src={selected.qrDataUrl} alt="QR" className="mx-auto h-32 w-32 object-contain" />
              ) : (
                <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-xl bg-slate-100 text-4xl shadow-sm">QR</div>
              )}
            </div>
            <div className="mt-5 text-sm text-indigo-100">Join холбоос</div>
            <div className="mt-2 break-all rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/20">
              {selected?.joinUrl || 'http://localhost:3000'}
            </div>
            {selected && (
              <p className="mt-3 text-center font-mono text-lg font-black tracking-widest">{selected.code}</p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
