(function (root) {
  "use strict";
  const parts = [1, 1, 2, 2, 3, 4, 5];
  function valid(records) {
    return Array.isArray(records) && records.length === 7 &&
      new Set(records.map(r => r?.uid)).size === 7 &&
      records.every((r, i) => r && r.part === parts[i] &&
        (![3, 4].includes(r.part) || r.questions?.length === 3));
  }
  function completeSets(records) {
    const sources = new Map();
    records.forEach(r => {
      if (!sources.has(r.sourceFile)) sources.set(r.sourceFile, []);
      sources.get(r.sourceFile).push(r);
    });
    return [...sources].map(([source, rows]) => {
      const pick = p => rows.filter(r => r.part === p).sort((a,b) => Number(a.questionId)-Number(b.questionId));
      const selected = [...pick(1).slice(0,2), ...pick(2).slice(0,2), ...pick(3).slice(0,1), ...pick(4).slice(0,1), ...pick(5).slice(0,1)];
      return valid(selected) ? {source, name:selected[0].bankName || source.replace(/\.json$/i,""), records:selected} : null;
    }).filter(Boolean).sort((a,b) => a.name.localeCompare(b.name,"zh-CN",{numeric:true}));
  }
  function randomIndex(length) {
    if (root.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      const cutoff = Math.floor(4294967296 / length) * length;
      do { root.crypto.getRandomValues(values); } while (values[0] >= cutoff);
      return values[0] % length;
    }
    return Math.floor(Math.random()*length);
  }
  function signature(records) { return records.map(r=>r.uid).join("|"); }
  function randomSet(records, previous = [], index = randomIndex) {
    const pool = p => records.filter(r => r.part === p &&
      (p !== 2 || r.imagePath) &&
      (![3,4].includes(p) || r.questions?.length === 3) &&
      (p !== 4 || (r.material && !r.material.missing)));
    function sample(p, count) {
      const candidates = pool(p);
      if(candidates.length < count) throw new Error("Part " + p + " 完整题目不足，无法组卷。");
      const selected = [];
      while(selected.length < count) selected.push(candidates.splice(index(candidates.length),1)[0]);
      return selected;
    }
    let selected;
    for(let attempt=0;attempt<8;attempt++) {
      selected = [...sample(1,2),...sample(2,2),...sample(3,1),...sample(4,1),...sample(5,1)];
      if(signature(selected)!==signature(previous)) break;
    }
    return {source:"random",name:"随机组合套题",records:selected};
  }
  function questionCount(records) { return records.reduce((sum,r)=>sum+(r.questions?.length||1),0); }
  function toExamSet(pack) {
    if (!pack || !valid(pack.records)) return null;
    const r = pack.records;
    return {
      sourceFile: pack.source === "random" ? "mixed:" + signature(r) : pack.source,
      name: pack.name,
      part1: r.slice(0,2), part2: r.slice(2,4), part3:r[4], part4:r[5], part5:r[6],
    };
  }
  function restoreExamSet(saved, records) {
    if (!Array.isArray(saved?.recordIds)) return null;
    const lookup = new Map(records.map(r=>[r.uid,r]));
    return toExamSet({source:saved.sourceFile, name:saved.setName, records:saved.recordIds.map(id=>lookup.get(id))});
  }
  const api = {completeSets, randomSet, valid, signature, questionCount, toExamSet, restoreExamSet};
  if(typeof module === "object" && module.exports) module.exports = api;
  else root.ToeicPracticeSets = api;
})(typeof window === "undefined" ? globalThis : window);
