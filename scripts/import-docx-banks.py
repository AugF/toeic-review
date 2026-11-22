"""Import the supplied 43_45.docx into source banks and the review payload."""

import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
PART_NAMES = {1: "朗读短文", 2: "描述图片", 3: "回答问题", 4: "信息回答", 5: "表达观点"}
INSTRUCTIONS = {1: "请朗读以下短文：", 2: "请描述以下图片：", 3: "请回答以下问题：",
                4: "请根据提供的信息回答问题：", 5: "请针对以下情况表达一个观点："}
# Transcribed from the three embedded source tables, not inferred from answers.
MATERIALS = {
    43: {
        "title": "Riverside Community Center - Monthly Meeting Schedule",
        "headers": ["Date/Time", "Activity", "Location", "Notes"],
        "rows": [
            ["Monday 9:30-10:30", "Opening Remarks & Budget Review", "Main Hall", "Free admission"],
            ["Monday 10:30-11:30", "Children's Summer Reading Program", "Room 2", "Ages 6-12"],
            ["Saturday 9:00-10:00", "Kids' Art Workshop", "Room 3", "Art supplies provided"],
            ["Monday 1:00-2:00", "Teen Coding Club", "Lab 2", "Ages 13-17"],
            ["Monday 2:30-3:30", "Senior Wellness Workshop", "Room 1", "Doctor on site"],
        ],
    },
    44: {
        "title": "City Music Hall - Concert Season Schedule",
        "headers": ["Date / Time", "Concert", "Hall", "Notes"],
        "rows": [
            ["Friday 7:00-8:30 PM", "Spring Chamber Music Evening", "Hall A", "Ticket: 50 yuan"],
            ["Saturday 2:00-4:00 PM", "Youth Symphony Orchestra Show", "Hall B", "Ticket: 30 yuan"],
            ["Saturday 7:30-9:30 PM", "Piano & Violin Recital", "Hall A", "Ticket: 70 yuan"],
            ["Sunday 3:00-4:30 PM", "Folk Music Appreciation Evening", "Hall C", "Ticket: 40 yuan"],
        ],
    },
    45: {
        "title": "Manager's Weekly Meeting Schedule - April",
        "headers": ["Date", "Time", "Agenda Item", "Location", "Notes"],
        "rows": [
            ["Apr 1", "9:00-10:00", "Team Performance Review", "Meeting Room A", "Q1 goals summary"],
            ["Apr 5", "11:00-12:00", "Client Proposal Discussion", "Conference Room 2", "Rescheduled from Apr 2"],
            ["Apr 3", "2:00-4:00 PM", "Training: Leadership Development", "Training Room 1", "Lunch provided"],
            ["Apr 7", "3:00-5:00 PM", "Training: New Software Onboarding", "Training Room 2", "Bring your laptop"],
        ],
    },
}
TOPICS = {
    43: {1: ["超市营业时间公告", "寒冷天气交通通知"], 2: ["咖啡馆交谈", "眼镜店服务"],
         3: ["电视观看习惯", "观看地点", "电视服务选择"], 4: ["会议地点和时间", "周六活动确认", "儿童活动汇总"],
         5: ["同事性格与团队合作"]},
    44: {1: ["欢迎新项目经理", "员工野餐通知"], 2: ["面包店排队结账", "会议演讲场景"],
         3: ["公交使用习惯", "公交选择因素", "公交服务趋势"], 4: ["音乐会地点", "票价纠错", "音乐会汇总"],
         5: ["过去与现在的阅读习惯"]},
    45: {1: ["社区诊所健康计划", "图书馆闭馆维护通知"], 2: ["办公室协作", "火车站街景"],
         3: ["个人爱好", "爱好时间安排", "新爱好选择"], 4: ["首个议程", "议程改期确认", "培训场次汇总"],
         5: ["异地任职与职业发展"]},
}
PRIORITIES = {43: {1: ["P1", "P1"], 2: ["P2", "P1"], 3: "P2", 4: "P1", 5: "P1"},
              44: {1: ["P1", "P1"], 2: ["P1", "P1"], 3: "P1", 4: "P2", 5: "P2"},
              45: {1: ["P1", "P1"], 2: ["P1", "P2"], 3: "P3", 4: "P1", 5: "P1"}}
REASONS = {
    1: "公告、欢迎词和公共服务通知，重点练习时间、地点及意群重音。",
    2: "人物动作、位置和场景细节的完整描述；商业和职场场景优先，休闲场景用于补充覆盖。",
    3: "按完整三问评价：兼顾经历、习惯和理由扩展；通勤场景复用度高，娱乐和爱好主题用于补充。",
    4: "按完整三问评价：练习资料定位、确认或纠错、多项信息汇总；会议和改期信息优先。",
    5: "围绕明确观点、理由和例子组织回答；团队合作及职业发展优先，阅读习惯用于扩展话题。",
}


def read_sections(archive):
    document = ET.fromstring(archive.read("word/document.xml"))
    relationships = {r.attrib["Id"]: r.attrib["Target"] for r in
                     ET.fromstring(archive.read("word/_rels/document.xml.rels"))}
    sections = {}
    current = None
    part = None
    for paragraph in document.find("w:body", NS):
        if paragraph.tag != f"{{{NS['w']}}}p":
            continue
        text = "".join(t.text or "" for t in paragraph.findall(".//w:t", NS)).strip()
        heading = re.fullmatch(r"真题(\d+)（(.+)）", text)
        if heading:
            number = int(heading[1])
            if number in sections:
                raise ValueError("Duplicate bank " + str(number))
            current = {"number": number, "title": heading[2], "parts": {p: [] for p in range(1, 6)}}
            sections[number] = current
            part = None
            continue
        marker = re.match(r"part\s*([1-5])(?:\s|（|\()", text, re.I)
        if marker:
            part = int(marker[1])
            continue
        if current and part:
            if text and text != "朗读题目":
                current["parts"][part].append({"text": text})
            for blip in paragraph.findall(".//a:blip", NS):
                rid = blip.get(f"{{{NS['r']}}}embed")
                current["parts"][part].append({"image": "word/" + relationships[rid]})
    if set(sections) != {43, 44, 45}:
        raise ValueError("Expected complete banks 43, 44 and 45")
    return sections


def clean_number(text):
    return re.sub(r"^\d+\s*、\s*", "", text)


def question(number, part, index, prompt, reference):
    return {
        "id": index + 1, "question": prompt, "reference_answer": reference,
        "preparation_time": 3 if part in (3, 4) else 45,
        "answer_time": (45 if part == 1 else 30 if part == 2 else 60 if part == 5 else [15, 15, 30][index]),
        "topic": TOPICS[number][part][index], "difficulty": "easy" if part == 1 else "medium" if part in (2, 3) else "hard",
        "keywords": " ".join(re.findall(r"[A-Za-z]+", prompt)[:12]).lower(),
    }


def parse_bank(section):
    number = section["number"]
    parts = []
    for part in range(1, 6):
        entries = section["parts"][part]
        texts = [entry["text"] for entry in entries if "text" in entry]
        questions = []
        if part == 1:
            assert len(texts) == 2
            for index, text in enumerate(texts):
                text = clean_number(text)
                questions.append(question(number, part, index, text, text))
        elif part == 2:
            assert len(entries) == 6
            for index in range(2):
                image, prompt, reference = entries[index * 3:index * 3 + 3]
                q = question(number, part, index, "Describe the photo in detail.", reference["text"])
                q.update(image_description=prompt["text"], picture_path=f"images/web/真题{number}-{index + 1}.webp",
                         docx_image=image["image"])
                questions.append(q)
        else:
            assert len(texts) == (2 if part == 5 else 6)
            for index in range(len(texts) // 2):
                prompt = clean_number(texts[index * 2])
                if part == 4:
                    prompt = re.sub(r"^part4-\d\s*", "", prompt, flags=re.I)
                questions.append(question(number, part, index, prompt, texts[index * 2 + 1]))
        entry = {"part": part, "part_name": PART_NAMES[part], "instructions": INSTRUCTIONS[part], "questions": questions}
        if part == 4:
            images = [e["image"] for e in entries if "image" in e]
            assert len(images) == 1
            info = MATERIALS[number]
            entry.update(review_time=45, docx_image=images[0], material={
                "title": info["title"], "headers": info["headers"],
                "rows": [{"cells": cells, "status": "changed" if number == 45 and index == 1 else ""}
                         for index, cells in enumerate(info["rows"])],
                "notes": [], "missing": False, "sourceImage": f"./images/materials/真题{number}.png",
            })
        parts.append(entry)
    return {"name": f"真题{number} {section['title']}", "number": number,
            "source_document": "43_45.docx", "total_questions": 11, "parts": parts}


def source_for(bank):
    return f"真题{bank['number']}{bank['name'].split(' ', 1)[1]}.json"


def records_for(bank):
    number, source = bank["number"], source_for(bank)
    result = []
    for part in bank["parts"]:
        p = part["part"]
        group_uid = f"{p}-{source}-group"
        questions = []
        for index, q in enumerate(part["questions"]):
            text = q.get("image_description", q["question"])
            uid = f"{p}-{source}-{q['id']}" if p not in (3, 4) else group_uid + f"-q{q['id']}"
            reference = q["reference_answer"]
            record = {
                "uid": uid, "questionId": q["id"], "topic": q["topic"], "prompt": text, "answer": reference,
                "preparationTime": q["preparation_time"], "answerTime": q["answer_time"],
                "difficulty": q["difficulty"], "keywords": q["keywords"],
            }
            if p in (3, 4):
                record["position"] = index + 1
            else:
                record.update(part=p, partName=f"Part {p} {PART_NAMES[p]}", sourceFile=source,
                              bankName=bank["name"], instructions=part["instructions"],
                              priority=PRIORITIES[number][p][index] if p in (1, 2) else PRIORITIES[number][p],
                              reason=REASONS[p], imagePath="./" + q["picture_path"] if p == 2 else "")
            if p != 1:
                record["questionBankAnswer"] = reference
                record["answerSource"] = {"type": "user-document", "file": "43_45.docx", "section": number,
                                          "sha256": hashlib.sha256(reference.encode()).hexdigest()}
            questions.append(record)
        if p in (3, 4):
            group = {
                "uid": group_uid, "part": p, "partName": f"Part {p} {PART_NAMES[p]}",
                "priority": PRIORITIES[number][p], "sourceFile": source, "bankName": bank["name"],
                "questionId": "1/2/3", "topic": " · ".join(q["topic"] for q in questions),
                "prompt": "\n".join(q["prompt"] for q in questions),
                "answer": " ".join(q["answer"] for q in questions), "reason": REASONS[p],
                "instructions": part["instructions"], "imagePath": "", "preparationTime": "", "answerTime": "",
                "difficulty": "medium" if p == 3 else "hard", "keywords": " ".join(q["keywords"] for q in questions),
                "questions": questions,
            }
            if p == 4:
                group.update(reviewTime=part["review_time"], material=part["material"])
            result.append(group)
        else:
            result.extend(questions)
    assert len(result) == 7
    return result


def export_images(archive, bank):
    for part in bank["parts"]:
        if part["part"] == 2:
            for q in part["questions"]:
                path = ROOT / q["picture_path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                with Image.open(BytesIO(archive.read(q["docx_image"]))) as raw:
                    image = raw.convert("RGB")
                    image.thumbnail((960, 960), Image.Resampling.LANCZOS)
                    image.save(path, format="WEBP", quality=86, method=6)
        elif part["part"] == 4:
            path = ROOT / part["material"]["sourceImage"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.read(part["docx_image"]))


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: import-docx-banks.py <43_45.docx>")
    data_path = ROOT / "toeic_review_data.js"
    raw = data_path.read_text()
    prefix = "window.TOEIC_REVIEW_DATA = "
    assert raw.startswith(prefix) and raw.rstrip().endswith(";")
    data = json.loads(raw[len(prefix):].rstrip()[:-1])
    with ZipFile(sys.argv[1]) as archive:
        sections = read_sections(archive)
        banks = [parse_bank(s) for _, s in sorted(sections.items())]
        additions = [record for bank in banks for record in records_for(bank)]
        assert len(additions) == 21
        replaced_sources = {record["sourceFile"] for record in additions}
        data["records"] = [r for r in data["records"] if r["sourceFile"] not in replaced_sources] + additions
        all_uids = [q["uid"] for record in data["records"] for q in [record, *record.get("questions", [])]]
        assert len(all_uids) == len(set(all_uids))
        for part in data["parts"]:
            records = [r for r in data["records"] if r["part"] == part["part"]]
            part["counts"] = {"total": len(records), **{p: sum(r["priority"] == p for r in records) for p in ("P1", "P2", "P3")}}
        source_dir = ROOT / "question_banks"
        source_dir.mkdir(exist_ok=True)
        for bank in banks:
            export_images(archive, bank)
            (source_dir / source_for(bank)).write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n")
        data_path.write_text(prefix + json.dumps(data, ensure_ascii=False, indent=2) + ";\n")
    print(json.dumps({"imported_banks": [b["number"] for b in banks], "added_questions": 33,
                      "total_records": len(data["records"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
