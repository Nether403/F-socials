import json
from graphify.detect import detect
from pathlib import Path
result = detect(Path('.'))
Path('graphify-out/.graphify_detect.json').write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
print("total_files", result.get("total_files"))
print("total_words", result.get("total_words"))
fc = {k: len(v) for k, v in result.get("files", {}).items()}
print("by_type", json.dumps(fc))
print("skipped_sensitive", len(result.get("skipped_sensitive", []) or []))
