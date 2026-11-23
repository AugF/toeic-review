const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const c={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'toeic_review_data.js'),'utf8'),c);
const records=c.window.TOEIC_REVIEW_DATA.records;
const updates=JSON.parse(fs.readFileSync(path.join(root,'answer_updates.json'),'utf8'));

test('266 speaking-document answers each replace one canonical answer',()=>{
  assert.equal(updates.length,266);
  const questions=records.flatMap(r=>r.questions||[r]);
  const changed=questions.filter(q=>q.answerSource?.file==='toeic_speaking.docx');
  assert.equal(changed.length,266);
  assert.equal(new Set(changed.map(q=>q.uid)).size,266);
  for(const q of changed){
    assert.equal(q.answer,q.questionBankAnswer);
    assert.equal(q.answerSource.sha256,crypto.createHash('sha256').update(q.answer).digest('hex'));
    assert.ok(!/[\u3400-\u9fff]/u.test(q.answer));
    assert.ok(updates.some(u=>u.answer===q.answer&&u.set===q.answerSource.section));
  }
});

test('picture ordering and the incomplete source question group are matched explicitly',()=>{
  const pictures=records.filter(r=>r.part===2&&r.sourceFile.startsWith('真题24'));
  assert.match(pictures.find(r=>r.questionId===3).answer,/supermarket/);
  assert.match(pictures.find(r=>r.questionId===4).answer,/jewelry store/);
  const phone=records.find(r=>r.part===3&&r.sourceFile.startsWith('真题12'));
  assert.equal(phone.questions.length,2);
  assert.match(phone.questions[1].answer,/If a new model comes out/);
  assert.ok(records.filter(r=>[1,5].includes(r.part)).every(r=>r.answerSource?.file!=='toeic_speaking.docx'));
});
