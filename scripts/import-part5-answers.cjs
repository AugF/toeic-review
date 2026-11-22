const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function parseAnswers(markdown) {
  const sections = new Map();
  let current = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(/^##\s+(\d+)\s+(.+)$/u);
    if (heading) {
      const number = Number(heading[1]);
      if (sections.has(number)) throw new Error("Duplicate section: " + number);
      current = { number, title: heading[2].trim(), lines: [] };
      sections.set(number, current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  for (const section of sections.values()) {
    const start = section.lines.findIndex(line => /^[A-Za-z]/.test(line.trim()));
    if (start < 0) throw new Error("Missing English answer: " + section.number);
    section.answer = section.lines.slice(start).join("\n").trim();
    if (/[\u3400-\u9fff]/u.test(section.answer)) throw new Error("Unexpected Chinese inside English answer: " + section.number);
    delete section.lines;
  }
  return sections;
}

function applyAnswers(data, sections) {
  const records = data.records.filter(record => record.part === 5);
  const updates = records.map(record => {
    const match = record.sourceFile.match(/^真题0*(\d+)/u);
    const section = match && sections.get(Number(match[1]));
    if (!section) throw new Error("Unmatched Part 5 record: " + record.sourceFile);
    return {record, section};
  });
  const numbers = new Set(updates.map(({section}) => section.number));
  if (numbers.size !== records.length || numbers.size !== sections.size) {
    throw new Error("Document sections and website questions do not match one-to-one.");
  }
  for (const {record, section} of updates) {
    record.questionBankAnswer = section.answer;
    record.answer = section.answer;
    record.answerSource = {
      type: "user-document",
      file: "toeic_part5.md",
      section: section.number,
      sha256: crypto.createHash("sha256").update(section.answer).digest("hex"),
    };
  }
  return updates.length;
}

if (require.main === module) {
  const source = process.argv[2];
  if (!source) throw new Error("Usage: node scripts/import-part5-answers.cjs <markdown-path>");
  const file = path.join(__dirname, "../toeic_review_data.js");
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context);
  const sections = parseAnswers(fs.readFileSync(source, "utf8"));
  const count = applyAnswers(context.window.TOEIC_REVIEW_DATA, sections);
  fs.writeFileSync(file, "window.TOEIC_REVIEW_DATA = " + JSON.stringify(context.window.TOEIC_REVIEW_DATA, null, 2) + ";\n");
  console.log("Updated " + count + " Part 5 answers from toeic_part5.md.");
}

module.exports = {parseAnswers, applyAnswers};
