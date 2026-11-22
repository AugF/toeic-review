const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const file = path.join(__dirname, "../toeic_review_data.js");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(file, "utf8"), context);
const data = context.window.TOEIC_REVIEW_DATA;
const before = data.records.length;
data.records = data.records.filter(record => !/^模拟题\d+\.json$/u.test(record.sourceFile));
for (const part of data.parts) {
  const records = data.records.filter(record => record.part === part.part);
  part.counts = {
    total: records.length,
    P1: records.filter(record => record.priority === "P1").length,
    P2: records.filter(record => record.priority === "P2").length,
    P3: records.filter(record => record.priority === "P3").length,
  };
}
fs.writeFileSync(file, "window.TOEIC_REVIEW_DATA = " + JSON.stringify(data, null, 2) + ";\n");
console.log(JSON.stringify({ removed: before - data.records.length, counts: data.parts.map(p => ({part:p.part,...p.counts})) }));
