const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");
const api = require("../practice_sets.js");
const root = path.join(__dirname,"..");
const ctx = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,"toeic_review_data.js"),"utf8"),ctx);
const data = ctx.window.TOEIC_REVIEW_DATA;
const sets = api.completeSets(data.records);

test("fixed sets match the exam's 44 complete original papers",()=>{
  assert.equal(sets.length,44);
  for(const set of sets) {
    assert.ok(api.valid(set.records));
    assert.equal(api.questionCount(set.records),11);
    assert.ok(set.records.every(r=>r.sourceFile===set.source));
    assert.equal(set.records.map(r=>r.part).join(","),"1,1,2,2,3,4,5");
  }
  assert.ok(!sets.some(s=>s.source.includes("真题12")));
});
test("random papers preserve whole groups and exclude missing assets",()=>{
  let prev=[];
  for(let i=0;i<150;i++) {
    const set=api.randomSet(data.records,prev);
    assert.ok(api.valid(set.records));
    assert.equal(api.questionCount(set.records),11);
    assert.notEqual(api.signature(set.records),api.signature(prev));
    assert.ok(set.records.filter(r=>r.part===2).every(r=>r.imagePath));
    assert.ok(set.records.find(r=>r.part===4).material && !set.records.find(r=>r.part===4).material.missing);
    for(const r of set.records.filter(r=>[3,4].includes(r.part))) {
      assert.equal(r,data.records.find(source=>source.uid===r.uid));
      assert.equal(r.questions.length,3);
    }
    prev=set.records;
  }
});
test("insufficient pools and invalid saved records fail safely",()=>{
  assert.throws(()=>api.randomSet(data.records.filter(r=>r.part!==2)));
  assert.equal(api.valid([]),false);
  assert.equal(api.valid([undefined]),false);
  const r=[...sets[0].records];r[1]=r[0];
  assert.equal(api.valid(r),false);
});

function ui(saved) {
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  const elements=new Map(),storage=new Map(saved||[]);
  function el(id) {
    if(!elements.has(id))elements.set(id,{
      value:"",events:{},hidden:false,
      set innerHTML(value){this.html=value;const match=value.match(/<option value="([^"]+)"/);if(match)this.value=match[1];},
      addEventListener(name,fn){this.events[name]=fn;}
    });
    return elements.get(id);
  }
  const c=vm.createContext({
    window:{TOEIC_REVIEW_DATA:data,ToeicPracticeSets:api},$:el,searchInput:el("searchInput"),
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    stopAllActiveRecordings(){},stopSpeech(){},render(){},
  });
  vm.runInContext(html.slice(html.indexOf("    const data = window.TOEIC_REVIEW_DATA;"),html.indexOf("    const RECORDING_STORAGE_KEY"))+
    html.slice(html.indexOf("    function normalize(value)"),html.indexOf("    function hash(text)"))+
    html.slice(html.indexOf("    function escapeHtml(value)"),html.indexOf("    partList.addEventListener")),c);
  const run=s=>vm.runInContext(s,c);
  run("initializePracticeSets()");
  return {el,storage,run};
}
test("practice UI supports fixed selection, scoped filters, reshuffle and reload",()=>{
  const h=ui();
  h.run('switchPracticeSet("fixed")');
  assert.equal(h.run("currentRecords().length"),7);
  const fixed=h.run("practiceSet.source");
  assert.ok(h.run("currentRecords().every(r=>r.sourceFile===practiceSet.source)"));
  h.run("state.part=3");
  assert.equal(h.run("currentRecords().length"),1);
  h.run("state.done.add(currentRecords()[0].uid);state.studyFilter='done'");
  assert.equal(h.run("currentRecords().length"),1);
  h.run("state.studyFilter='undone'");
  assert.equal(h.run("currentRecords().length"),0);
  h.run('switchPracticeSet("random")');
  const signature=h.run("window.ToeicPracticeSets.signature(currentRecords())");
  const restored=ui(h.storage);
  assert.equal(restored.run("practiceMode"),"random");
  assert.equal(restored.run("window.ToeicPracticeSets.signature(currentRecords())"),signature);
  h.run('switchPracticeSet("random",true)');
  assert.notEqual(h.run("window.ToeicPracticeSets.signature(currentRecords())"),signature);
  h.run('switchPracticeSet("part")');
  assert.equal(h.run("currentRecords().length"),90);
  const restoredFixed=ui([["toeic-review-practice-set-v1",JSON.stringify({mode:"fixed",source:fixed})]]);
  assert.equal(restoredFixed.run("currentRecords().length"),7);
});
