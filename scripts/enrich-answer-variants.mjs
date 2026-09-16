import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const dataPath = path.join(repoRoot, 'toeic_review_data.js');
const bankRoot = process.env.QUESTION_BANK_ROOT
  || '/Users/augf/Documents/05-托业英语/toeic_prepare-main/question_banks';

function loadReviewData(filePath) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
  return context.window.TOEIC_REVIEW_DATA;
}

function questionKey(sourceFile, part, questionId) {
  return `${sourceFile}|${part}|${questionId}`;
}

function loadBankAnswers() {
  const answers = new Map();
  const bankFiles = fs.readdirSync(bankRoot).filter((file) => file.endsWith('.json'));

  for (const file of bankFiles) {
    const bank = JSON.parse(fs.readFileSync(path.join(bankRoot, file), 'utf8'));
    for (const part of bank.parts || []) {
      for (const question of part.questions || []) {
        answers.set(
          questionKey(file, part.part, question.id),
          question.reference_answer || question.question || ''
        );
      }
    }
  }

  return answers;
}

function sentenceWithoutLead(sentence, lead) {
  return sentence.replace(new RegExp(`^${lead}\\s*`, 'i'), '').trim();
}

function sentenceWithoutAnyLead(sentence) {
  return String(sentence || '').replace(/^(?:First|Second|Third|For example|So|Overall|In conclusion),\s*/i, '').trim();
}

function lowerInitial(sentence) {
  if (!sentence || /^I(?:\s|['’])/.test(sentence)) return sentence;
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

function part2FullScoreAnswer(record, bankAnswer) {
  const upgraded = bankAnswer
    .replace(/^This picture was taken in /i, 'The photograph appears to have been taken in ')
    .replace(/^This photo was taken in /i, 'The photograph appears to have been taken in ')
    .replace(/looks clean and well organized\./i, 'appears clean and well organized, creating a professional atmosphere.');
  return `${upgraded} Overall, the scene conveys a practical, well-organized atmosphere in which the people appear to be carrying out their responsibilities efficiently.`;
}

function part3FullScoreAnswer(question, bankAnswer) {
  if (question.answerTime !== 30 || !question.answerSectionsEn?.length) {
    return `To answer precisely, ${lowerInitial(bankAnswer)}`;
  }
  const sections = question.answerSectionsEn;
  const [opinion, reasonOne, reasonTwo, conclusion] = sections;
  if (question.answerPattern === '1R1E' && sections.length >= 4) {
    return [
      opinion,
      `This is mainly because ${lowerInitial(sentenceWithoutAnyLead(reasonOne))}`,
      `For instance, ${lowerInitial(sentenceWithoutAnyLead(reasonTwo))}`,
      `For these reasons, ${lowerInitial(sentenceWithoutAnyLead(conclusion))}`,
    ].join(' ');
  }
  return [
    opinion,
    `One important reason is that ${lowerInitial(sentenceWithoutAnyLead(reasonOne))}`,
    `Moreover, ${lowerInitial(sentenceWithoutAnyLead(reasonTwo))}`,
    `Consequently, ${lowerInitial(sentenceWithoutAnyLead(conclusion))}`,
  ].join(' ');
}

function part5FullScoreAnswer(record, bankAnswer) {
  const sections = record.answerSectionsEn || [];
  if (sections.length < 4) {
    return `${bankAnswer} In addition, this choice can have a lasting influence on the way people manage responsibilities and make everyday decisions.`;
  }

  const [opinion, reasonOne, reasonTwo, support, conclusion] = sections;
  if (record.answerPattern === '3R' && sections.length >= 5) {
    return [
      opinion,
      `One important reason is that ${lowerInitial(sentenceWithoutAnyLead(reasonOne))}`,
      `Furthermore, ${lowerInitial(sentenceWithoutAnyLead(reasonTwo))}`,
      `Another point worth considering is that ${lowerInitial(sentenceWithoutAnyLead(support))}`,
      `Therefore, ${lowerInitial(sentenceWithoutAnyLead(conclusion))}`,
    ].join(' ');
  }

  return [
    opinion,
    `One important reason is that ${lowerInitial(sentenceWithoutAnyLead(reasonOne))}`,
    `Furthermore, ${lowerInitial(sentenceWithoutAnyLead(reasonTwo))}`,
    `For instance, ${lowerInitial(sentenceWithoutAnyLead(support))}`,
    `Therefore, ${lowerInitial(sentenceWithoutAnyLead(conclusion))}`,
  ].join(' ');
}

function fullScoreAnswer(record, bankAnswer) {
  switch (record.part) {
    case 1:
      return bankAnswer;
    case 2:
      return part2FullScoreAnswer(record, bankAnswer);
    case 3:
      return part3FullScoreAnswer(record, bankAnswer);
    case 4:
      return `According to the information provided, ${lowerInitial(bankAnswer)}`;
    case 5:
      return part5FullScoreAnswer(record, bankAnswer);
    default:
      return bankAnswer;
  }
}

const reviewData = loadReviewData(dataPath);
const bankAnswers = loadBankAnswers();
let matched = 0;
const missing = [];

for (const record of reviewData.records) {
  const questions = record.questions || [record];
  for (const question of questions) {
    const key = questionKey(record.sourceFile, record.part, question.questionId);
    const bankAnswer = bankAnswers.get(key);
    if (!bankAnswer) {
      missing.push(key);
      continue;
    }

    if (record.part === 1) {
      delete question.questionBankAnswer;
      delete question.fullScoreAnswer;
      matched += 1;
      continue;
    }

    question.questionBankAnswer = bankAnswer;
    question.fullScoreAnswer = fullScoreAnswer({ ...record, ...question }, bankAnswer);
    matched += 1;
  }
}

if (missing.length) {
  throw new Error(`Could not match ${missing.length} question-bank answers:\n${missing.join('\n')}`);
}

fs.writeFileSync(dataPath, `window.TOEIC_REVIEW_DATA = ${JSON.stringify(reviewData, null, 2)};\n`);
console.log(`Added question-bank and full-score answer variants for ${matched} questions.`);
