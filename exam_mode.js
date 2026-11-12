(() => {
  "use strict";

  const data = window.TOEIC_REVIEW_DATA;
  if (!data || !Array.isArray(data.records)) return;

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "toeic-review-mock-exam-v1";
  const MODE_KEY = "toeic-review-active-mode";
  const MODE_PRACTICE = "practice";
  const MODE_EXAM = "exam";
  const TOTAL_QUESTIONS = 11;
  const PART_BREAK_SECONDS = 3;
  const audioUrls = new Map();

  const els = {
    practice: $("appShell"),
    exam: $("examApp"),
    practiceButton: $("practiceModeButton"),
    examButton: $("examModeButton"),
    setup: $("examSetup"),
    runner: $("examRunner"),
    report: $("examReport"),
    setSelect: $("examSetSelect"),
    setNote: $("examSetNote"),
    micStatus: $("examMicStatus"),
    micCheck: $("examMicCheckButton"),
    start: $("examStartButton"),
    resume: $("examResumeButton"),
    exit: $("examExitButton"),
    sessionStatus: $("examSessionStatus"),
    partLabel: $("examPartLabel"),
    questionLabel: $("examQuestionLabel"),
    progressCopy: $("examProgressCopy"),
    progressBar: $("examProgressBar"),
    direction: $("examDirection"),
    questionContent: $("examQuestionContent"),
    transcript: $("examTranscript"),
    phaseLabel: $("examPhaseLabel"),
    phaseNote: $("examPhaseNote"),
    timer: $("examTimer"),
    recordState: $("examRecordState"),
    pause: $("examPauseButton"),
    advance: $("examAdvanceButton"),
    finish: $("examFinishButton"),
    reportMeta: $("examReportMeta"),
    scoreSummary: $("examScoreSummary"),
    reportList: $("examReportList"),
    print: $("examPrintButton"),
    restart: $("examRestartButton"),
  };

  let sets = [];
  let exam = null;
  let timerHandle = null;
  let lastTickSecond = null;
  let micStream = null;
  let audioContext = null;
  let analyser = null;
  let analyserSource = null;
  let activeRecording = null;
  let phaseTransitioning = false;
  let finalizingExam = false;
  const preloadedExamImages = new Set();

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function priorityWeight(priority) {
    return priority === "P1" ? 3 : priority === "P2" ? 2 : 1;
  }

  function sortQuestionId(a, b) {
    return Number(a.questionId || 0) - Number(b.questionId || 0);
  }

  function buildCompleteSets() {
    const bySource = new Map();
    data.records.forEach((record) => {
      if (!record?.sourceFile || !record.part) return;
      if (!bySource.has(record.sourceFile)) bySource.set(record.sourceFile, []);
      bySource.get(record.sourceFile).push(record);
    });

    return [...bySource.entries()].map(([sourceFile, records]) => {
      const findPart = (part) => records.filter((record) => record.part === part);
      const part1 = findPart(1).sort(sortQuestionId).slice(0, 2);
      const part2 = findPart(2).sort(sortQuestionId).slice(0, 2);
      const part3 = findPart(3)[0];
      const part4 = findPart(4)[0];
      const part5 = findPart(5)[0];
      if (part1.length !== 2 || part2.length !== 2 || part3?.questions?.length < 3 || part4?.questions?.length < 3 || !part5) return null;
      const included = [...part1, ...part2, part3, part4, part5];
      return {
        sourceFile,
        name: part1[0].bankName || sourceFile.replace(/\.json$/i, ""),
        priority: Math.round(included.reduce((sum, record) => sum + priorityWeight(record.priority), 0) / included.length),
        part1,
        part2,
        part3,
        part4,
        part5,
      };
    }).filter(Boolean).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, "zh-CN"));
  }

  function createSteps(set) {
    const steps = [];
    const addSingle = (record, number) => steps.push({
      uid: record.uid,
      number,
      part: record.part,
      record,
      parent: null,
      preparationTime: Number(record.preparationTime) || 0,
      answerTime: Number(record.answerTime) || 0,
      type: "single",
    });
    addSingle(set.part1[0], 1);
    addSingle(set.part1[1], 2);
    addSingle(set.part2[0], 3);
    addSingle(set.part2[1], 4);
    set.part3.questions.slice(0, 3).sort((a, b) => a.position - b.position).forEach((question, index) => {
      steps.push({
        uid: question.uid,
        number: 5 + index,
        part: 3,
        record: question,
        parent: set.part3,
        preparationTime: Number(question.preparationTime) || 3,
        answerTime: Number(question.answerTime) || (index === 2 ? 30 : 15),
        type: "group-question",
      });
    });
    set.part4.questions.slice(0, 3).sort((a, b) => a.position - b.position).forEach((question, index) => {
      steps.push({
        uid: question.uid,
        number: 8 + index,
        part: 4,
        record: question,
        parent: set.part4,
        preparationTime: Number(question.preparationTime) || 3,
        answerTime: Number(question.answerTime) || (index === 2 ? 30 : 15),
        reviewTime: index === 0 ? Number(set.part4.reviewTime) || 45 : 0,
        type: "group-question",
      });
    });
    addSingle(set.part5, 11);
    return steps;
  }

  function saveExam() {
    if (!exam) return;
    try {
      const stored = {
        ...exam,
        status: exam.status === "running" ? "paused" : exam.status,
        remainingMs: currentRemainingMs(),
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // The exam still runs when browser storage is unavailable.
    }
  }

  function loadSavedExam() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved?.sourceFile || !saved?.view) return null;
      const set = sets.find((item) => item.sourceFile === saved.sourceFile);
      if (!set) return null;
      return { ...saved, steps: createSteps(set), status: saved.status === "complete" ? "complete" : "paused" };
    } catch {
      return null;
    }
  }

  function clearSavedExam() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function currentStep() {
    return exam?.steps?.[exam.index] || null;
  }

  function currentRemainingMs() {
    if (!exam) return 0;
    if (exam.status === "running" && exam.phaseEndsAt) return Math.max(0, exam.phaseEndsAt - Date.now());
    return Math.max(0, Number(exam.remainingMs) || 0);
  }

  function formatTimer(ms) {
    const total = Math.ceil(Math.max(0, ms) / 1000);
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  function phaseDuration(step, phase) {
    if (phase === "part-break") return PART_BREAK_SECONDS;
    if (phase === "reading") return step.reviewTime || 45;
    if (phase === "preparing") return step.preparationTime || 3;
    return step.answerTime || 15;
  }

  function firstPhase(step) {
    return step.reviewTime ? "reading" : "preparing";
  }

  function phaseInfo(phase) {
    if (phase === "part-break") return ["Part 间隔", "上一部分已完成。请稍作停顿，下一部分即将开始。"];
    if (phase === "reading") return ["阅读资料", "请阅读资料。稍后将依次显示三个问题。"];
    if (phase === "preparing") return ["准备时间", "请阅读题目并准备作答。"];
    return ["正式作答", "录音已自动开始，请直接用英语作答。"];
  }

  function syncMode(mode) {
    const isExam = mode === MODE_EXAM;
    els.practice.hidden = isExam;
    els.exam.hidden = !isExam;
    els.practiceButton.classList.toggle("active", !isExam);
    els.examButton.classList.toggle("active", isExam);
    els.practiceButton.setAttribute("aria-selected", String(!isExam));
    els.examButton.setAttribute("aria-selected", String(isExam));
    localStorage.setItem(MODE_KEY, mode);
    if (isExam) renderExam();
    if (!isExam && exam?.status === "running") pauseExam();
  }

  function populateSetSelect() {
    const options = [
      '<option value="focus">重点优先随机套题</option>',
      '<option value="any">全题库随机套题</option>',
      ...sets.map((set) => '<option value="' + escapeHtml(set.sourceFile) + '">' + escapeHtml(set.name) + "</option>"),
    ];
    els.setSelect.innerHTML = options.join("");
    updateSetNote();
  }

  function updateSetNote() {
    const value = els.setSelect.value;
    if (value === "focus") {
      els.setNote.textContent = "会优先抽取包含更多 P1 重点题的完整原始套题。";
    } else if (value === "any") {
      els.setNote.textContent = "从所有可组成完整 11 题的原始套题中随机抽取。";
    } else {
      const set = sets.find((item) => item.sourceFile === value);
      els.setNote.textContent = set ? "固定使用「" + set.name + "」的完整题组。" : "";
    }
  }

  function chooseSet(value) {
    if (value !== "focus" && value !== "any") return sets.find((set) => set.sourceFile === value) || sets[0];
    const candidates = value === "focus"
      ? sets.flatMap((set) => Array.from({ length: Math.max(1, set.priority) }, () => set))
      : sets;
    return candidates[Math.floor(Math.random() * candidates.length)] || sets[0];
  }

  function createExam(set) {
    return {
      version: 1,
      view: "runner",
      sourceFile: set.sourceFile,
      setName: set.name,
      steps: createSteps(set),
      index: 0,
      phase: firstPhase(createSteps(set)[0]),
      remainingMs: phaseDuration(createSteps(set)[0], firstPhase(createSteps(set)[0])) * 1000,
      status: "paused",
      startedAt: new Date().toISOString(),
      answers: {},
    };
  }

  async function ensureMicrophone() {
    if (micStream?.active) return true;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setMicStatus("当前浏览器不支持网页录音", "error");
      return false;
    }
    try {
      setMicStatus("正在请求麦克风权限…");
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      setupAnalyser();
      setMicStatus("麦克风已连接", "ready");
      return true;
    } catch (error) {
      const message = error?.name === "NotAllowedError" ? "麦克风权限被拒绝" : "无法连接麦克风";
      setMicStatus(message, "error");
      return false;
    }
  }

  function setMicStatus(text, state = "") {
    els.micStatus.textContent = text;
    els.micStatus.className = "exam-mic-status" + (state ? " " + state : "");
  }

  function setupAnalyser() {
    if (!micStream || analyser) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyserSource = audioContext.createMediaStreamSource(micStream);
      analyserSource.connect(analyser);
    } catch {
      analyser = null;
    }
  }

  function sampleVolume() {
    if (!analyser) return 0;
    const values = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(values);
    let total = 0;
    for (const value of values) total += (value - 128) ** 2;
    return Math.sqrt(total / values.length) / 128;
  }

  function playTone(kind = "tick") {
    try {
      const context = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (context.state === "suspended") context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "end" ? "square" : "sine";
      oscillator.frequency.value = kind === "end" ? 880 : 620;
      gain.gain.setValueAtTime(kind === "end" ? 0.12 : 0.05, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + (kind === "end" ? 0.24 : 0.07));
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + (kind === "end" ? 0.25 : 0.08));
    } catch {
      // Audio alerts are optional when a browser blocks AudioContext.
    }
  }

  function startRecognition(session) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0]?.transcript || "";
        if (event.results[index].isFinal) session.finalTranscript += text + " ";
        else interim += text;
      }
      session.interimTranscript = interim;
      renderLiveTranscript();
    };
    recognition.onend = () => {
      if (activeRecording === session && session.acceptRecognition && exam?.status === "running" && exam.phase === "answering") {
        window.setTimeout(() => startRecognition(session), 160);
      }
    };
    try {
      recognition.start();
      session.recognition = recognition;
    } catch {
      // Chrome may reject a rapid restart; the recording remains usable.
    }
  }

  function renderLiveTranscript() {
    if (!activeRecording) return;
    const text = (activeRecording.finalTranscript + activeRecording.interimTranscript).trim();
    els.transcript.hidden = !text;
    els.transcript.textContent = text || "";
  }

  function startRecording(step) {
    if (!micStream?.active || !window.MediaRecorder) {
      els.recordState.textContent = "未能录音；本题仅计时";
      return;
    }
    const session = {
      step,
      chunks: [],
      finalTranscript: "",
      interimTranscript: "",
      samples: [],
      startedAt: Date.now(),
      acceptRecognition: true,
      recorder: null,
      recognition: null,
      meter: null,
    };
    activeRecording = session;
    try {
      const recorder = new MediaRecorder(micStream);
      session.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) session.chunks.push(event.data);
      };
      recorder.start(250);
      session.meter = window.setInterval(() => session.samples.push(sampleVolume()), 100);
      startRecognition(session);
      els.recordState.textContent = "正在录音与识别";
      els.recordState.className = "exam-record-state recording";
    } catch {
      els.recordState.textContent = "录音启动失败；本题仅计时";
      els.recordState.className = "exam-record-state";
      activeRecording = null;
    }
  }

  function recordingMeta(step) {
    return { record: step.record, parent: step.parent, part: step.part, uid: step.uid };
  }

  function stopRecording() {
    const session = activeRecording;
    if (!session) return Promise.resolve(null);
    activeRecording = null;
    session.acceptRecognition = false;
    if (session.meter) window.clearInterval(session.meter);
    try { session.recognition?.stop(); } catch {}
    const finalize = async () => {
      const durationSeconds = Math.max(0.1, (Date.now() - session.startedAt) / 1000);
      let transcript = (session.finalTranscript + session.interimTranscript).replace(/\s+/g, " ").trim();
      let transcriptionSource = "browser";
      let audioBlob = null;
      if (session.chunks.length) {
        audioBlob = new Blob(session.chunks, { type: session.recorder?.mimeType || "audio/webm" });
        const previous = audioUrls.get(session.step.uid);
        if (previous) URL.revokeObjectURL(previous);
        audioUrls.set(session.step.uid, URL.createObjectURL(audioBlob));
      }
      if (audioBlob && typeof window.toeicReviewTranscriber?.isCloudEnabled === "function" && window.toeicReviewTranscriber.isCloudEnabled()) {
        els.recordState.textContent = "正在使用高精度云端转写";
        const transcription = await window.toeicReviewTranscriber.transcribeAudio(audioBlob, transcript);
        transcript = transcription.text || transcript;
        transcriptionSource = transcription.source || "browser";
        if (transcription.error) {
          els.recordState.textContent = "云端转写暂不可用，已使用浏览器转写";
        }
      }
      let result;
      try {
        result = typeof window.toeicReviewScorer?.scoreRecording === "function"
          ? window.toeicReviewScorer.scoreRecording(recordingMeta(session.step), transcript, durationSeconds, session.samples)
          : { unscored: true, transcript, durationSeconds, feedback: ["当前浏览器无法运行本地练习评分。"] };
      } catch {
        result = { unscored: true, transcript, durationSeconds, feedback: ["本题录音已保存，但评分暂不可用。"] };
      }
      result.transcriptionSource = transcriptionSource;
      exam.answers[session.step.uid] = result;
      els.recordState.textContent = transcript ? "录音已保存，已生成练习评分" : "录音已保存，未识别到英文文本";
      els.recordState.className = "exam-record-state success";
      return result;
    };
    return new Promise((resolve) => {
      let finalized = false;
      const complete = () => {
        if (finalized) return;
        finalized = true;
        void finalize().then(resolve);
      };
      if (!session.recorder || session.recorder.state === "inactive") {
        complete();
        return;
      }
      session.recorder.addEventListener("stop", complete, { once: true });
      try { session.recorder.stop(); } catch { complete(); }
    });
  }

  function setPhase(phase, remainingMs = null) {
    const step = currentStep();
    if (!step) return finishExam();
    stopTimer();
    exam.phase = phase;
    exam.remainingMs = remainingMs === null ? phaseDuration(step, phase) * 1000 : remainingMs;
    exam.phaseEndsAt = exam.status === "running" ? Date.now() + exam.remainingMs : null;
    lastTickSecond = null;
    if (phase === "answering" && exam.status === "running") startRecording(step);
    saveExam();
    renderExam();
    if (exam.status === "running") startTimer();
  }

  function startTimer() {
    stopTimer();
    timerHandle = window.setInterval(tick, 100);
    tick();
  }

  function stopTimer() {
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
  }

  async function tick() {
    if (!exam || exam.status !== "running") return;
    const remaining = currentRemainingMs();
    exam.remainingMs = remaining;
    const seconds = Math.ceil(remaining / 1000);
    if (seconds <= 10 && seconds > 0 && seconds !== lastTickSecond) {
      playTone("tick");
      lastTickSecond = seconds;
    }
    updateTimerView();
    if (remaining <= 0) {
      stopTimer();
      playTone("end");
      await advancePhase();
    }
  }

  async function advancePhase() {
    if (!exam || phaseTransitioning) return;
    phaseTransitioning = true;
    try {
      const step = currentStep();
      if (!step) return await finishExam();
      if (exam.phase === "part-break") return setPhase(firstPhase(step));
      if (exam.phase === "reading") return setPhase("preparing");
      if (exam.phase === "preparing") return setPhase("answering");
      els.recordState.textContent = "正在保存本题录音…";
      await stopRecording();
      const completedPart = step.part;
      exam.index += 1;
      if (exam.index >= exam.steps.length) return await finishExam();
      const next = currentStep();
      setPhase(next.part !== completedPart ? "part-break" : firstPhase(next));
    } finally {
      phaseTransitioning = false;
    }
  }

  function pauseExam() {
    if (!exam || exam.status !== "running") return;
    exam.remainingMs = currentRemainingMs();
    exam.status = "paused";
    exam.phaseEndsAt = null;
    stopTimer();
    if (activeRecording?.recorder?.state === "recording") {
      try { activeRecording.recorder.pause(); } catch {}
      activeRecording.acceptRecognition = false;
      try { activeRecording.recognition?.stop(); } catch {}
    }
    saveExam();
    renderExam();
  }

  function resumeExam() {
    if (!exam || exam.status !== "paused") return;
    exam.status = "running";
    exam.phaseEndsAt = Date.now() + Math.max(1, exam.remainingMs || 1);
    if (exam.phase === "answering") {
      if (!activeRecording) startRecording(currentStep());
      else {
        try { activeRecording.recorder?.resume(); } catch {}
        activeRecording.acceptRecognition = true;
        startRecognition(activeRecording);
      }
    }
    saveExam();
    renderExam();
    startTimer();
  }

  async function finishExam() {
    if (!exam || finalizingExam) return;
    finalizingExam = true;
    try {
      stopTimer();
      if (activeRecording) await stopRecording();
      exam.status = "complete";
      exam.view = "report";
      exam.remainingMs = 0;
      exam.phaseEndsAt = null;
      exam.completedAt = new Date().toISOString();
      saveExam();
      renderExam();
    } finally {
      finalizingExam = false;
    }
  }

  function buildMaterial(material) {
    if (!material) return "";
    const rows = (material.rows || []).map((row) => "<tr>" + (row.cells || []).map((cell) => "<td>" + escapeHtml(cell) + "</td>").join("") + "</tr>").join("");
    const headers = (material.headers || []).map((header) => "<th>" + escapeHtml(header) + "</th>").join("");
    const notes = (material.notes || []).filter(Boolean).join("\n");
    return '<div class="exam-material-wrap"><table class="exam-material-table"><thead><tr>' + headers + "</tr></thead><tbody>" + rows + "</tbody></table>" + (notes ? '<div class="exam-material-notes">' + escapeHtml(notes) + "</div>" : "") + "</div>";
  }

  function questionHtml(step) {
    if (exam.phase === "part-break") {
      return '<div class="exam-part-break"><p>Part ' + escapeHtml(step.part) + ' 即将开始</p><strong>请整理呼吸，准备进入下一部分。</strong></div>';
    }
    const record = step.record;
    if (step.part === 2) {
      return record.imagePath
        ? '<img class="exam-picture" src="' + escapeHtml(record.imagePath) + '" alt="Part 2 描述图片" decoding="async" fetchpriority="high" />'
        : '<p class="exam-reading-prompt">图片资源不可用，请返回刷题模式确认题目。</p>';
    }
    if (step.part === 4) {
      const material = buildMaterial(step.parent?.material);
      const prompt = exam.phase === "reading"
        ? '<p class="exam-reading-prompt">请先阅读下方资料。资料阅读结束后将显示问题。</p>'
        : '<p class="exam-prompt">' + escapeHtml(record.prompt) + "</p>";
      return material + '<div class="exam-material-question">' + prompt + "</div>";
    }
    return '<p class="exam-prompt">' + escapeHtml(record.prompt) + "</p>";
  }

  function preloadUpcomingExamImages() {
    if (!exam?.steps?.length) return;
    const upcomingPictureSteps = exam.steps
      .slice(exam.index)
      .filter((step) => step.part === 2 && step.record?.imagePath)
      .slice(0, 2);
    upcomingPictureSteps.forEach((step) => {
      const imagePath = step.record.imagePath;
      if (preloadedExamImages.has(imagePath)) return;
      preloadedExamImages.add(imagePath);
      const image = new Image();
      image.decoding = "async";
      image.src = imagePath;
    });
  }

  function directionFor(step) {
    if (step.part === 1) return "请朗读以下短文。";
    if (step.part === 2) return "请尽可能详细地描述屏幕上的图片。";
    if (step.part === 3) return "请回答以下问题。";
    if (step.part === 4) return "请根据提供的信息回答问题。";
    return "请针对以下问题表达你的观点并给出理由。";
  }

  function updateTimerView() {
    const remaining = currentRemainingMs();
    els.timer.textContent = formatTimer(remaining);
    els.timer.classList.toggle("warning", remaining > 0 && remaining <= 10000);
  }

  function scoreText(step, result) {
    if (!result || result.unscored) return "未评分";
    if (step.part === 1) return "发音 " + result.pronunciation + "/3 · 语调重音 " + result.prosody + "/3";
    return "练习分 " + result.score + "/" + (step.part === 5 ? 5 : 3);
  }

  function renderRunner() {
    const step = currentStep();
    if (!step) return;
    const [phaseLabel, phaseNote] = phaseInfo(exam.phase);
    const isPartBreak = exam.phase === "part-break";
    els.partLabel.textContent = "Part " + step.part + (isPartBreak ? " 切换" : "");
    els.questionLabel.textContent = isPartBreak ? "短暂停顿" : "第 " + step.number + " 题";
    els.progressCopy.textContent = step.number + " / " + TOTAL_QUESTIONS;
    els.progressBar.style.width = ((step.number - 1) / TOTAL_QUESTIONS * 100) + "%";
    els.direction.textContent = isPartBreak ? "上一部分已完成，下一部分即将开始。" : directionFor(step);
    els.questionContent.innerHTML = questionHtml(step);
    preloadUpcomingExamImages();
    els.phaseLabel.textContent = phaseLabel;
    els.phaseNote.textContent = phaseNote;
    updateTimerView();
    els.pause.textContent = exam.status === "running" ? "暂停" : "继续";
    els.advance.textContent = isPartBreak ? "立即开始下一 Part" : exam.phase === "answering" ? "提前结束作答" : exam.phase === "reading" ? "结束阅读" : "跳过准备";
    els.transcript.hidden = true;
    els.transcript.textContent = "";
    els.recordState.textContent = isPartBreak ? "短暂停顿中" : exam.phase === "answering" ? (activeRecording ? "正在录音与识别" : "等待录音") : "等待作答";
    els.recordState.className = "exam-record-state" + (exam.phase === "answering" && activeRecording ? " recording" : "");
    els.sessionStatus.textContent = exam.status === "paused" ? "已暂停" : "考试进行中";
    els.exit.hidden = false;
  }

  function getRawScore(step, result) {
    if (!result || result.unscored) return { earned: 0, max: step.part === 1 ? 6 : step.part === 5 ? 5 : 3 };
    if (step.part === 1) return { earned: (result.pronunciation || 0) + (result.prosody || 0), max: 6 };
    return { earned: result.score || 0, max: step.part === 5 ? 5 : 3 };
  }

  function renderReport() {
    const summary = new Map([
      [1, { earned: 0, max: 0 }],
      [2, { earned: 0, max: 0 }],
      [3, { earned: 0, max: 0 }],
      [4, { earned: 0, max: 0 }],
      [5, { earned: 0, max: 0 }],
    ]);
    exam.steps.forEach((step) => {
      const score = getRawScore(step, exam.answers?.[step.uid]);
      const part = summary.get(step.part);
      part.earned += score.earned;
      part.max += score.max;
    });
    const total = [...summary.values()].reduce((sum, item) => ({ earned: sum.earned + item.earned, max: sum.max + item.max }), { earned: 0, max: 0 });
    els.reportMeta.textContent = exam.setName + " · " + new Date(exam.startedAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
    els.scoreSummary.innerHTML = '<div class="exam-total-score"><span class="exam-score-number">' + total.earned + " / " + total.max + '</span><span class="exam-score-label">模拟考试总分</span></div>' +
      [...summary.entries()].map(([part, score]) => '<div class="exam-part-score"><strong>Part ' + part + '</strong><span class="exam-score-number">' + score.earned + " / " + score.max + '</span><span class="exam-score-label">' + (part === 1 ? "发音与语调重音" : part === 5 ? "观点表达" : "综合作答") + "</span></div>").join("");
    els.reportList.innerHTML = exam.steps.map((step, index) => {
      const result = exam.answers?.[step.uid];
      const audio = audioUrls.get(step.uid);
      const feedback = result?.feedback?.length ? result.feedback.map((line) => "<p class=\"exam-report-feedback\">" + escapeHtml(line) + "</p>").join("") : "<p class=\"exam-report-feedback\">本题没有可用评分；可结合参考答案复盘。</p>";
      const transcriptTitle = result?.transcriptionSource === "siliconflow" ? "识别文本（高精度云端）" : "识别文本";
      const reference = step.part === 4 && step.parent ? step.record.answer : step.record.answer;
      return '<details class="exam-report-item"' + (index === 0 ? " open" : "") + "><summary><span class=\"exam-report-item-title\">Part " + step.part + " · 第 " + step.number + " 题</span><span class=\"exam-report-item-score\">" + escapeHtml(scoreText(step, result)) + "</span></summary><div class=\"exam-report-detail\"><h3>题目</h3><p>" + escapeHtml(step.record.prompt || directionFor(step)) + "</p><h3>" + transcriptTitle + "</h3><p>" + escapeHtml(result?.transcript || "未识别到文本") + "</p>" + feedback + (audio ? '<audio class="exam-report-audio" controls src="' + escapeHtml(audio) + '"></audio>' : "") + '<details class="exam-reference"><summary>查看参考答案</summary><div class="exam-reference-text">' + escapeHtml(reference || "暂无参考答案") + "</div></details></div></details>";
    }).join("");
    els.sessionStatus.textContent = "本次模拟已完成";
    els.exit.hidden = true;
  }

  function renderExam() {
    const view = exam?.view || "setup";
    els.setup.hidden = view !== "setup";
    els.runner.hidden = view !== "runner";
    els.report.hidden = view !== "report";
    els.resume.hidden = !exam || exam.view !== "runner" || exam.status === "complete";
    els.start.hidden = Boolean(exam && exam.view === "runner");
    if (view === "runner") renderRunner();
    if (view === "report") renderReport();
  }

  async function startNewExam() {
    if (exam?.view === "runner" && !window.confirm("开始新模拟会替换当前未完成的进度，是否继续？")) return;
    const connected = await ensureMicrophone();
    if (!connected) return;
    const set = chooseSet(els.setSelect.value);
    if (!set) return;
    exam = createExam(set);
    exam.status = "running";
    exam.phaseEndsAt = Date.now() + exam.remainingMs;
    saveExam();
    renderExam();
    playTone("end");
    startTimer();
  }

  async function resumeSavedExam() {
    if (!exam || exam.view !== "runner") return;
    const connected = await ensureMicrophone();
    if (!connected) return;
    resumeExam();
  }

  function exitExam() {
    if (exam?.status === "running") pauseExam();
    if (exam?.view === "runner" && !window.confirm("退出后可在模拟考试页继续本次进度，确定退出吗？")) return;
    exam = exam ? { ...exam, view: "setup", status: exam.status === "complete" ? "complete" : "paused" } : null;
    saveExam();
    renderExam();
  }

  async function finishEarly() {
    if (!exam || !window.confirm("确定结束本次模拟并生成报告吗？")) return;
    await finishExam();
  }

  function initialize() {
    sets = buildCompleteSets();
    populateSetSelect();
    exam = loadSavedExam();
    if (exam?.view === "report") exam.status = "complete";
    els.setSelect.addEventListener("change", updateSetNote);
    els.practiceButton.addEventListener("click", () => syncMode(MODE_PRACTICE));
    els.examButton.addEventListener("click", () => syncMode(MODE_EXAM));
    els.micCheck.addEventListener("click", ensureMicrophone);
    els.start.addEventListener("click", startNewExam);
    els.resume.addEventListener("click", resumeSavedExam);
    els.exit.addEventListener("click", exitExam);
    els.pause.addEventListener("click", () => exam?.status === "running" ? pauseExam() : resumeExam());
    els.advance.addEventListener("click", advancePhase);
    els.finish.addEventListener("click", finishEarly);
    els.restart.addEventListener("click", () => {
      clearSavedExam();
      exam = null;
      renderExam();
    });
    els.print.addEventListener("click", () => window.print());
    window.addEventListener("pagehide", () => {
      if (exam?.status === "running") pauseExam();
      else saveExam();
    });
    window.addEventListener("beforeunload", () => audioUrls.forEach((url) => URL.revokeObjectURL(url)));
    const requestedMode = localStorage.getItem(MODE_KEY);
    syncMode(requestedMode === MODE_EXAM ? MODE_EXAM : MODE_PRACTICE);
  }

  initialize();
})();
