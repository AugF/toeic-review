const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");
const api = require("../practice_sets.js");
const root = path.join(__dirname,"..");
const c={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,"toeic_review_data.js"),"utf8"),c);
const data=c.window.TOEIC_REVIEW_DATA;
const source=fs.readFileSync(path.join(root,"exam_mode.js"),"utf8");
function harness(pack) {
  const storage=new Map(),elements=new Map();
  const el=id=>{
    if(!elements.has(id))elements.set(id,{
      value:"",style:{},hidden:false,textContent:"",classList:{toggle(){}},checked:false,
      set innerHTML(html){this.html=html;this.options=[...html.matchAll(/<option value="([^"]+)"/g)].map(m=>({value:m[1]}));this.value=this.options[0]?.value||"";},
      setAttribute(){},addEventListener(){},
    });
    return elements.get(id);
  };
  const ctx=vm.createContext({
    document:{getElementById:el,querySelector:()=>({value:"fixed"})},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    window:{TOEIC_REVIEW_DATA:data,ToeicPracticeSets:api,
      toeicReviewPractice:{getExamSet:()=>api.toExamSet(pack),prepareForExam:async()=>{}}
    },
  });
  const exports='window.testing={createSteps,createExam,loadSavedExam,openPracticeExam,chooseSet,inspect:()=>({exam,pendingPracticeSet,choosingPracticeSet}),setExam:value=>{exam=value;}};';
  vm.runInContext(source.replace("  initialize();",exports),ctx);
  return {api:ctx.window.testing,el,storage};
}

test("fixed and mixed papers transfer all 11 questions in the original order",async()=>{
  const fixed=api.completeSets(data.records);
  const packs=[...fixed,api.randomSet(data.records)];
  for(const pack of packs) {
    const h=harness(pack);
    await h.api.openPracticeExam();
    const set=h.api.chooseSet("practice-current");
    const steps=h.api.createSteps(set);
    const expected=pack.records.flatMap(r=>r.questions?.length?r.questions:[r]).map(q=>q.uid);
    assert.equal(steps.length,11);
    assert.equal(JSON.stringify(steps.map(s=>s.uid)),JSON.stringify(expected));
    assert.equal(h.el("examSetSelect").value,"practice-current");
    assert.match(h.el("examSetNote").textContent,/原题原顺序/);
    assert.equal(h.api.inspect().choosingPracticeSet,true);
  }
});

test("mixed exam snapshots restore without falling back to a random original set",()=>{
  const pack=api.randomSet(data.records);
  const h=harness(pack);
  const exam=h.api.createExam(api.toExamSet(pack));
  const saved={...exam,status:"paused",index:5,answers:{[exam.steps[0].uid]:{score:2}}};
  h.storage.set("toeic-review-mock-exam-v1",JSON.stringify(saved));
  const restored=h.api.loadSavedExam();
  assert.equal(JSON.stringify(restored.steps.map(s=>s.uid)),JSON.stringify(exam.steps.map(s=>s.uid)));
  assert.equal(restored.index,5);
  assert.equal(JSON.stringify(restored.answers),JSON.stringify(saved.answers));
  const invalid={...saved,recordIds:["missing"]};
  h.storage.set("toeic-review-mock-exam-v1",JSON.stringify(invalid));
  assert.equal(h.api.loadSavedExam(),null);
});

test("opening a different practice paper does not erase an unfinished exam",async()=>{
  const sets=api.completeSets(data.records);
  const h=harness(sets[0]);
  const existing=h.api.createExam(api.toExamSet(sets[1]));
  existing.index=2;
  existing.status="paused";
  h.api.setExam(existing);
  await h.api.openPracticeExam();
  assert.equal(h.api.inspect().exam,existing);
  assert.equal(h.api.inspect().exam.index,2);
  assert.equal(h.api.inspect().choosingPracticeSet,true);
});

test("Part 2–5 render only the original bank answer and its playback",()=>{
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  const ctx=vm.createContext({
    escapeHtml:s=>String(s),escapeAttr:s=>String(s),
    splitAnswerSentences:s=>[s],
    renderCompactSpeechControl:(_,field)=>'<button data-speak-variant="'+field+'">播放答案</button>',
  });
  vm.runInContext(html.slice(html.indexOf("    function renderAnswerLines"),html.indexOf("    function speechStatusKey")),ctx);
  for(const record of data.records.filter(r=>r.part!==1).flatMap(r=>r.questions?.length?r.questions:[r])) {
    ctx.record=record;
    const out=vm.runInContext("renderAnswerSet(record)",ctx);
    assert.ok(!out.includes("满分目标示范"));
    assert.ok(!out.includes("快速复述版"));
    if(record.questionBankAnswer) {
      assert.ok(out.includes(record.questionBankAnswer));
      assert.ok(out.includes('data-speak-variant="questionBankAnswer"'));
    } else assert.ok(out.includes("题库未提供原答案"));
  }
});
