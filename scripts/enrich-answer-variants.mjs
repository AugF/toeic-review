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

function part2FullScoreAnswer(record, bankAnswer) {
  const conclusion = record.part2Answer?.conclusion || '';
  return conclusion && !bankAnswer.includes(conclusion) ? `${bankAnswer} ${conclusion}` : bankAnswer;
}

function part3FullScoreAnswer(question, bankAnswer) {
  if (question.answerTime !== 30 || !question.answerSectionsEn?.length) return bankAnswer;
  return question.answerSectionsEn.join(' ');
}

function part5FullScoreAnswer(record, bankAnswer) {
  const sections = record.answerSectionsEn || [];
  if (sections.length < 4) return bankAnswer;

  const [opinion, reasonOne, reasonTwo, support, conclusion] = sections;
  if (record.answerPattern === '3R' && sections.length >= 5) {
    return [
      opinion,
      `First, ${sentenceWithoutLead(reasonOne, 'First,')}`,
      `Second, ${sentenceWithoutLead(reasonTwo, 'Second,')}`,
      `Also, ${sentenceWithoutLead(support, 'Third,')}`,
      conclusion,
    ].join(' ');
  }

  return [
    opinion,
    `First, ${sentenceWithoutLead(reasonOne, 'First,')}`,
    `Second, ${sentenceWithoutLead(reasonTwo, 'Second,')}`,
    `For example, ${sentenceWithoutLead(support, 'For example,')}`,
    conclusion,
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
      return bankAnswer;
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
