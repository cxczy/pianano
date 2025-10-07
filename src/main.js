import './style.css'

// Piano config helpers
const WHITE_NOTES = ['C','D','E','F','G','A','B']
const BLACK_POS = { C: 'Cs', D: 'Ds', F: 'Fs', G: 'Gs', A: 'As' } // sharps

const app = document.querySelector('#app')
const whiteContainer = document.getElementById('whiteKeys')
const blackContainer = document.getElementById('blackKeys')
const keyboardEl = document.getElementById('keyboard')
const startOctaveInput = document.getElementById('startOctave')
const whiteCountInput = document.getElementById('whiteCount')

// WebAudio setup
const audioCtx = new (window.AudioContext || window.webkitAudioContext)()

function noteToFreq(note, octave) {
  // A4 = 440Hz. Map to semitone offset
  const noteIndexMap = {
    C: -9, Cs: -8, D: -7, Ds: -6, E: -5, F: -4, Fs: -3, G: -2, Gs: -1,
    A: 0, As: 1, B: 2
  }
  const a4 = 440
  const semitone = noteIndexMap[note] + (octave - 4) * 12
  return a4 * Math.pow(2, semitone / 12)
}

// Sustain voices for interactive playing
const activeVoices = new Map() // Map<HTMLElement, {osc, gain, startedAt}>
// Voices for auto playback (no element key)
const playingVoices = new Set() // Set<{osc, gain, note, octave}>
let pedalDown = false
function startVoice(note, octave) {
  const now = audioCtx.currentTime
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.value = noteToFreq(note, octave)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.5, now + 0.03)
  osc.connect(gain).connect(audioCtx.destination)
  osc.start(now)
  return { osc, gain, startedAt: now }
}
function stopVoice(voice) {
  const now = audioCtx.currentTime
  // smooth release
  try {
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setTargetAtTime(0.0001, now, 0.06)
    voice.osc.stop(now + 0.08)
  } catch (e) {
    // ignore
  }
}

function stopOrHold(voice) {
  if (pedalDown) {
    playingVoices.add(voice)
  } else {
    stopVoice(voice)
  }
}

function releasePedal() {
  const now = audioCtx.currentTime
  // release all sustained notes
  for (const v of playingVoices) {
    try {
      v.gain.gain.cancelScheduledValues(now)
      v.gain.gain.setTargetAtTime(0.0001, now, 0.06)
      v.osc.stop(now + 0.08)
    } catch (e) {}
  }
  playingVoices.clear()
}

function createKey(note, octave, type) {
  const el = document.createElement('button')
  el.className = `key ${type}`
  el.setAttribute('data-note', note)
  el.setAttribute('data-octave', String(octave))
  el.setAttribute('aria-label', `${note}${type === 'black' ? '#' : ''}${octave}`)
  el.addEventListener('pointerdown', onKeyDown)
  el.addEventListener('pointerup', onKeyUp)
  el.addEventListener('pointerleave', onKeyUp)
  return el
}

function renderKeyboard({ startOctave, whiteCount }) {
  whiteContainer.innerHTML = ''
  blackContainer.innerHTML = ''
  // expose white key count to CSS for layout math
  keyboardEl.style.setProperty('--white-count', String(whiteCount))
  // Build white keys sequence across octaves
  let oct = startOctave
  let idx = 0
  let middleCIndex = null
  while (idx < whiteCount) {
    for (let i = 0; i < WHITE_NOTES.length && idx < whiteCount; i++) {
      const n = WHITE_NOTES[i]
      const white = createKey(n, oct, 'white')
      whiteContainer.appendChild(white)
      // track middle C (C4)
      if (n === 'C' && oct === 4 && middleCIndex === null) middleCIndex = idx
      if (BLACK_POS[n]) {
        const black = createKey(BLACK_POS[n], oct, 'black')
        // position between this white key and the next one
        black.style.setProperty('--i', String(idx))
        blackContainer.appendChild(black)
      }
      idx++
    }
    oct++
  }
  // Add central C marker if visible in range
  const marker = document.querySelector('.central-c') || document.createElement('div')
  marker.className = 'central-c'
  if (middleCIndex !== null) {
    const total = whiteCount
    const percent = ((middleCIndex + 0.5) / total) * 100
    marker.style.left = `calc(${percent}% - 0px)`
    marker.style.right = 'auto'
    marker.textContent = '中央 C (C4)'
  } else {
    marker.textContent = ''
  }
  document.getElementById('keyboard').appendChild(marker)
}

// Recording
let recording = false
let sequence = [] // [{t, note, octave}]
let startTime = 0

function onKeyDown(e) {
  const el = e.currentTarget
  const note = el.getAttribute('data-note')
  const octave = parseInt(el.getAttribute('data-octave'), 10)
  el.classList.add('active')
  audioCtx.resume()
  if (!activeVoices.has(el)) {
    const voice = startVoice(note, octave)
    activeVoices.set(el, voice)
  }
  if (recording) {
    const t = performance.now() - startTime
    sequence.push({ t, note, octave })
  }
}
function onKeyUp(e) {
  const el = e.currentTarget
  el.classList.remove('active')
  const voice = activeVoices.get(el)
  if (voice) {
    stopVoice(voice)
    activeVoices.delete(el)
  }
}

function startRecord() {
  sequence = []
  startTime = performance.now()
  recording = true
  recordBtn.setAttribute('aria-pressed', 'true')
  stopBtn.disabled = false
  playBtn.disabled = true
  shareBtn.disabled = true
}
function stopRecord() {
  recording = false
  recordBtn.setAttribute('aria-pressed', 'false')
  stopBtn.disabled = true
  playBtn.disabled = sequence.length === 0
  shareBtn.disabled = sequence.length === 0
}

function playSequence(seq = sequence) {
  if (!seq || seq.length === 0) return
  const base = audioCtx.currentTime
  const firstT = seq[0].t

  // 辅助：找到对应的琴键元素
  const findKeyEl = (note, octave) => {
    return document.querySelector(`.key[data-note="${note}"][data-octave="${octave}"]`)
  }

  for (let i = 0; i < seq.length; i++) {
    const { t, note, octave, d } = seq[i]
    const when = base + (t - firstT) / 1000
    const nextT = i < seq.length - 1 ? seq[i + 1].t : (t + (d ?? 600)) // 若有 d 用 d
    const durationSec = Math.max(0.08, (d ? d / 1000 : (nextT - t) / 1000)) // 优先使用解析出的时长

    // 声音调度按实际时值
    const freq = noteToFreq(note, octave)
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.001, when)
    gain.gain.exponentialRampToValueAtTime(0.4, when + 0.02)
    // 不预设 stop，让踏板能延迟停止
    osc.connect(gain).connect(audioCtx.destination)
    osc.start(when)
    const voice = { osc, gain, note, octave }
    // 计划常规停止或由踏板保持
    const stopAt = when + durationSec
    ;(() => {
      const delayMs = Math.max(0, (stopAt - audioCtx.currentTime) * 1000)
      setTimeout(() => {
        stopOrHold(voice)
      }, delayMs)
    })()

    // 视觉：按下/抬起高亮
    const keyEl = findKeyEl(note, octave)
    if (keyEl) {
      const delayMs = Math.max(0, (when - audioCtx.currentTime) * 1000)
      setTimeout(() => {
        keyEl.classList.add('active')
        // 键视觉不受踏板影响，按乐谱时值恢复
        setTimeout(() => keyEl.classList.remove('active'), durationSec * 1000)
      }, delayMs)
    }
  }
}

function encodeSequence(seq) {
  const data = seq.map(({ t, note, octave }) => [Math.round(t), note, octave])
  const json = JSON.stringify(data)
  return btoa(encodeURIComponent(json))
}
function decodeSequence(s) {
  try {
    const json = decodeURIComponent(atob(s))
    const arr = JSON.parse(json)
    return arr.map(([t, note, octave]) => ({ t, note, octave }))
  } catch (e) {
    return null
  }
}

function updateShareLink() {
  const encoded = encodeSequence(sequence)
  const url = new URL(window.location.href)
  url.searchParams.set('seq', encoded)
  url.searchParams.set('start', String(Number(startOctaveInput.value) || 2))
  url.searchParams.set('count', String(Number(whiteCountInput.value) || 28))
  if (songSelect && songSelect.value) {
    url.searchParams.set('song', songSelect.value)
  }
  history.replaceState(null, '', url.toString())
}

// Controls
const recordBtn = document.getElementById('recordBtn')
const stopBtn = document.getElementById('stopBtn')
const playBtn = document.getElementById('playBtn')
const shareBtn = document.getElementById('shareBtn')
const pedalBtn = document.getElementById('pedalBtn')
const songSelect = document.getElementById('songSelect')
const loadSongBtn = document.getElementById('loadSongBtn')
let songIndex = []
let initialSongId = (new URL(window.location.href)).searchParams.get('song') || null

recordBtn.addEventListener('click', () => {
  audioCtx.resume()
  startRecord()
})
stopBtn.addEventListener('click', () => {
  stopRecord()
  updateShareLink()
})
playBtn.addEventListener('click', () => {
  audioCtx.resume()
  playSequence()
})
shareBtn.addEventListener('click', async () => {
  updateShareLink()
  // 追加曲目参数到分享链接
  const url2 = new URL(window.location.href)
  if (songSelect && songSelect.value) url2.searchParams.set('song', songSelect.value)
  history.replaceState(null, '', url2.toString())
  try {
    await navigator.clipboard.writeText(window.location.href)
    shareBtn.textContent = '已复制链接'
    setTimeout(() => (shareBtn.textContent = '分享'), 1500)
  } catch (e) {
    // ignore
  }
})

// 踏板控制（按钮与空格键）
pedalBtn.addEventListener('pointerdown', () => {
  pedalDown = true
  pedalBtn.setAttribute('aria-pressed', 'true')
})
pedalBtn.addEventListener('pointerup', () => {
  pedalDown = false
  pedalBtn.setAttribute('aria-pressed', 'false')
  releasePedal()
})
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (!pedalDown) {
      pedalDown = true
      pedalBtn.setAttribute('aria-pressed', 'true')
    }
    e.preventDefault()
  }
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    if (pedalDown) {
      pedalDown = false
      pedalBtn.setAttribute('aria-pressed', 'false')
      releasePedal()
    }
    e.preventDefault()
  }
})

// 简谱支持（4/4 拍）：
// 1-7 表示 C 大调度（1=C, 2=D, 3=E, 4=F, 5=G, 6=A, 7=B）
// 八度：'.' 升高一组，',' 降低一组（可叠加）
// 升降：'#/♯' 升半音，'b/♭' 降半音
// 时值：
//   - 无标记 = 1拍（四分音符）
//   - 下划线 '_' = 半拍（八分音符），如 '1_'
//   - 双下划线 '__' = 1/4拍（十六分音符），如 '1__'
//   - 减时线 '-' 在音符后 = 延长，如 '1-' = 2拍，'1--' = 3拍
//   - 连音线 '~' = 连接到下一个音符
const DEGREE_TO_SEMITONE = { 0: -12, 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 } // 0=低八度7
const SEMI_TO_NOTE = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']
function degreesToSequence(str, baseOctave = 4, tempoBpm = 90) {
  const beatMs = (60_000 / tempoBpm) // 一拍的毫秒数
  const tokens = str.trim().split(/\s+/)
  let t = 0
  const seq = []
  // 连音聚合状态
  let tieActive = false
  let tieStartT = 0
  let tieNote = null
  let tieOctave = null
  let tieDur = 0
  
  for (const tok of tokens) {
    // 小节线，推进到下一拍的整数倍
    if (tok === '|' || tok === '/') {
      const beatUnit = beatMs
      t = Math.ceil(t / beatUnit) * beatUnit
      continue
    }
    
    // 延时占位（单独的 '-')
    if (tok === '-') {
      t += beatMs
      continue
    }
    
    // 解析音符：度数+升降+八度+时值+连音
    const m = tok.match(/^([0-7])(#{1}|♯|b|♭)?([.,]*)(_{0,2})(-*)(~?)$/)
    if (!m) {
      t += beatMs // 无法识别的符号，默认推进一拍
      continue
    }
    
    const degree = Number(m[1])
    const accidentalRaw = m[2] || ''
    const octaveMarks = m[3] || ''
    const underlines = m[4] || '' // 时值标记
    const dashes = m[5] || ''     // 延音标记
    const tilde = m[6] === '~'    // 连音标记
    
    // 升降号处理
    const acc = (accidentalRaw === '#' || accidentalRaw === '♯') ? 1
                : (accidentalRaw === 'b' || accidentalRaw === '♭') ? -1
                : 0
    
    // 八度处理
    const up = (octaveMarks.match(/\./g) || []).length
    const down = (octaveMarks.match(/,/g) || []).length
    
    // 音高计算
    const baseSemi = DEGREE_TO_SEMITONE[degree] + acc
    const absoluteSemi = (baseOctave + up - down) * 12 + baseSemi
    const octave = Math.floor(absoluteSemi / 12)
    const note = SEMI_TO_NOTE[((absoluteSemi % 12) + 12) % 12]
    
    // 时值计算
    let duration = beatMs // 默认一拍
    if (underlines === '_') {
      duration = beatMs / 2 // 半拍（八分音符）
    } else if (underlines === '__') {
      duration = beatMs / 4 // 四分之一拍（十六分音符）
    }
    
    // 延音线处理
    const extraBeats = dashes.length
    duration += extraBeats * beatMs
    
    // 休止符（degree=0）：仅推进时间，若有连音在进行则先收尾
    if (degree === 0) {
      if (tieActive && tieNote && tieOctave) {
        seq.push({ t: tieStartT, note: tieNote, octave: tieOctave, d: tieDur })
        tieActive = false; tieNote = null; tieOctave = null; tieDur = 0
      }
      t += duration
      continue
    }

    // 非休止：处理连音聚合
    if (!tieActive) {
      if (tilde) {
        tieActive = true
        tieStartT = t
        tieNote = note
        tieOctave = octave
        tieDur = duration
      } else {
        seq.push({ t, note, octave, d: duration })
      }
    } else {
      if (note === tieNote && octave === tieOctave) {
        tieDur += duration
        if (!tilde) {
          seq.push({ t: tieStartT, note: tieNote, octave: tieOctave, d: tieDur })
          tieActive = false; tieNote = null; tieOctave = null; tieDur = 0
        }
      } else {
        // 音高变化，结束上一条连音
        seq.push({ t: tieStartT, note: tieNote, octave: tieOctave, d: tieDur })
        tieActive = false; tieNote = null; tieOctave = null; tieDur = 0
        // 处理当前音
        if (tilde) {
          tieActive = true
          tieStartT = t
          tieNote = note
          tieOctave = octave
          tieDur = duration
        } else {
          seq.push({ t, note, octave, d: duration })
        }
      }
    }
    t += duration
  }
  // 文件末尾若仍在连音，收尾
  if (tieActive && tieNote && tieOctave) {
    seq.push({ t: tieStartT, note: tieNote, octave: tieOctave, d: tieDur })
  }
  return seq
}

// 动态曲谱索引与加载
async function fetchSongsIndex() {
  try {
    const res = await fetch('/songs/index.json')
    const data = await res.json()
    songIndex = data.songs || []
    // 动态填充下拉
    songSelect.innerHTML = ''
    for (const s of songIndex) {
      const opt = document.createElement('option')
      opt.value = s.id
      opt.textContent = s.title
      songSelect.appendChild(opt)
    }
    if (initialSongId) {
      songSelect.value = initialSongId
      const pre = await loadSongById(initialSongId)
      if (pre) {
        sequence = degreesToSequence(pre.notation, pre.baseOctave, pre.tempo)
        playBtn.disabled = false
        shareBtn.disabled = false
        updateShareLink()
      }
    }
  } catch (e) {
    // ignore
  }
}
async function loadSongById(id) {
  const s = songIndex.find(x => x.id === id)
  if (!s) return null
  try {
    const res = await fetch(`/songs/${s.notationPath}`)
    const notation = await res.text()
    return { ...s, notation }
  } catch (e) {
    return null
  }
}

loadSongBtn.addEventListener('click', async () => {
  const key = songSelect.value
  const song = await loadSongById(key)
  if (!song) return
  sequence = degreesToSequence(song.notation, song.baseOctave, song.tempo)
  playBtn.disabled = false
  shareBtn.disabled = false
  audioCtx.resume()
  playSequence(sequence)
  // 更新分享链接附带曲目
  const url2 = new URL(window.location.href)
  url2.searchParams.set('song', key)
  history.replaceState(null, '', url2.toString())
})

function initFromURL() {
  const url = new URL(window.location.href)
  const seqParam = url.searchParams.get('seq')
  const startOctaveParam = url.searchParams.get('start')
  const whiteCountParam = url.searchParams.get('count')
  const songParam = url.searchParams.get('song')
  if (seqParam) {
    const decoded = decodeSequence(seqParam)
    if (decoded && decoded.length) {
      sequence = decoded
      playBtn.disabled = false
      shareBtn.disabled = false
    }
  }
  if (startOctaveParam) startOctaveInput.value = String(Math.max(1, Math.min(7, Number(startOctaveParam))))
  if (whiteCountParam) whiteCountInput.value = String(Math.max(7, Math.min(28, Number(whiteCountParam))))
  if (songParam) initialSongId = songParam
}

initFromURL()
function refresh() {
  renderKeyboard({
    startOctave: Number(startOctaveInput.value) || 4,
    whiteCount: Number(whiteCountInput.value) || 14,
  })
}
refresh()
// 初始化并拉取曲谱索引
fetchSongsIndex()
startOctaveInput.addEventListener('change', () => {
  refresh()
})
whiteCountInput.addEventListener('change', () => {
  refresh()
})
