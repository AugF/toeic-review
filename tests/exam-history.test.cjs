const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "exam_mode.js"), "utf8");

function harness() {
  const storage = new Map();
  const select = {
    value: "",
    set innerHTML(html) {
      this.html = html;
      this.options = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => ({ value: m[1] }));
      this.value = this.options[0]?.value || "";
    },
  };
  const els = { setSelect: select, setNote: {}, start: {}, unpracticedOnly: { checked: false }, historySummary: {} };
  const context = vm.createContext({
    window: {}, els, mode: "fixed",
    SET_HISTORY_KEY: "history", SET_SELECTION_KEY: "selection",
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  });
  context.document = { querySelector: () => ({ value: context.mode }) };
  vm.runInContext(fs.readFileSync(path.join(root, "toeic_review_data.js"), "utf8"), context);
  vm.runInContext(
    "const data = window.TOEIC_REVIEW_DATA; let setHistory = {}; let exam = null;" +
    source.slice(source.indexOf("  function escapeHtml"), source.indexOf("  function saveExam")) +
    source.slice(source.indexOf("  function populateSetSelect"), source.indexOf("  function createExam")) +
    source.slice(source.indexOf("  function getRawScore"), source.indexOf("  function renderReport")) +
    "const sets = buildCompleteSets();", context
  );
  const run = (code) => vm.runInContext(code, context);
  function attempt(index, date, completed = true) {
    context.setIndex = index;
    context.date = date;
    context.completed = completed;
    run("var selected = sets[setIndex];");
    run(`
      exam = {
        sourceFile: selected.sourceFile, startedAt: date, completedAt: date, status: "complete",
        steps: createSteps(selected), answers: {}, index: completed ? 11 : 1
      };
      exam.steps.slice(0, completed ? 11 : 1).forEach((step) => {
        exam.answers[step.uid] = step.part === 1
          ? { pronunciation: 3, prosody: 3 } : { score: step.part === 5 ? 5 : 3 };
      });
      recordExamHistory();
    `);
  }
  return { context, storage, els, run, attempt };
}

test("completed attempts show last score and persist across reloads", () => {
  const h = harness();
  h.attempt(0, "2026-11-19T10:00:00Z");
  assert.match(h.run("setHistoryLabel(sets[0].sourceFile)"), /已考过.*41\/41/);
  h.run("setHistory = loadSetHistory(); populateSetSelect(sets[0].sourceFile)");
  assert.match(h.els.setSelect.html, /已考过.*41\/41/);
  assert.match(h.els.setNote.textContent, /上次交卷/);
  assert.match(h.els.historySummary.textContent, /已考过 1 套/);
});

test("unpracticed filter applies to fixed and random choices", () => {
  const h = harness();
  h.attempt(0, "2026-11-19T10:00:00Z");
  h.els.unpracticedOnly.checked = true;
  h.run("populateSetSelect(sets[0].sourceFile)");
  assert.equal(h.run("chooseSet(sets[0].sourceFile)"), null);
  assert.ok(!h.els.setSelect.html.includes("已考过"));
  for (const mode of ["any", "focus"]) {
    for (let i = 0; i < 50; i++) assert.ok(h.run(`chooseSet("${mode}").sourceFile !== sets[0].sourceFile`));
  }
});

test("early submission stays eligible, and retakes retain completion status", () => {
  const h = harness();
  h.attempt(0, "2026-11-19T10:00:00Z", false);
  assert.match(h.run("setHistoryLabel(sets[0].sourceFile)"), /未考完.*6\/41.*提前交卷/);
  h.els.unpracticedOnly.checked = true;
  assert.ok(h.run("chooseSet(sets[0].sourceFile)"));
  h.attempt(0, "2026-11-19T11:00:00Z");
  h.attempt(0, "2026-11-19T12:00:00Z", false);
  assert.match(h.run("setHistoryLabel(sets[0].sourceFile)"), /已考过.*6\/41/);
  assert.equal(h.run("chooseSet(sets[0].sourceFile)"), null);
});

test("older restored reports do not overwrite the latest attempt", () => {
  const h = harness();
  h.attempt(0, "2026-11-19T12:00:00Z");
  const history = h.storage.get("history");
  h.run("recordExamHistory()");
  assert.equal(h.storage.get("history"), history);
  h.attempt(0, "2026-11-19T10:00:00Z", false);
  assert.equal(h.storage.get("history"), history);
});

test("all completed disables starting; removing filter allows retakes", () => {
  const h = harness();
  const count = h.run("sets.length");
  for (let i = 0; i < count; i++) h.attempt(i, "2026-11-19T10:00:00Z");
  h.els.unpracticedOnly.checked = true;
  h.context.mode = "random";
  h.run("populateSetSelect()");
  assert.equal(h.els.start.disabled, true);
  assert.equal(h.run('chooseSet("any")'), null);
  assert.match(h.els.setNote.textContent, /所有套题都已考过/);
  h.els.unpracticedOnly.checked = false;
  h.run("populateSetSelect()");
  assert.equal(h.els.start.disabled, false);
});

test("malformed storage is ignored", () => {
  const h = harness();
  for (const value of ["null", "[]", "{", '{"bad":{"completed":true,"earned":"41","max":41}}']) {
    h.storage.set("history", value);
    assert.equal(h.run("Object.keys(loadSetHistory()).length"), 0);
  }
});
