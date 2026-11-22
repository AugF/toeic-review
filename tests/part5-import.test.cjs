const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const {parseAnswers,applyAnswers} = require("../scripts/import-part5-answers.cjs");

test("imports numbered English answers without Chinese preparation notes",()=>{
  const sections=parseAnswers("## 1 能力选择\r\n理由：中文笔记\r\n3）备考说明\r\nIn my opinion, communication helps.\r\nFirst, I listen.\r\n\r\n## 2 新工作\r\nI prefer teamwork.\r\n");
  assert.equal(sections.size,2);
  assert.equal(sections.get(1).answer,"In my opinion, communication helps.\nFirst, I listen.");
  assert.equal(sections.get(2).answer,"I prefer teamwork.");
  const data={records:[
    {uid:"one",part:5,sourceFile:"真题01能力选择.json",prompt:"Which skill?",answer:"old"},
    {uid:"two",part:5,sourceFile:"真题02新工作.json",prompt:"New job?",answer:"old"},
    {uid:"other",part:1,answer:"unchanged"},
  ]};
  assert.equal(applyAnswers(data,sections),2);
  assert.equal(data.records[0].answer,sections.get(1).answer);
  assert.equal(data.records[0].questionBankAnswer,sections.get(1).answer);
  assert.equal(data.records[0].prompt,"Which skill?");
  assert.equal(data.records[2].answer,"unchanged");
});

test("invalid document sections cannot produce a partial import",()=>{
  assert.throws(()=>parseAnswers("## 1 A\nHello.\n## 1 B\nHi."),/Duplicate/);
  assert.throws(()=>parseAnswers("## 1 A\n理由：只有中文"),/Missing English/);
  const data={records:[{part:5,uid:"one",sourceFile:"真题01.json",answer:"old"},{part:5,uid:"two",sourceFile:"真题02.json",answer:"old"}]};
  assert.throws(()=>applyAnswers(data,parseAnswers("## 1 A\nHello.")),/Unmatched/);
  assert.equal(data.records[0].answer,"old");
});

test("all 42 live Part 5 answers use the imported version and have valid content hashes",()=>{
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../toeic_review_data.js"),"utf8"),context);
  const records=context.window.TOEIC_REVIEW_DATA.records.filter(r=>r.part===5);
  assert.equal(records.length,42);
  for(const r of records) {
    assert.equal(r.answer,r.questionBankAnswer);
    assert.equal(r.answerSource.type,"user-document");
    assert.equal(r.answerSource.file,"toeic_part5.md");
    assert.equal(r.answerSource.section,Number(r.sourceFile.match(/^真题0*(\d+)/u)[1]));
    assert.equal(r.answerSource.sha256,crypto.createHash("sha256").update(r.answer).digest("hex"));
    assert.ok(!/[\u3400-\u9fff]/u.test(r.answer));
  }
});
