const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const {test} = require("node:test");
const practice = require("../practice_sets.js");
const root = path.join(__dirname, "..");
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root, "toeic_review_data.js"), "utf8"), context);
const data = context.window.TOEIC_REVIEW_DATA;
const banks = fs.readdirSync(path.join(root, "question_banks"))
  .filter(name=>/^真题4[3-5].*\.json$/u.test(name))
  .map(name=>({name, bank:JSON.parse(fs.readFileSync(path.join(root,"question_banks",name),"utf8"))}));

test("banks 43-45 preserve all 33 source questions and answers in complete papers",()=>{
  assert.equal(banks.length,3);
  let count=0;
  for(const {name,bank} of banks) {
    assert.equal(bank.total_questions,11);
    const records=data.records.filter(r=>r.sourceFile===name);
    assert.equal(records.length,7);
    assert.equal(practice.questionCount(records),11);
    const pack=practice.completeSets(records)[0];
    assert.ok(practice.valid(pack.records));
    for(const part of bank.parts) {
      const published=records.filter(r=>r.part===part.part).flatMap(r=>r.questions||[r]);
      for(const [index,q] of part.questions.entries()) {
        const r=published[index];
        assert.equal(r.prompt,q.image_description||q.question);
        assert.equal(r.answer,q.reference_answer);
        if(part.part!==1) {
          assert.equal(r.questionBankAnswer,q.reference_answer);
          assert.equal(r.answerSource.file,"43_45.docx");
          assert.equal(r.answerSource.sha256,crypto.createHash("sha256").update(r.answer).digest("hex"));
        }
        assert.equal(r.preparationTime,part.part===3||part.part===4?3:45);
        assert.equal(r.answerTime,part.part===1?45:part.part===2?30:part.part===5?60:[15,15,30][index]);
        count++;
      }
    }
  }
  assert.equal(count,33);
});

test("new photos and source tables are present and each source table has its heading",()=>{
  for(const {name,bank} of banks) {
    const records=data.records.filter(r=>r.sourceFile===name);
    for(const photo of records.filter(r=>r.part===2)) {
      const bytes=fs.readFileSync(path.join(root,photo.imagePath));
      assert.equal(bytes.subarray(8,12).toString(),"WEBP");
      assert.ok(bytes.length<200000);
    }
    const material=records.find(r=>r.part===4).material;
    assert.ok(material.title);
    assert.equal(material.missing,false);
    assert.equal(material.rows.length,bank.number===43?5:4);
    assert.ok(fs.existsSync(path.join(root,material.sourceImage)));
    assert.ok(material.rows.every(row=>row.cells.length===material.headers.length));
  }
  const revised=data.records.find(r=>r.part===4&&r.sourceFile.startsWith("真题45")).material;
  assert.equal(revised.rows[1].cells[0],"Apr 5");
  assert.equal(revised.rows[1].cells[4],"Rescheduled from Apr 2");
});

test("practice and exam tables show the title carrying the venue information",()=>{
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  const exam=fs.readFileSync(path.join(root,"exam_mode.js"),"utf8");
  const ctx=vm.createContext({escapeHtml:s=>String(s),escapeAttr:s=>String(s),record:null});
  vm.runInContext(html.slice(html.indexOf("    function renderMaterial(record)"),html.indexOf("    function isAnswerVisible(uid)")),ctx);
  vm.runInContext(exam.slice(exam.indexOf("  function buildMaterial(material)"),exam.indexOf("  function questionHtml(step)")),ctx);
  for(const {name} of banks) {
    ctx.record=data.records.find(r=>r.part===4&&r.sourceFile===name);
    const practiceHtml=vm.runInContext("renderMaterial(record)",ctx);
    const examHtml=vm.runInContext("buildMaterial(record.material)",ctx);
    assert.ok(practiceHtml.includes(ctx.record.material.title));
    assert.ok(examHtml.includes(ctx.record.material.title));
    assert.ok(practiceHtml.includes('<details class="material" open>'));
  }
});

test("new papers participate in random practice without splitting the grouped questions",()=>{
  const records=data.records.filter(r=>/^真题4[3-5]/u.test(r.sourceFile));
  for(let index=0;index<20;index++) {
    const pack=practice.randomSet(records);
    assert.ok(practice.valid(pack.records));
    assert.equal(practice.questionCount(pack.records),11);
    assert.ok(pack.records.filter(r=>[3,4].includes(r.part)).every(r=>records.includes(r)&&r.questions.length===3));
    assert.ok(practice.toExamSet(pack));
  }
});
