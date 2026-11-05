import json
import os
import sqlite3
import time
from typing import Any, Dict, List, Optional

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "homework.db")


def get_conn() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at INTEGER NOT NULL,
                item_type TEXT NOT NULL,
                grade INTEGER NOT NULL DEFAULT 7,
                exam_goal TEXT NOT NULL DEFAULT 'fgos',
                subject TEXT NOT NULL DEFAULT 'auto',
                mode TEXT NOT NULL DEFAULT 'notebook',
                task_text TEXT NOT NULL,
                has_image INTEGER NOT NULL DEFAULT 0,
                response_md TEXT NOT NULL,
                sympy_badge TEXT DEFAULT '',
                provider_used TEXT DEFAULT '',
                favorite INTEGER NOT NULL DEFAULT 0,
                messages_json TEXT NOT NULL DEFAULT '[]'
            )
            """
        )
        conn.commit()


def save_history_item(
    item_type: str,
    grade: int,
    exam_goal: str,
    subject: str,
    mode: str,
    task_text: str,
    has_image: bool,
    response_md: str,
    sympy_badge: str = "",
    provider_used: str = "",
    messages: Optional[List[Dict[str, Any]]] = None,
) -> int:
    now = int(time.time())
    msgs_str = json.dumps(messages or [], ensure_ascii=False)
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO history (
                created_at, item_type, grade, exam_goal, subject, mode,
                task_text, has_image, response_md, sympy_badge, provider_used,
                favorite, messages_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                now,
                item_type,
                int(grade),
                exam_goal,
                subject,
                mode,
                task_text.strip() or "(Задание по фото)",
                1 if has_image else 0,
                response_md,
                sympy_badge,
                provider_used,
                msgs_str,
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def update_history_messages(
    item_id: int, messages: List[Dict[str, Any]], latest_response: Optional[str] = None
) -> None:
    msgs_str = json.dumps(messages, ensure_ascii=False)
    with get_conn() as conn:
        if latest_response is not None:
            conn.execute(
                "UPDATE history SET messages_json = ? WHERE id = ?",
                (msgs_str, item_id),
            )
        else:
            conn.execute(
                "UPDATE history SET messages_json = ? WHERE id = ?",
                (msgs_str, item_id),
            )
        conn.commit()


def list_history(limit: int = 50, favorites_only: bool = False) -> List[Dict[str, Any]]:
    query = "SELECT * FROM history"
    params: List[Any] = []
    if favorites_only:
        query += " WHERE favorite = 1"
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["messages"] = json.loads(d.pop("messages_json", "[]"))
        except Exception:
            d["messages"] = []
        result.append(d)
    return result


def get_history_item(item_id: int) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM history WHERE id = ?", (item_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["messages"] = json.loads(d.pop("messages_json", "[]"))
    except Exception:
        d["messages"] = []
    return d


def toggle_favorite(item_id: int) -> Optional[int]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT favorite FROM history WHERE id = ?", (item_id,)
        ).fetchone()
        if not row:
            return None
        new_val = 0 if row["favorite"] else 1
        conn.execute(
            "UPDATE history SET favorite = ? WHERE id = ?", (new_val, item_id)
        )
        conn.commit()
        return new_val


def delete_history_item(item_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM history WHERE id = ?", (item_id,))
        conn.commit()
        return cur.rowcount > 0
