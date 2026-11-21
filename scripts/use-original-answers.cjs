const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const file = path.join(__dirname, "../toeic_review_data.js");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(file, "utf8"), context);
const data = context.window.TOEIC_REVIEW_DATA;
const alternativeFields = [
  "fullScoreAnswer", "part2Answer", "answerZh", "answerPattern",
  "answerSectionsEn", "answerSectionsZh",
];
function normalize(record) {
  if (!record.questionBankAnswer) throw new Error("Missing original answer: " + record.uid);
  record.answer = record.questionBankAnswer;
  alternativeFields.forEach(field => delete record[field]);
}
for (const record of data.records) {
  if (record.part === 1) continue;
  if (record.questions?.length) {
    record.questions.forEach(normalize);
    record.answer = record.questions.map(q => q.questionBankAnswer).join(" ");
    alternativeFields.forEach(field => delete record[field]);
  } else {
    normalize(record);
  }
}
fs.writeFileSync(file, "window.TOEIC_REVIEW_DATA = " + JSON.stringify(data, null, 2) + ";\n");
console.log("Part 2–5 now contain original answers only; Part 1 is unchanged.");
