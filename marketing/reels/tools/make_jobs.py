"""Turn scripts.json into the TTS job list (voice/jobs.json): one job per line plus the shared CTA."""
import json, os
S = json.load(open("scripts.json"))
jobs = [{"id": "cta", "text": S["cta"]["text"], "seed": 7}]
for r in S["reels"]:
    for i, line in enumerate(r["lines"]):
        jobs.append({"id": f"{r['slug']}_{i + 1}", "text": line, "seed": 11 if (r["slug"], i) == ("4-pov", 4) else 7})
os.makedirs("voice", exist_ok=True)
json.dump(jobs, open("voice/jobs.json", "w"), ensure_ascii=False, indent=1)
print(len(jobs), "jobs")
