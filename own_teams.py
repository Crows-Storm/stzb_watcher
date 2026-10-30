# -*- coding: utf-8 -*-
"""把 90005 里的 Tb_army / Tb_hero 投影成自己的分城队伍。"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime, timezone

ARMY_TABLE = "Tb_army"
HERO_TABLE = "Tb_hero"
ARMY_FIELD_COUNT = 144
HERO_FIELD_COUNT = 93

ARMY_USER = 1
ARMY_RESIDE = 2
ARMY_FRONT = 5
ARMY_MIDDLE = 6
ARMY_BACK = 7
ARMY_COUNSELLOR = 8
ARMY_FORMATION = 9
ARMY_STATE = 11
ARMY_CITY_TYPE = 82

HERO_TYPE = 1
HERO_ARMY = 3
HERO_LEVEL = 6
HERO_ENERGY = 7
HERO_HP = 11
HERO_SKILL = 22
HERO_ADVANCE = 29
HERO_HP_MAX = 47

HERO_SLOTS = (
    (ARMY_FRONT, "前排"),
    (ARMY_MIDDLE, "中排"),
    (ARMY_BACK, "后排"),
    (ARMY_COUNSELLOR, "参军"),
)

_TABLES = {
    ARMY_TABLE: ("armies", ARMY_FIELD_COUNT),
    HERO_TABLE: ("heroes", HERO_FIELD_COUNT),
}


def empty_state():
    return {"armies": {}, "heroes": {}}


def apply_db_sync_packet(conn, data, source_name=None):
    """把一包 90005 合并进 own_sync_rows。同名文件只处理一次。"""
    ensure_schema(conn)
    if source_name and _file_seen(conn, source_name):
        return 0
    state = load_state(conn)
    applied = apply_packet(state, data)
    if source_name or applied:
        save_state(conn, state)
        if source_name:
            conn.execute(
                "INSERT OR IGNORE INTO own_sync_files(filename, applied_at) VALUES(?, ?)",
                (source_name, _now()),
            )
        conn.commit()
    return applied


def ingest_capture(conn, cap_dir):
    """把报文目录里还没投影过的 90005 JSON 合并进来。"""
    folder = os.path.join(cap_dir or "", "00015f95")
    if not cap_dir or not os.path.isdir(folder):
        return 0
    ensure_schema(conn)
    seen = {
        row[0]
        for row in conn.execute("SELECT filename FROM own_sync_files")
    }
    state = None
    applied_files = 0
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".json") or name in seen:
            continue
        path = os.path.join(folder, name)
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError):
            continue
        if state is None:
            state = load_state(conn)
        apply_packet(state, data)
        conn.execute(
            "INSERT OR IGNORE INTO own_sync_files(filename, applied_at) VALUES(?, ?)",
            (name, _now()),
        )
        applied_files += 1
    if state is not None:
        save_state(conn, state)
        conn.commit()
    return applied_files


def project_capture(cap_dir):
    """不写库，直接从报文目录投影。库只读时用这条。"""
    state = empty_state()
    folder = os.path.join(cap_dir or "", "00015f95")
    if not cap_dir or not os.path.isdir(folder):
        return state
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(folder, name)
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError):
            continue
        apply_packet(state, data)
    return state


def apply_packet(state, data):
    if not isinstance(data, list):
        return 0
    applied = 0
    for item in data:
        if apply_item(state, item):
            applied += 1
    return applied


def apply_item(state, item):
    if not isinstance(item, list) or len(item) < 3:
        return False
    try:
        op = int(item[0])
    except (TypeError, ValueError):
        return False
    spec = _TABLES.get(item[1])
    payload = item[2]
    if spec is None or not isinstance(payload, list):
        return False
    bucket, field_count = spec
    if op == 3:
        row_id = _row_id(payload)
        if row_id is None:
            return False
        state[bucket].pop(row_id, None)
        return True
    sparse = _sparse_updates(payload, field_count)
    if sparse is not None:
        row_id, updates = sparse
        state[bucket].setdefault(row_id, {}).update(updates)
        return True
    if op in (1, 2) and len(payload) >= 22 and _is_int(payload[0]) and int(payload[0]) != 0:
        row_id = int(payload[0])
        state[bucket][row_id] = {
            index: payload[index]
            for index in range(min(len(payload), field_count))
        }
        return True
    return False


def load_state(conn):
    ensure_schema(conn)
    state = empty_state()
    rows = conn.execute(
        "SELECT table_name, row_id, fields_json FROM own_sync_rows"
    )
    for table_name, row_id, fields_json in rows:
        spec = _TABLES.get(table_name)
        if spec is None:
            continue
        try:
            raw = json.loads(fields_json or "{}")
        except json.JSONDecodeError:
            continue
        if not isinstance(raw, dict):
            continue
        state[spec[0]][int(row_id)] = {int(key): value for key, value in raw.items()}
    return state


def save_state(conn, state):
    ensure_schema(conn)
    conn.execute("DELETE FROM own_sync_rows")
    for table_name, bucket in ((ARMY_TABLE, "armies"), (HERO_TABLE, "heroes")):
        for row_id, fields in state[bucket].items():
            conn.execute(
                """
                INSERT INTO own_sync_rows(table_name, row_id, fields_json, updated_at)
                VALUES(?, ?, ?, ?)
                """,
                (
                    table_name,
                    int(row_id),
                    json.dumps({str(key): value for key, value in fields.items()}, ensure_ascii=False),
                    _now(),
                ),
            )


def ensure_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS own_sync_rows (
            table_name TEXT NOT NULL,
            row_id INTEGER NOT NULL,
            fields_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (table_name, row_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS own_sync_files (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )


def build_view(state, hero_names=None, skill_names=None, tile_names=None):
    hero_names = hero_names if hero_names is not None else _hero_names()
    skill_names = skill_names if skill_names is not None else _skill_names()
    tile_names = tile_names or {}
    heroes = state.get("heroes") or {}
    armies = state.get("armies") or {}
    used = set()
    cities = {}
    for army_id, fields in armies.items():
        wid = _positive_int(fields.get(ARMY_RESIDE))
        city = cities.setdefault(
            wid,
            {
                "wid": wid,
                "name": tile_names.get(wid) or "",
                "label": _city_label(wid, tile_names.get(wid) or ""),
                "armies": [],
            },
        )
        slots = []
        for field_index, slot_name in HERO_SLOTS:
            hero_uid = _positive_int(fields.get(field_index))
            if field_index == ARMY_COUNSELLOR and hero_uid <= 0:
                continue
            hero = _hero_view(hero_uid, heroes.get(hero_uid), hero_names, skill_names) if hero_uid else None
            if hero_uid:
                used.add(hero_uid)
            slots.append({
                "slot": slot_name,
                "heroUid": hero_uid,
                "hero": hero,
            })
        known_slots = [item for item in slots if item["heroUid"]]
        city["armies"].append({
            "armyId": int(army_id),
            "userId": _positive_int(fields.get(ARMY_USER)),
            "state": _int_or_none(fields.get(ARMY_STATE)),
            "formationId": _positive_int(fields.get(ARMY_FORMATION)),
            "cityType": _int_or_none(fields.get(ARMY_CITY_TYPE)),
            "slots": slots,
            "lineupReady": bool(known_slots) and all(
                item["hero"] and item["hero"]["heroId"] for item in known_slots
            ),
        })
    loose = []
    for hero_uid, fields in heroes.items():
        if int(hero_uid) in used:
            continue
        army_id = _positive_int(fields.get(HERO_ARMY))
        placed = False
        if army_id:
            for city in cities.values():
                for army in city["armies"]:
                    if army["armyId"] != army_id:
                        continue
                    army["slots"].append({
                        "slot": "未分位",
                        "heroUid": int(hero_uid),
                        "hero": _hero_view(int(hero_uid), fields, hero_names, skill_names),
                    })
                    placed = True
        if not placed:
            loose.append(_hero_view(int(hero_uid), fields, hero_names, skill_names))
    city_rows = sorted(cities.values(), key=lambda item: (item["wid"] == 0, item["wid"]))
    for city in city_rows:
        city["armies"].sort(key=lambda item: item["armyId"])
    loose.sort(key=lambda item: item["heroUid"])
    lineup_ready = any(army["lineupReady"] for city in city_rows for army in city["armies"])
    return {
        "ok": True,
        "armyCount": len(armies),
        "heroCount": len(heroes),
        "lineupReady": lineup_ready,
        "cities": city_rows,
        "looseHeroes": loose,
        "hint": (
            "队伍按驻地坐标分开。完整武将、战法要等 90005 推送 Tb_army 和 Tb_hero 的全量字段；"
            "只打开部队总览不一定会再推全表，换将、换战法或重新登录后会补齐。"
        ),
    }


def parse_skill_ids(value):
    if value is None or value == "" or value == 0:
        return []
    if isinstance(value, int):
        return [value] if 1000 <= value <= 2_000_000 else []
    found = []
    seen = set()
    for token in re.findall(r"\d+", str(value)):
        number = int(token)
        if number in seen or not 1000 <= number <= 2_000_000:
            continue
        seen.add(number)
        found.append(number)
    return found


def report_teams_from_rows(rows, skill_names=None, portraits=None):
    """按出战顺序把同一账号的战报收成队伍，每支保留最近一场。"""
    skill_names = skill_names or {}
    portraits = _portraits() if portraits is None else portraits
    grouped = {}
    order = []
    for row in rows:
        battle_id = int(row["battle_id"])
        if battle_id not in grouped:
            grouped[battle_id] = {
                "battle_id": battle_id,
                "time": int(row["time"] or 0),
                "time_str": row["time_str"] or "",
                "wid": int(row["wid"] or 0),
                "wid_name": row["wid_name"] or "",
                "side": row["side"] or "",
                "skill_info": row["all_skill_info"] or "",
                "advance": row["advance"] or "",
                "heroes": [],
            }
            order.append(battle_id)
        grouped[battle_id]["heroes"].append(row)
    latest = {}
    counts = {}
    for battle_id in order:
        battle = grouped[battle_id]
        heroes = sorted(battle["heroes"], key=lambda item: int(item["pos"] or 0))
        hero_ids = tuple(int(item["hero_id"] or 0) for item in heroes if int(item["hero_id"] or 0) > 0)
        if len(hero_ids) != 3 or len(set(hero_ids)) != 3:
            continue
        counts[hero_ids] = counts.get(hero_ids, 0) + 1
        current = latest.get(hero_ids)
        if current is None or (battle["time"], battle_id) >= (current["time"], current["battle_id"]):
            chosen = {**battle, "heroes": heroes, "hero_ids": hero_ids}
            if (
                current is not None
                and not _has_report_skills(chosen["skill_info"])
                and _has_report_skills(current["skill_info"])
            ):
                chosen["skill_info"] = current["skill_info"]
            latest[hero_ids] = chosen
        elif not _has_report_skills(current["skill_info"]) and _has_report_skills(battle["skill_info"]):
            current["skill_info"] = battle["skill_info"]
    teams = []
    for hero_ids, battle in latest.items():
        skills = parse_report_skills(battle["skill_info"])
        advances = parse_report_advance(battle["advance"])
        slots = []
        for index, hero in enumerate(battle["heroes"]):
            if int(hero["hero_id"] or 0) <= 0:
                continue
            hero_pos = int(hero["pos"] or 0)
            skill_pos = hero_pos + 1 if battle["side"] == "atk" else hero_pos + 4
            hero_id = int(hero["hero_id"])
            troops = _troop_total(hero["max_hp"], hero["remain_hp"])
            slots.append({
                "slot": ("前排", "中排", "后排")[index] if index < 3 else f"位置 {index + 1}",
                "hero": {
                    "heroId": hero_id,
                    "name": hero["hero_name"] or "",
                    "level": _int_or_none(hero["level"]),
                    "advance": advances[index] if index < len(advances) else None,
                    "hp": troops,
                    "hpMax": troops,
                    "skills": [
                        {
                            "id": skill["id"],
                            "level": skill["level"],
                            "name": skill_names.get(skill["id"]) or "",
                        }
                        for skill in skills.get(skill_pos, [])
                    ],
                    "configured": True,
                    **_portrait_fields(hero_id, portraits),
                },
            })
        place = str(battle["wid_name"] or "").strip()
        if not place and battle["wid"]:
            place = f"WID {battle['wid']}"
        teams.append({
            "key": ".".join(str(hero_id) for hero_id in hero_ids),
            "sampleSize": counts[hero_ids],
            "lastTime": battle["time_str"],
            "lastWid": battle["wid"],
            "lastPlace": place,
            "side": battle["side"],
            "slots": slots,
            "_time": battle["time"],
            "_battle_id": battle["battle_id"],
        })
    return _keep_latest_hero_teams(teams)


def _keep_latest_hero_teams(teams):
    """同一武将只留最近一次满编队伍，更早的另一套搭配丢掉。"""
    ordered = sorted(teams, key=lambda item: (item["_time"], item["_battle_id"]), reverse=True)
    claimed = set()
    kept = []
    for team in ordered:
        hero_ids = [slot["hero"]["heroId"] for slot in team["slots"]]
        if any(hero_id in claimed for hero_id in hero_ids):
            continue
        claimed.update(hero_ids)
        team.pop("_time", None)
        team.pop("_battle_id", None)
        kept.append(team)
    return kept


def _troop_total(max_hp, remain_hp):
    maximum = _int_or_none(max_hp)
    remain = _int_or_none(remain_hp)
    if maximum is not None and maximum > 0:
        return maximum
    if remain is not None and remain > 0:
        return remain
    return maximum if maximum is not None else remain


def _has_report_skills(raw):
    return bool(parse_report_skills(raw))


def parse_report_skills(raw):
    found = {}
    for part in str(raw or "").split(";"):
        pieces = [piece.strip() for piece in part.split(",")]
        if len(pieces) < 2 or not pieces[0].isdigit():
            continue
        pos = int(pieces[0])
        skills = []
        for index in range(1, len(pieces), 2):
            skill_id = pieces[index] if index < len(pieces) else ""
            level = pieces[index + 1] if index + 1 < len(pieces) else "0"
            if skill_id.isdigit() and int(skill_id) > 0:
                skills.append({
                    "id": int(skill_id),
                    "level": int(level) if level.isdigit() else 0,
                })
        if skills:
            found[pos] = skills
    return found


def parse_report_advance(raw):
    values = []
    parts = [part.strip() for part in str(raw or "").split(";") if part.strip()]
    for index, part in enumerate(parts):
        if index == 0:
            continue
        if index > 3:
            break
        head = part.split(",", 1)[0].strip()
        values.append(int(head) if head.isdigit() else 0)
    return values


def load_report_teams(conn, role_name, skill_names=None):
    role_name = str(role_name or "").strip()
    if not role_name or not _table_exists(conn, "battles_v2") or not _table_exists(conn, "battle_heroes"):
        return []
    rows = conn.execute(
        """
        SELECT bv.battle_id, bv.time, bv.time_str, bv.wid, bv.wid_name,
               CASE WHEN bv.atk_name = ? THEN 'atk' ELSE 'def' END AS side,
               bv.all_skill_info,
               CASE WHEN bv.atk_name = ? THEN bv.atk_advance ELSE bv.def_advance END AS advance,
               bh.pos, bh.hero_id, bh.hero_name, bh.level, bh.max_hp, bh.remain_hp
        FROM battles_v2 bv
        JOIN battle_heroes bh ON bh.battle_id = bv.battle_id
        WHERE (bv.atk_name = ? AND bh.side = 'atk')
           OR (bv.def_name = ? AND bh.side = 'def')
        ORDER BY bv.time DESC, bv.battle_id DESC, bh.pos
        """,
        (role_name, role_name, role_name, role_name),
    ).fetchall()
    return report_teams_from_rows(rows, skill_names if skill_names is not None else _skill_names())


def register_own_teams_api(app, get_connection, cap_dir_of, role_name_of=None):
    @app.route("/api/my-teams")
    def api_my_teams():
        conn = get_connection()
        try:
            cap_dir = cap_dir_of() or ""
            try:
                ingest_capture(conn, cap_dir)
                state = load_state(conn)
                tile_names = _tile_names(conn, _reside_wids(state))
            except sqlite3.OperationalError:
                state = project_capture(cap_dir)
                tile_names = {}
            view = build_view(state, tile_names=tile_names)
            role_name = (role_name_of() if role_name_of else "") or ""
            try:
                teams = load_report_teams(conn, role_name)
            except sqlite3.OperationalError:
                teams = []
            view["roleName"] = role_name
            view["reportTeams"] = teams
            if teams:
                view["lineupReady"] = True
                view["hint"] = (
                    f"按当前账号「{role_name}」的战报认领。"
                    "只收满编三人的战报，兵力按总兵力显示。"
                    "同一个武将如果还出现在另一套搭配里，只保留更新的那支。"
                )
            elif not role_name:
                view["hint"] = "右上角还没有当前角色名，无法从战报认领队伍。"
            return json_response(view)
        finally:
            conn.close()

    def json_response(payload):
        from flask import jsonify
        return jsonify(payload)


def _hero_view(hero_uid, fields, hero_names, skill_names):
    fields = fields or {}
    hero_id = _positive_int(fields.get(HERO_TYPE))
    skills = []
    for skill_id in parse_skill_ids(fields.get(HERO_SKILL)):
        skills.append({
            "id": skill_id,
            "name": skill_names.get(skill_id) or "",
        })
    view = {
        "heroUid": int(hero_uid),
        "heroId": hero_id,
        "name": hero_names.get(hero_id) or "",
        "level": _int_or_none(fields.get(HERO_LEVEL)),
        "advance": _int_or_none(fields.get(HERO_ADVANCE)),
        "energy": _int_or_none(fields.get(HERO_ENERGY)),
        "hp": _int_or_none(fields.get(HERO_HP)),
        "hpMax": _int_or_none(fields.get(HERO_HP_MAX)),
        "armyId": _positive_int(fields.get(HERO_ARMY)),
        "skills": skills,
        "configured": hero_id > 0 or bool(skills) or fields.get(HERO_LEVEL) is not None,
    }
    view.update(_portrait_fields(hero_id))
    return view


def _city_label(wid, name):
    if not wid:
        return "未分城"
    if name:
        return f"{name} · {wid}"
    return f"驻地 {wid}"


def _reside_wids(state):
    wids = []
    for fields in (state.get("armies") or {}).values():
        wid = _positive_int(fields.get(ARMY_RESIDE))
        if wid:
            wids.append(wid)
    return wids


def _tile_names(conn, wids):
    if not wids:
        return {}
    placeholders = ",".join("?" * len(wids))
    try:
        rows = conn.execute(
            f"SELECT wid, name FROM world_tiles WHERE wid IN ({placeholders})",
            wids,
        ).fetchall()
    except sqlite3.OperationalError:
        return {}
    return {int(row[0]): row[1] or "" for row in rows if row[1]}


def _sparse_updates(payload, field_count):
    if len(payload) < 4 or len(payload) % 2:
        return None
    if payload[0] != 0 or not _is_int(payload[1]):
        return None
    updates = {}
    for index in range(2, len(payload), 2):
        field_index = payload[index]
        if not _is_int(field_index) or not 0 <= int(field_index) < field_count:
            return None
        updates[int(field_index)] = payload[index + 1]
    return int(payload[1]), updates


def _row_id(payload):
    if len(payload) >= 2 and payload[0] == 0 and _is_int(payload[1]):
        return int(payload[1])
    if payload and _is_int(payload[0]) and int(payload[0]) != 0:
        return int(payload[0])
    return None


def _table_exists(conn, name):
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def _file_seen(conn, source_name):
    row = conn.execute(
        "SELECT 1 FROM own_sync_files WHERE filename=?",
        (source_name,),
    ).fetchone()
    return row is not None


def _portrait_fields(hero_id, portraits=None):
    hero_id = int(hero_id or 0)
    empty = {
        "iconId": hero_id,
        "portraitUrl": "",
        "portraitFallbackUrl": "",
        "portraitLocal": False,
        "camp": 0,
    }
    if hero_id <= 0:
        return empty
    if portraits is not None:
        row = portraits.get(hero_id)
        if row is None:
            row = portraits.get(_normalized_hero_id(hero_id))
        if row:
            merged = dict(empty)
            merged.update(row)
            merged["iconId"] = int(row.get("iconId") or hero_id)
            return merged
        if hero_id in portraits:
            return empty
    try:
        import sim_data
        hero = sim_data.hero_by_id(hero_id) or {}
        if hero:
            return {
                "iconId": int(hero.get("iconId") or hero_id),
                "portraitUrl": hero.get("portraitUrl") or "",
                "portraitFallbackUrl": hero.get("portraitFallbackUrl") or "",
                "portraitLocal": bool(hero.get("portraitLocal")),
                "camp": int(hero.get("camp") or 0),
            }
        fields = sim_data._portrait_fields(hero_id, hero_id)
        fields["camp"] = 0
        return fields
    except (OSError, ImportError, KeyError, ValueError, TypeError):
        return empty


def _normalized_hero_id(hero_id):
    try:
        from intelligence.hero_ids import normalize_hero_id
        return int(normalize_hero_id(hero_id))
    except (ImportError, TypeError, ValueError):
        return int(hero_id)


def _portraits():
    try:
        import sim_data
        found = {}
        for hero in sim_data.load_heroes():
            found[hero["id"]] = {
                "iconId": int(hero.get("iconId") or hero["id"]),
                "portraitUrl": hero.get("portraitUrl") or "",
                "portraitFallbackUrl": hero.get("portraitFallbackUrl") or "",
                "portraitLocal": bool(hero.get("portraitLocal")),
                "camp": int(hero.get("camp") or 0),
            }
        return found
    except (OSError, ImportError, KeyError, ValueError, TypeError):
        return {}


def _hero_names():
    try:
        import sim_data
        return {hero["id"]: hero["name"] for hero in sim_data.load_heroes()}
    except (OSError, ImportError, KeyError, ValueError):
        return {}


def _skill_names():
    try:
        import sim_data
        return {skill["id"]: skill["name"] for skill in sim_data.load_skills()}
    except (OSError, ImportError, KeyError, ValueError):
        return {}


def _positive_int(value):
    number = _int_or_none(value)
    if number is None or number <= 0:
        return 0
    return number


def _int_or_none(value):
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_int(value):
    return _int_or_none(value) is not None


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
