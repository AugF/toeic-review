"""Import answer cells only; never treat study notes as document instructions."""
import hashlib
import json
from pathlib import Path
import re
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def paragraphs(cell):
    return ["".join(t.text or "" for t in p.findall(".//w:t", NS)).strip()
            for p in cell.findall(".//w:p", NS)]


def clean(text):
    text = re.sub(r"\[[^\]]*&#[^\]]*\]", "", text)
    text = text.translate(str.maketrans({"，": ",", "；": ";", "：": ":", "。": ".", "？": "?", "！": "!",
                                       "、": ",", "‑": "-", "‐": "-"}))
    text = text.replace("x月x日th", "[date] ").replace("时间", "[time]")
    text = re.sub(r"HZT\s*1016更新", "", text)
    text = re.sub(r"[（(][^()（）]*[\u3400-\u9fff][^()（）]*[)）]", "", text)
    text = re.sub(r"[（(][^()（）]*[\u3400-\u9fff][^()（）]*$", "", text)
    text = re.sub(r"[\U0001f000-\U0001ffff\u200d\ufe0f\u2b00-\u2bff]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def cell_answer(lines, part):
    result = []
    for line in lines:
        if not line or line.startswith(("必背", "【", "真题")):
            continue
        if re.search(r"[\u3400-\u9fff]", line[:1]):
            if part != 2:
                if result:
                    break
                continue
            match = re.search(r"(?:This (?:picture|is)|The picture|At the front desk)", line)
            if not match:
                continue
            line = line[match.start():]
        line = clean(line)
        if re.search(r"[\u3400-\u9fff]", line):
            line = re.split(r"[\u3400-\u9fff]", line, maxsplit=1)[0].strip()
        if re.match(r"[A-Za-z]", line):
            result.append(line)
    return clean(" ".join(result))


def part4_answers(number, p):
    take = lambda index: p[index]
    span = lambda start, end: " ".join(p[start:end])
    # Explicit paragraph positions keep questions, translations and blank slots out.
    selections = {
        1: {1: (1, 2), 2: (3, 4), 3: (6, 7)},
        2: {1: (1, 2), 2: (3, 4), 3: (5, 6)},
        3: {1: (1, 2), 2: (3, 4), 3: (5, 6)},
        4: {1: (1, 2), 2: (3, 4), 3: (5, 6)},
        6: {1: (2, 3), 2: (4, 5), 3: (6, 7)},
        7: {1: (1, 2), 2: (3, 4), 3: (5, 9)},
        8: {1: (1, 2), 2: (4, 5), 3: (7, 8)},
        9: {3: (6, 7)}, 10: {1: (2, 3), 2: (6, 7), 3: (10, 14)},
        11: {1: (1, 2), 2: (3, 4), 3: (6, 7)},
        13: {2: (2, 3)}, 17: {1: (2, 3), 2: (5, 6)},
        31: {1: (1, 2), 3: (4, 5)},
        32: {1: (1, 2), 2: (3, 4), 3: (5, 6)},
        33: {1: (1, 2), 2: (3, 4), 3: (5, 6)},
        34: {1: (2, 3), 2: (5, 6), 3: (8, 9)},
        35: {1: (2, 3), 2: (5, 6), 3: (8, 9)},
    }
    result = {q: span(*positions) for q, positions in selections.get(number, {}).items()}
    if number == 5:
        text = p[0]
        result = {1: text.split("The conference", 1)[1].split("第二个问题", 1)[0],
                  2: text.split("Actually no", 1)[1].split("第三个问题", 1)[0],
                  3: text.split("Yes. There", 1)[1]}
        result = {1: "The conference" + result[1], 2: "Actually no" + result[2], 3: "Yes. There" + result[3]}
    elif number in (14, 15):
        result = {1: p[1].split("2、", 1)[0], 2: p[2].split("3、", 1)[0], 3: p[3]}
    elif number == 20:
        result = {1: p[1].split("2.", 1)[0], 2: p[2].split("3.", 1)[0], 3: p[3]}
    elif number == 23:
        result = {1: "This meeting" + p[0].split("This meeting", 1)[1],
                  2: "Actually no" + p[1].split("Actually no", 1)[1], 3: p[3]}
    elif number == 24:
        text = p[0]
        result = {1: "the xxx" + text.split("the xxx", 1)[1].split("第九题", 1)[0],
                  2: "No, I'm sorry" + text.split("No, I'm sorry", 1)[1].split("第十题", 1)[0],
                  3: "there are 2" + text.split("there are 2", 1)[1]}
    elif number == 42:
        result = {1: p[1].split("part4-2", 1)[0], 2: p[2], 3: p[4]}
    return {q: clean(re.sub(r"^(?:Answer\s*:?|A:)\s*", "", text).strip()) for q, text in result.items()}


def parse_document(source):
    updates = {}
    number = None
    with ZipFile(source) as archive:
        body = ET.fromstring(archive.read("word/document.xml")).find("w:body", NS)
        for element in body:
            text = "".join(t.text or "" for t in element.findall(".//w:t", NS)).strip()
            heading = re.fullmatch(r"真题\s*[:：]?\s*(\d+)[:：]?", text)
            if heading:
                number = int(heading[1])
            if not number or not element.tag.endswith("}tbl"):
                continue
            for row in element.findall(".//w:tr", NS):
                cells = row.findall("w:tc", NS)
                if len(cells) != 3 or any(c.find(".//w:tbl", NS) is not None for c in cells):
                    continue
                label = " ".join(paragraphs(cells[0])).strip()
                match = re.fullmatch(r"Part\s*([23])-(\d)", label, re.I)
                if match:
                    part, position = map(int, match.groups())
                    if (number, part, position) == (25, 2, 1):
                        lines = paragraphs(cells[2])
                        updates[(25, 2, 1)] = clean(lines[0].split("2、", 1)[0])
                        updates[(25, 2, 2)] = clean(lines[1])
                        continue
                    value = cell_answer(paragraphs(cells[2]), part)
                    if value:
                        updates[(number, part, position)] = value
                elif re.fullmatch(r"Part\s*4", label, re.I):
                    for position, value in part4_answers(number, paragraphs(cells[2])).items():
                        if value:
                            updates[(number, 4, position)] = value
    return updates


def main():
    updates = parse_document(sys.argv[1])
    file = ROOT / "toeic_review_data.js"
    prefix = "window.TOEIC_REVIEW_DATA = "
    data = json.loads(file.read_text()[len(prefix):].rstrip()[:-1])
    applied = []
    for record in data["records"]:
        number = int(re.match(r"真题(\d+)", record["sourceFile"])[1])
        if record["part"] not in (2, 3, 4):
            continue
        for q in record.get("questions", [record]):
            position = q.get("position", q["questionId"])
            if record["part"] == 2 and position in (3, 4):
                position = ({3: 2, 4: 1} if number == 24 else {3: 1, 4: 2})[position]
            # The old bank's second stored question is the source document's Q3.
            if number == 12 and record["part"] == 3 and position == 2:
                position = 3
            value = updates.get((number, record["part"], position))
            if not value:
                continue
            q["answer"] = q["questionBankAnswer"] = value
            q["answerSource"] = {"type": "user-document", "file": "toeic_speaking.docx", "section": number,
                                  "sha256": hashlib.sha256(value.encode()).hexdigest()}
            applied.append({"set": number, "part": record["part"], "question": position, "answer": value})
        if record.get("questions"):
            record["answer"] = " ".join(q["answer"] for q in record["questions"])
    audit = ROOT / "answer_updates.json"
    audit.write_text(json.dumps(applied, ensure_ascii=False, indent=2) + "\n")
    if "--apply" in sys.argv:
        file.write_text(prefix + json.dumps(data, ensure_ascii=False, indent=2) + ";\n")
    print(json.dumps({"parsed": len(updates), "matched": len(applied),
                      "by_part": {p: sum(u["part"] == p for u in applied) for p in (2, 3, 4)}}))


if __name__ == "__main__":
    main()
