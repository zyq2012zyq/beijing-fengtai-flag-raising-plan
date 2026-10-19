"use strict";

// The MP3 is 49.52 seconds, but its audible ending fades below -25 dB near 47.8 seconds.
// Stop the ceremony at the audible ending so its quiet tail does not add extra turns.
const MUSIC_END_SECONDS = 47.8;
const TOTAL_TURNS = 60;
// The score gives about 7.1875 seconds; the displayed 7.19 seconds is the agreed timing mark.
const PRELUDE_SECONDS = 7.19;
const RAISE_DURATION = MUSIC_END_SECONDS - PRELUDE_SECONDS;
const SECONDS_PER_TURN = RAISE_DURATION / TOTAL_TURNS;
const NATIONAL_RISE_PIXELS = 327;

const $ = (id) => document.getElementById(id);
const audio = $("anthem");
const flag = $("nationalFlag");
const crank = $("crank");
const wheel = $("crankWheel");
const progressSeek = $("progressSeek");
const beats = [];
const duration = MUSIC_END_SECONDS;
let mode = "auto";
let manualTurns = 0;
let everStarted = false;
let ceremonyFinished = false;
let lastCueIndex = -1;
let audioContext = null;
let pointerAngle = null;
let beatFlashTimer = null;
let lastPhase = null;
let activeCeremony = "national";
let nationalStatus = { message: "准备就绪", color: "#69a38c" };
let schoolStatus = { message: "校旗准备就绪", color: "#69a38c" };

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function raisingDuration() { return RAISE_DURATION; }
function secondsPerTurn() { return SECONDS_PER_TURN; }
function isFinished() { return ceremonyFinished || audio.ended; }
function targetTurns() { return isFinished() ? TOTAL_TURNS : clamp((audio.currentTime - PRELUDE_SECONDS) / secondsPerTurn(), 0, TOTAL_TURNS); }
function isPreludeWaiting() { return everStarted && !isFinished() && audio.currentTime < PRELUDE_SECONDS; }
function formatTime(seconds) {
  const centiseconds = Math.round(seconds * 100);
  const min = Math.floor(centiseconds / 6000);
  const sec = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
function starPath(cx, cy, outerRadius, rotation) {
  const points = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = rotation + i * Math.PI / 5;
    const radius = i % 2 ? outerRadius * 0.382 : outerRadius;
    points.push(`${i ? "L" : "M"}${(cx + Math.cos(angle) * radius).toFixed(3)},${(cy + Math.sin(angle) * radius).toFixed(3)}`);
  }
  return `${points.join(" ")}Z`;
}
function drawStars() {
  const positions = [[5, 5, 3, -Math.PI / 2], ...[[10, 2], [12, 4], [12, 7], [10, 9]].map(([x, y]) => [x, y, 1, Math.atan2(5 - y, 5 - x)])];
  for (const [x, y, radius, rotation] of positions) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", starPath(x, y, radius, rotation));
    $("flagStars").appendChild(path);
  }
}
function drawBeatGrid() {
  for (let i = 0; i < TOTAL_TURNS; i += 1) {
    const beat = document.createElement("span");
    beat.title = `第 ${i + 1} 圈 · 国歌 ${formatTime(PRELUDE_SECONDS + i * secondsPerTurn())}`;
    $("beatGrid").appendChild(beat);
    beats.push(beat);
  }
}
function setStatus(message, color = "#69a38c") {
  nationalStatus = { message, color };
  if (activeCeremony !== "national") return;
  showStatus(nationalStatus);
}
function showStatus(status) {
  const { message, color } = status;
  $("statusText").textContent = message;
  $("statusLight").style.background = color;
}
function setSchoolStatus(message, color = "#69a38c") {
  schoolStatus = { message, color };
  if (activeCeremony === "school") showStatus(schoolStatus);
}
function playCue(lampId = "beatLamp", toggleId = "cueToggle", soft = false) {
  $(lampId).classList.add("active");
  $(lampId).classList.toggle("soft", soft);
  clearTimeout(beatFlashTimer);
  beatFlashTimer = setTimeout(() => $(lampId).classList.remove("active", "soft"), 120);
  if (!$(toggleId).checked || !audioContext) return;
  const start = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(soft ? 850 : 1150, start);
  oscillator.frequency.exponentialRampToValueAtTime(soft ? 620 : 730, start + 0.045);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(soft ? 0.055 : 0.13, start + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.075);
  oscillator.connect(envelope).connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.08);
}
function positionNationalFlag(turns) {
  const visibleTurns = activeCeremony === "school" ? TOTAL_TURNS : turns;
  flag.setAttribute("transform", `translate(0 ${(NATIONAL_RISE_PIXELS * (1 - visibleTurns / TOTAL_TURNS)).toFixed(3)})`);
}
function render() {
  if (!ceremonyFinished && !audio.paused && audio.currentTime >= duration) finishCeremony();
  const finished = isFinished();
  const time = finished ? duration : clamp(audio.currentTime || 0, 0, duration);
  const songProgress = clamp(time / duration, 0, 1);
  const riseTime = clamp(time - PRELUDE_SECONDS, 0, raisingDuration());
  const riseProgress = riseTime / raisingDuration();
  const turns = finished ? TOTAL_TURNS : mode === "auto" ? riseProgress * TOTAL_TURNS : manualTurns;
  positionNationalFlag(turns);
  wheel.style.transform = `rotate(${(turns * 2 * Math.PI).toFixed(4)}rad)`;
  $("turnCount").textContent = turns.toFixed(1).padStart(4, "0");
  $("elapsedTime").textContent = formatTime(time);
  $("durationTime").textContent = formatTime(duration);
  $("raisingTime").textContent = formatTime(riseTime);
  $("raisingDuration").textContent = formatTime(raisingDuration());
  progressSeek.value = String(Math.round(songProgress * 1000));
  progressSeek.style.setProperty("--progress", `${(songProgress * 100).toFixed(3)}%`);
  progressSeek.setAttribute("aria-valuetext", `国歌 ${formatTime(time)}，有效升旗 ${formatTime(riseTime)}`);
  $("phaseHint").textContent = !everStarted ? mode === "manual" && manualTurns > 0
    ? "手摇预演中 · 点击开始后圈数清零，前奏结束再升旗"
    : `前奏约 ${formatTime(PRELUDE_SECONDS)}，国旗暂不升起`
    : time < PRELUDE_SECONDS ? `前奏倒计时 ${formatTime(PRELUDE_SECONDS - time)} · 摇柄待命，不计圈数`
    : finished ? "可听尾音结束 · 国旗已到杆顶"
      : `前奏已结束 · 从国歌 ${formatTime(PRELUDE_SECONDS)} 开始计升旗时间`;
  crank.setAttribute("aria-valuenow", turns.toFixed(1));
  crank.setAttribute("aria-valuetext", `${turns.toFixed(1)}圈`);
  const crankUnavailable = mode === "manual" && (isPreludeWaiting() || finished);
  crank.setAttribute("aria-disabled", crankUnavailable ? "true" : "false");
  crank.classList.toggle("waiting", crankUnavailable);
  if (mode === "manual") {
    $("crankHint").textContent = finished ? "已到终点 · 可拖动进度条重看" : isPreludeWaiting() ? "前奏中 · 等待开始" : "按住圆盘沿圆周拖动";
    const target = riseProgress * TOTAL_TURNS;
    const gap = target - manualTurns;
    $("modeHelp").textContent = finished ? "可听尾音结束 · 国旗已到顶，结束前圈数见状态栏"
      : everStarted && time >= PRELUDE_SECONDS
        ? `目标 ${target.toFixed(1)} 圈 · 手摇 ${manualTurns.toFixed(1)} 圈 · ${Math.abs(gap) < 0.05 ? "同步" : `${gap > 0 ? "落后" : "领先"} ${Math.abs(gap).toFixed(1)} 圈`}`
        : "可先预演；正式播放时等前奏结束，再跟随提示音手摇。";
  }

  const currentCue = everStarted && time >= PRELUDE_SECONDS ? clamp(Math.floor(riseTime / secondsPerTurn()), 0, TOTAL_TURNS - 1) : -1;
  for (let i = 0; i < beats.length; i += 1) {
    beats[i].classList.toggle("done", i < currentCue || finished);
    beats[i].classList.toggle("current", i === currentCue && !finished);
  }
  $("cueNumber").textContent = currentCue < 0 ? "— / 60" : `${String(currentCue + 1).padStart(2, "0")} / 60`;

  if (!audio.paused && !finished && currentCue > lastCueIndex) {
    // The first cue of each revolution is tied to the playback clock.
    playCue();
    lastCueIndex = currentCue;
  }
  if (!audio.paused && !finished) {
    const phase = time < PRELUDE_SECONDS ? "prelude" : "raising";
    if (phase !== lastPhase) {
      setStatus(phase === "prelude" ? "前奏中 · 等待升旗" : mode === "manual" ? "手摇练习中" : "同步升旗中", "#d6a04f");
      lastPhase = phase;
    }
  }
  renderSchool();
  requestAnimationFrame(render);
}
function updateButtons() {
  $("playLabel").textContent = audio.paused ? (isFinished() ? "再次演示" : everStarted && audio.currentTime > 0 ? "继续升旗" : "开始升旗") : "暂停";
  $("playSymbol").textContent = audio.paused ? "▶" : "Ⅱ";
}
async function togglePlayback() {
  if (!audio.paused) { audio.pause(); return; }
  if (isFinished() || audio.currentTime >= duration - 0.03) reset();
  // A new ceremony starts from the bottom, even after a silent manual rehearsal.
  if (!everStarted && audio.currentTime < 0.05) manualTurns = 0;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context && !audioContext) audioContext = new Context();
    if (audioContext?.state === "suspended") await audioContext.resume();
    await audio.play();
    everStarted = true;
    lastPhase = null;
    updateButtons();
  } catch (error) {
    console.error("国歌播放失败", error);
    setStatus("音频无法播放，请检查本地文件", "#bc685b");
  }
}
function reset() {
  ceremonyFinished = false;
  audio.pause();
  audio.currentTime = 0;
  manualTurns = 0;
  everStarted = false;
  lastCueIndex = -1;
  lastPhase = null;
  $("beatLamp").classList.remove("active");
  setStatus("准备就绪");
  updateButtons();
}
function setMode(next) {
  if (next === mode) return;
  if (next === "manual") manualTurns = targetTurns();
  mode = next;
  $("autoMode").classList.toggle("active", mode === "auto");
  $("manualMode").classList.toggle("active", mode === "manual");
  $("autoMode").setAttribute("aria-pressed", mode === "auto");
  $("manualMode").setAttribute("aria-pressed", mode === "manual");
  crank.classList.toggle("manual", mode === "manual");
  $("crankHint").textContent = mode === "manual" ? "按住圆盘沿圆周拖动" : "按播放开始演示";
  $("modeHelp").textContent = mode === "manual" ? "可先预演；正式播放时等前奏结束，再跟随提示音手摇。" : "摇柄会按国歌进度自动转动，展示标准速度。";
  lastPhase = null;
}
function angleFromPointer(event) {
  const rect = crank.getBoundingClientRect();
  return Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2);
}
function turnCrank(delta) {
  if (isFinished()) return;
  if (isPreludeWaiting()) {
    setStatus("前奏中 · 等待升旗", "#d6a04f");
    return;
  }
  manualTurns = clamp(manualTurns + delta, 0, TOTAL_TURNS);
  if (audio.paused) {
    setStatus(everStarted ? "已暂停 · 可继续手摇" : "手摇预演中");
  }
}
function moveCrank(event) {
  if (pointerAngle === null || mode !== "manual") return;
  const angle = angleFromPointer(event);
  let delta = angle - pointerAngle;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  turnCrank(delta / (2 * Math.PI));
  pointerAngle = angle;
}

function refreshMediaMetadata() {
  progressSeek.disabled = false;
  beats.forEach((beat, index) => { beat.title = `第 ${index + 1} 圈 · 国歌 ${formatTime(PRELUDE_SECONDS + index * secondsPerTurn())}`; });
}
audio.addEventListener("loadedmetadata", refreshMediaMetadata);
if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) refreshMediaMetadata();
progressSeek.addEventListener("input", () => {
  const time = Number(progressSeek.value) / Number(progressSeek.max) * duration;
  ceremonyFinished = false;
  audio.currentTime = time;
  if (time > 0) everStarted = true;
  if (mode === "manual") manualTurns = targetTurns();
  lastCueIndex = time < PRELUDE_SECONDS ? -1 : clamp(Math.floor((time - PRELUDE_SECONDS) / secondsPerTurn()), 0, TOTAL_TURNS - 1);
  lastPhase = null;
  if (time >= duration - 0.001) { finishCeremony(); return; }
  updateButtons();
  if (audio.paused) setStatus(time < PRELUDE_SECONDS ? "已定位到前奏" : "已定位到升旗段", "#8ea79a");
});
audio.addEventListener("play", updateButtons);
audio.addEventListener("pause", () => {
  updateButtons();
  lastPhase = null;
  if (!isFinished() && everStarted && audio.currentTime > 0) setStatus("已暂停", "#8ea79a");
});
function finishCeremony() {
  if (ceremonyFinished) return;
  ceremonyFinished = true;
  everStarted = true;
  audio.pause();
  audio.currentTime = duration;
  lastCueIndex = TOTAL_TURNS - 1;
  if (mode === "auto") setStatus("国旗已到杆顶", "#398d71");
  else {
    const finalManualProgress = manualTurns;
    manualTurns = TOTAL_TURNS;
    setStatus(finalManualProgress >= TOTAL_TURNS - 0.05 ? "练习达标：完成60圈" : `国旗到顶 · 结束前${finalManualProgress.toFixed(1)}圈`, finalManualProgress >= TOTAL_TURNS - 0.05 ? "#398d71" : "#bd8852");
  }
  updateButtons();
}
audio.addEventListener("timeupdate", () => { if (!ceremonyFinished && !audio.paused && audio.currentTime >= duration) finishCeremony(); });
audio.addEventListener("ended", finishCeremony);
audio.addEventListener("error", () => setStatus("国歌文件加载失败", "#bc685b"));
$("playButton").addEventListener("click", togglePlayback);
$("resetButton").addEventListener("click", reset);
$("autoMode").addEventListener("click", () => setMode("auto"));
$("manualMode").addEventListener("click", () => setMode("manual"));
crank.addEventListener("pointerdown", (event) => {
  if (mode !== "manual" || isFinished()) return;
  if (isPreludeWaiting()) {
    setStatus("前奏中 · 等待升旗", "#d6a04f");
    return;
  }
  pointerAngle = angleFromPointer(event);
  crank.setPointerCapture(event.pointerId);
  crank.classList.add("dragging");
  event.preventDefault();
});
crank.addEventListener("pointermove", moveCrank);
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  crank.addEventListener(name, () => { pointerAngle = null; crank.classList.remove("dragging"); });
}
crank.addEventListener("keydown", (event) => {
  if (mode !== "manual" || !["ArrowRight", "ArrowLeft"].includes(event.key)) return;
  turnCrank((event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 1 : 0.1));
  event.preventDefault();
});

// The school song has a 24-second prelude and a long quiet tail after about 86.8 seconds.
const SCHOOL_PRELUDE_SECONDS = 24;
const SCHOOL_END_SECONDS = 86.8;
const SCHOOL_TURNS = 52;
const SCHOOL_RAISE_DURATION = SCHOOL_END_SECONDS - SCHOOL_PRELUDE_SECONDS;
const SCHOOL_SECONDS_PER_TURN = SCHOOL_RAISE_DURATION / SCHOOL_TURNS;
const SCHOOL_BEATS_PER_TURN = 2;
const SCHOOL_BEAT_COUNT = SCHOOL_TURNS * SCHOOL_BEATS_PER_TURN;
const SCHOOL_SECONDS_PER_BEAT = SCHOOL_SECONDS_PER_TURN / SCHOOL_BEATS_PER_TURN;
const SCHOOL_START_OFFSET = 122;
const SCHOOL_RISE_PIXELS = 291;
const schoolAudio = $("schoolSong");
const schoolCrank = $("schoolCrank");
const schoolWheel = $("schoolCrankWheel");
const schoolSeek = $("schoolProgressSeek");
const schoolFlags = [$("leftSchoolFlag"), $("rightSchoolFlag")];
const schoolBeats = [];
let schoolMode = "auto";
let schoolManualTurns = 0;
let schoolEverStarted = false;
let schoolFinished = false;
let schoolLastCueIndex = -1;
let schoolLastPhase = null;
let schoolPointerAngle = null;

function schoolIsFinished() { return schoolFinished || schoolAudio.ended; }
function schoolTargetTurns() {
  return schoolIsFinished() ? SCHOOL_TURNS : clamp((schoolAudio.currentTime - SCHOOL_PRELUDE_SECONDS) / SCHOOL_SECONDS_PER_TURN, 0, SCHOOL_TURNS);
}
function schoolPreludeWaiting() { return schoolEverStarted && !schoolIsFinished() && schoolAudio.currentTime < SCHOOL_PRELUDE_SECONDS; }
function drawSchoolBeatGrid() {
  for (let i = 0; i < SCHOOL_BEAT_COUNT; i += 1) {
    const beat = document.createElement("span");
    const turn = Math.floor(i / SCHOOL_BEATS_PER_TURN) + 1;
    const soft = i % SCHOOL_BEATS_PER_TURN === 1;
    beat.classList.toggle("subbeat", soft);
    beat.title = `第 ${turn} 圈${soft ? "中间小拍" : "起点主拍"} · 校歌 ${formatTime(SCHOOL_PRELUDE_SECONDS + i * SCHOOL_SECONDS_PER_BEAT)}`;
    $("schoolBeatGrid").appendChild(beat);
    schoolBeats.push(beat);
  }
}
function renderSchool() {
  if (!schoolFinished && !schoolAudio.paused && schoolAudio.currentTime >= SCHOOL_END_SECONDS) finishSchoolCeremony();
  const finished = schoolIsFinished();
  const time = finished ? SCHOOL_END_SECONDS : clamp(schoolAudio.currentTime || 0, 0, SCHOOL_END_SECONDS);
  const raiseTime = clamp(time - SCHOOL_PRELUDE_SECONDS, 0, SCHOOL_RAISE_DURATION);
  const target = raiseTime / SCHOOL_SECONDS_PER_TURN;
  const turns = finished ? SCHOOL_TURNS : schoolMode === "auto" ? target : schoolManualTurns;
  const visibleTurns = activeCeremony === "school" ? turns : 0;
  for (const schoolFlag of schoolFlags) {
    schoolFlag.setAttribute("transform", `translate(0 ${(SCHOOL_START_OFFSET - SCHOOL_RISE_PIXELS * visibleTurns / SCHOOL_TURNS).toFixed(3)})`);
  }
  schoolWheel.style.transform = `rotate(${(turns * 2 * Math.PI).toFixed(4)}rad)`;
  $("schoolTurnCount").textContent = turns.toFixed(1).padStart(4, "0");
  $("schoolElapsedTime").textContent = formatTime(time);
  $("schoolDurationTime").textContent = formatTime(SCHOOL_END_SECONDS);
  $("schoolRaisingTime").textContent = formatTime(raiseTime);
  $("schoolRaisingDuration").textContent = formatTime(SCHOOL_RAISE_DURATION);
  const progress = time / SCHOOL_END_SECONDS;
  schoolSeek.value = String(Math.round(progress * 1000));
  schoolSeek.style.setProperty("--progress", `${(progress * 100).toFixed(3)}%`);
  schoolSeek.setAttribute("aria-valuetext", `校歌 ${formatTime(time)}，有效升旗 ${formatTime(raiseTime)}`);
  $("schoolPhaseHint").textContent = !schoolEverStarted ? schoolMode === "manual" && schoolManualTurns > 0
    ? "手摇预演中 · 正式开始后圈数清零，前奏结束再升校旗"
    : `前奏 ${formatTime(SCHOOL_PRELUDE_SECONDS)}，两面校旗暂不升起`
    : time < SCHOOL_PRELUDE_SECONDS ? `前奏倒计时 ${formatTime(SCHOOL_PRELUDE_SECONDS - time)} · 摇柄待命，不计圈数`
      : finished ? "校歌可听尾音结束 · 两面校旗已到杆顶"
        : `前奏已结束 · 从校歌 ${formatTime(SCHOOL_PRELUDE_SECONDS)} 开始升旗`;
  schoolCrank.setAttribute("aria-valuenow", turns.toFixed(1));
  schoolCrank.setAttribute("aria-valuetext", `${turns.toFixed(1)}圈`);
  const crankUnavailable = schoolMode === "manual" && (schoolPreludeWaiting() || finished);
  schoolCrank.setAttribute("aria-disabled", crankUnavailable ? "true" : "false");
  schoolCrank.classList.toggle("waiting", crankUnavailable);
  if (schoolMode === "manual") {
    $("schoolCrankHint").textContent = finished ? "已到终点 · 可拖动进度条重看" : schoolPreludeWaiting() ? "前奏中 · 等待开始" : "按住圆盘沿圆周拖动";
    const gap = target - schoolManualTurns;
    $("schoolModeHelp").textContent = finished ? "校歌尾音结束 · 结束前圈数见状态栏"
      : schoolEverStarted && time >= SCHOOL_PRELUDE_SECONDS
        ? `目标 ${target.toFixed(1)} 圈 · 手摇 ${schoolManualTurns.toFixed(1)} 圈 · ${Math.abs(gap) < 0.05 ? "同步" : `${gap > 0 ? "落后" : "领先"} ${Math.abs(gap).toFixed(1)} 圈`}`
        : "可先预演；正式播放时等 24 秒前奏结束再手摇。";
  }
  const cue = schoolEverStarted && time >= SCHOOL_PRELUDE_SECONDS ? clamp(Math.floor(raiseTime / SCHOOL_SECONDS_PER_BEAT), 0, SCHOOL_BEAT_COUNT - 1) : -1;
  for (let i = 0; i < schoolBeats.length; i += 1) {
    schoolBeats[i].classList.toggle("done", i < cue || finished);
    schoolBeats[i].classList.toggle("current", i === cue && !finished);
  }
  $("schoolCueNumber").textContent = cue < 0 ? `— / ${SCHOOL_TURNS}` : `${String(Math.floor(cue / SCHOOL_BEATS_PER_TURN) + 1).padStart(2, "0")} / ${SCHOOL_TURNS}`;
  $("schoolBeatNumber").textContent = cue < 0 ? `— / ${SCHOOL_BEAT_COUNT}` : `${String(cue + 1).padStart(3, "0")} / ${SCHOOL_BEAT_COUNT}`;
  if (!schoolAudio.paused && !finished && cue > schoolLastCueIndex) {
    playCue("schoolBeatLamp", "schoolCueToggle", cue % SCHOOL_BEATS_PER_TURN === 1);
    schoolLastCueIndex = cue;
  }
  if (!schoolAudio.paused && !finished) {
    const phase = time < SCHOOL_PRELUDE_SECONDS ? "prelude" : "raising";
    if (phase !== schoolLastPhase) {
      setSchoolStatus(phase === "prelude" ? "校歌前奏中 · 等待升旗" : schoolMode === "manual" ? "两面校旗手摇练习中" : "两面校旗同步升起中", "#d6a04f");
      schoolLastPhase = phase;
    }
  }
}
function updateSchoolButtons() {
  $("schoolPlayLabel").textContent = schoolAudio.paused ? (schoolIsFinished() ? "再次演示" : schoolEverStarted && schoolAudio.currentTime > 0 ? "继续升校旗" : "开始升校旗") : "暂停";
  $("schoolPlaySymbol").textContent = schoolAudio.paused ? "▶" : "Ⅱ";
}
async function toggleSchoolPlayback() {
  if (!schoolAudio.paused) { schoolAudio.pause(); return; }
  if (schoolIsFinished() || schoolAudio.currentTime >= SCHOOL_END_SECONDS - 0.03) resetSchool();
  if (!schoolEverStarted && schoolAudio.currentTime < 0.05) schoolManualTurns = 0;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context && !audioContext) audioContext = new Context();
    if (audioContext?.state === "suspended") await audioContext.resume();
    await schoolAudio.play();
    schoolEverStarted = true;
    schoolLastPhase = null;
    updateSchoolButtons();
  } catch (error) {
    console.error("校歌播放失败", error);
    setSchoolStatus("校歌无法播放，请检查本地文件", "#bc685b");
  }
}
function resetSchool() {
  schoolFinished = false;
  schoolAudio.pause();
  schoolAudio.currentTime = 0;
  schoolManualTurns = 0;
  schoolEverStarted = false;
  schoolLastCueIndex = -1;
  schoolLastPhase = null;
  $("schoolBeatLamp").classList.remove("active", "soft");
  setSchoolStatus("校旗准备就绪");
  updateSchoolButtons();
}
function setSchoolMode(next) {
  if (next === schoolMode) return;
  if (next === "manual") schoolManualTurns = schoolTargetTurns();
  schoolMode = next;
  $("schoolAutoMode").classList.toggle("active", next === "auto");
  $("schoolManualMode").classList.toggle("active", next === "manual");
  $("schoolAutoMode").setAttribute("aria-pressed", next === "auto");
  $("schoolManualMode").setAttribute("aria-pressed", next === "manual");
  schoolCrank.classList.toggle("manual", next === "manual");
  $("schoolCrankHint").textContent = next === "manual" ? "按住圆盘沿圆周拖动" : "按播放开始演示";
  $("schoolModeHelp").textContent = next === "manual" ? "可先预演；正式播放时等 24 秒前奏结束再手摇。" : "摇柄与两面校旗按校歌进度同步运动。";
  schoolLastPhase = null;
}
function finishSchoolCeremony() {
  if (schoolFinished) return;
  schoolFinished = true;
  schoolEverStarted = true;
  schoolAudio.pause();
  schoolAudio.currentTime = SCHOOL_END_SECONDS;
  schoolLastCueIndex = SCHOOL_BEAT_COUNT - 1;
  if (schoolMode === "auto") setSchoolStatus("两面校旗已到杆顶", "#398d71");
  else {
    const finalProgress = schoolManualTurns;
    schoolManualTurns = SCHOOL_TURNS;
    setSchoolStatus(finalProgress >= SCHOOL_TURNS - 0.05 ? `校旗练习达标：完成${SCHOOL_TURNS}圈` : `校旗到顶 · 结束前${finalProgress.toFixed(1)}圈`, finalProgress >= SCHOOL_TURNS - 0.05 ? "#398d71" : "#bd8852");
  }
  updateSchoolButtons();
}
function schoolAngleFromPointer(event) {
  const rect = schoolCrank.getBoundingClientRect();
  return Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2);
}
function turnSchoolCrank(delta) {
  if (schoolIsFinished()) return;
  if (schoolPreludeWaiting()) { setSchoolStatus("校歌前奏中 · 等待升旗", "#d6a04f"); return; }
  schoolManualTurns = clamp(schoolManualTurns + delta, 0, SCHOOL_TURNS);
  if (schoolAudio.paused) setSchoolStatus(schoolEverStarted ? "已暂停 · 可继续手摇" : "校旗手摇预演中");
}
function moveSchoolCrank(event) {
  if (schoolPointerAngle === null || schoolMode !== "manual") return;
  const angle = schoolAngleFromPointer(event);
  let delta = angle - schoolPointerAngle;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  turnSchoolCrank(delta / (2 * Math.PI));
  schoolPointerAngle = angle;
}
function setCeremonyView(next) {
  if (next === activeCeremony) return;
  audio.pause();
  schoolAudio.pause();
  activeCeremony = next;
  $("nationalControls").hidden = next !== "national";
  $("schoolControls").hidden = next !== "school";
  $("nationalMetrics").hidden = next !== "national";
  $("schoolMetrics").hidden = next !== "school";
  for (const [name, tab] of [["national", $("nationalTab")], ["school", $("schoolTab")]]) {
    tab.classList.toggle("active", name === next);
    tab.setAttribute("aria-pressed", name === next ? "true" : "false");
  }
  showStatus(next === "national" ? nationalStatus : schoolStatus);
  positionNationalFlag(isFinished() ? TOTAL_TURNS : mode === "auto" ? targetTurns() : manualTurns);
  renderSchool();
}

schoolAudio.addEventListener("loadedmetadata", () => { schoolSeek.disabled = false; });
if (schoolAudio.readyState >= HTMLMediaElement.HAVE_METADATA) schoolSeek.disabled = false;
schoolSeek.addEventListener("input", () => {
  const time = Number(schoolSeek.value) / Number(schoolSeek.max) * SCHOOL_END_SECONDS;
  schoolFinished = false;
  schoolAudio.currentTime = time;
  if (time > 0) schoolEverStarted = true;
  if (schoolMode === "manual") schoolManualTurns = schoolTargetTurns();
  schoolLastCueIndex = time < SCHOOL_PRELUDE_SECONDS ? -1 : clamp(Math.floor((time - SCHOOL_PRELUDE_SECONDS) / SCHOOL_SECONDS_PER_BEAT), 0, SCHOOL_BEAT_COUNT - 1);
  schoolLastPhase = null;
  if (time >= SCHOOL_END_SECONDS - 0.001) { finishSchoolCeremony(); return; }
  updateSchoolButtons();
  if (schoolAudio.paused) setSchoolStatus(time < SCHOOL_PRELUDE_SECONDS ? "已定位到校歌前奏" : "已定位到校旗升旗段", "#8ea79a");
});
schoolAudio.addEventListener("play", updateSchoolButtons);
schoolAudio.addEventListener("pause", () => {
  updateSchoolButtons();
  schoolLastPhase = null;
  if (!schoolIsFinished() && schoolEverStarted && schoolAudio.currentTime > 0) setSchoolStatus("已暂停", "#8ea79a");
});
schoolAudio.addEventListener("timeupdate", () => { if (!schoolFinished && !schoolAudio.paused && schoolAudio.currentTime >= SCHOOL_END_SECONDS) finishSchoolCeremony(); });
schoolAudio.addEventListener("ended", finishSchoolCeremony);
schoolAudio.addEventListener("error", () => setSchoolStatus("校歌文件加载失败", "#bc685b"));
$("schoolPlayButton").addEventListener("click", toggleSchoolPlayback);
$("schoolResetButton").addEventListener("click", resetSchool);
$("schoolAutoMode").addEventListener("click", () => setSchoolMode("auto"));
$("schoolManualMode").addEventListener("click", () => setSchoolMode("manual"));
$("nationalTab").addEventListener("click", () => setCeremonyView("national"));
$("schoolTab").addEventListener("click", () => setCeremonyView("school"));
schoolCrank.addEventListener("pointerdown", (event) => {
  if (schoolMode !== "manual" || schoolIsFinished()) return;
  if (schoolPreludeWaiting()) { setSchoolStatus("校歌前奏中 · 等待升旗", "#d6a04f"); return; }
  schoolPointerAngle = schoolAngleFromPointer(event);
  schoolCrank.setPointerCapture(event.pointerId);
  schoolCrank.classList.add("dragging");
  event.preventDefault();
});
schoolCrank.addEventListener("pointermove", moveSchoolCrank);
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  schoolCrank.addEventListener(name, () => { schoolPointerAngle = null; schoolCrank.classList.remove("dragging"); });
}
schoolCrank.addEventListener("keydown", (event) => {
  if (schoolMode !== "manual" || !["ArrowRight", "ArrowLeft"].includes(event.key)) return;
  turnSchoolCrank((event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 1 : 0.1));
  event.preventDefault();
});

drawStars();
drawBeatGrid();
drawSchoolBeatGrid();
render();
