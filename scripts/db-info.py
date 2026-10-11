"""临时只读数据库体检脚本（用完即删）。
用 Python 的 sqlite3 直读，避免为了看库而启动 Electron（无窗口的 Electron 会触发 GPU 进程崩溃）。
用法：python scripts/_dbinfo.py <dbPath>
"""
import json
import sqlite3
import sys

p = sys.argv[1]
conn = sqlite3.connect(p)
cur = conn.cursor()

out = {"dbPath": p}

tables = [r[0] for r in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
out["tables"] = tables

try:
    out["schemaVersion"] = cur.execute(
        "SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]
except Exception as e:
    out["schemaVersion"] = f"<{e}>"

cols = cur.execute("PRAGMA table_info(equipment)").fetchall()
pid = [c for c in cols if c[1] == "project_id"]
out["equipmentProjectIdNotNull"] = pid[0][3] if pid else None

for t in tables:
    if t.startswith("sqlite_"):
        continue
    try:
        out[f"count_{t}"] = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    except Exception as e:
        out[f"count_{t}"] = f"<{e}>"

try:
    out["projects"] = cur.execute(
        "SELECT id, code, name, manager, status FROM project ORDER BY id").fetchall()
except Exception as e:
    out["projects"] = f"<{e}>"

try:
    out["equipment"] = cur.execute(
        "SELECT id, project_id, name, model, quantity FROM equipment ORDER BY id").fetchall()
except Exception as e:
    out["equipment"] = f"<{e}>"

print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
conn.close()
