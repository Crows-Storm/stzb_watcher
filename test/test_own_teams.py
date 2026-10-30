import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import own_teams


def full_army(army_id, reside_wid, front, middle, back):
    payload = [0] * own_teams.ARMY_FIELD_COUNT
    payload[0] = army_id
    payload[own_teams.ARMY_USER] = 42
    payload[own_teams.ARMY_RESIDE] = reside_wid
    payload[own_teams.ARMY_FRONT] = front
    payload[own_teams.ARMY_MIDDLE] = middle
    payload[own_teams.ARMY_BACK] = back
    payload[own_teams.ARMY_STATE] = 5
    return [1, "Tb_army", payload]


def full_hero(hero_uid, hero_id, level, skill):
    payload = [0] * own_teams.HERO_FIELD_COUNT
    payload[0] = hero_uid
    payload[own_teams.HERO_TYPE] = hero_id
    payload[own_teams.HERO_LEVEL] = level
    payload[own_teams.HERO_SKILL] = skill
    payload[own_teams.HERO_HP] = 1000
    return [1, "Tb_hero", payload]


class OwnTeamsTest(unittest.TestCase):
    def test_sparse_hero_update_merges_and_stays_incomplete(self):
        state = own_teams.empty_state()
        own_teams.apply_item(state, [2, "Tb_hero", [0, 60880, 11, 6633, 12, 867]])
        own_teams.apply_item(state, [2, "Tb_hero", [0, 60880, 11, 7000]])

        view = own_teams.build_view(state, hero_names={}, skill_names={})

        self.assertEqual(7000, state["heroes"][60880][11])
        self.assertEqual(1, view["heroCount"])
        self.assertEqual(0, view["armyCount"])
        self.assertFalse(view["lineupReady"])
        self.assertEqual(60880, view["looseHeroes"][0]["heroUid"])
        self.assertEqual(7000, view["looseHeroes"][0]["hp"])
        self.assertFalse(view["looseHeroes"][0]["configured"])

    def test_full_rows_group_cities_and_resolve_skills(self):
        state = own_teams.empty_state()
        own_teams.apply_packet(state, [
            full_army(10, 2720968, 101, 102, 0),
            full_army(11, 1800001, 201, 0, 0),
            full_hero(101, 100027, 37, "200101|1,200102"),
            full_hero(102, 100016, 40, ""),
            full_hero(201, 100013, 28, "0"),
        ])

        view = own_teams.build_view(
            state,
            hero_names={100027: "刘备", 100016: "吕布", 100013: "马超"},
            skill_names={200101: "战法甲", 200102: "战法乙"},
            tile_names={2720968: "榕城"},
        )

        self.assertEqual(["驻地 1800001", "榕城 · 2720968"], [city["label"] for city in view["cities"]])
        home = view["cities"][1]["armies"][0]
        self.assertEqual(["前排", "中排", "后排"], [slot["slot"] for slot in home["slots"]])
        self.assertEqual("刘备", home["slots"][0]["hero"]["name"])
        self.assertEqual(["战法甲", "战法乙"], [skill["name"] for skill in home["slots"][0]["hero"]["skills"]])
        self.assertTrue(home["lineupReady"])
        self.assertEqual("马超", view["cities"][0]["armies"][0]["slots"][0]["hero"]["name"])

    def test_delete_removes_army(self):
        state = own_teams.empty_state()
        own_teams.apply_item(state, full_army(10, 5, 1, 0, 0))
        own_teams.apply_item(state, [3, "Tb_army", [0, 10]])
        self.assertNotIn(10, state["armies"])

    def test_ingest_is_idempotent_and_readonly_scan_matches(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = Path(tmp) / "00015f95"
            cap.mkdir()
            packet = [full_army(7, 9, 3, 0, 0), full_hero(3, 100027, 10, "200101")]
            (cap / "cap_1.json").write_text(json.dumps(packet), encoding="utf-8")
            conn = sqlite3.connect(Path(tmp) / "teams.db")
            try:
                self.assertEqual(1, own_teams.ingest_capture(conn, tmp))
                self.assertEqual(0, own_teams.ingest_capture(conn, tmp))
                stored = own_teams.load_state(conn)
            finally:
                conn.close()
            scanned = own_teams.project_capture(tmp)
            self.assertEqual(stored["armies"][7][own_teams.ARMY_RESIDE], scanned["armies"][7][own_teams.ARMY_RESIDE])
            self.assertEqual(100027, scanned["heroes"][3][own_teams.HERO_TYPE])


class ReportTeamTest(unittest.TestCase):
    def test_full_lineup_keeps_latest_battle_total_troops_and_skills(self):
        skill = "1,200101,8;2,200102,4;3,200103,1"
        rows = [
            _report_row(1, 10, "10:00", 100, "旧地", 0, 100003, "吕布", "1,200101,5"),
            _report_row(1, 10, "10:00", 100, "旧地", 1, 100687, "小乔", "2,200102,3"),
            _report_row(1, 10, "10:00", 100, "旧地", 2, 100030, "孙权", "3,200103,1"),
            _report_row(2, 20, "11:00", 200, "新地", 0, 100003, "吕布", skill),
            _report_row(2, 20, "11:00", 200, "新地", 1, 100687, "小乔", skill),
            _report_row(2, 20, "11:00", 200, "新地", 2, 100030, "孙权", skill),
            _report_row(3, 30, "12:00", 300, "残阵", 0, 100027, "刘备", "1,200103,1"),
            _report_row(3, 30, "12:00", 300, "残阵", 1, 100028, "魏延", "2,200104,1"),
        ]
        teams = own_teams.report_teams_from_rows(rows, {200101: "战法甲", 200102: "战法乙"}, {
            100003: {
                "iconId": 100003,
                "portraitUrl": "/static/hero-portraits/cards/100003.webp",
                "portraitFallbackUrl": "https://cdn.example/100003.jpg",
                "portraitLocal": True,
                "camp": 5,
            },
        })

        self.assertEqual(["吕布 / 小乔 / 孙权"], [
            " / ".join(slot["hero"]["name"] for slot in team["slots"]) for team in teams
        ])
        latest = teams[0]
        self.assertEqual(2, latest["sampleSize"])
        self.assertEqual("新地", latest["lastPlace"])
        self.assertEqual(1000, latest["slots"][0]["hero"]["hp"])
        self.assertEqual(1000, latest["slots"][0]["hero"]["hpMax"])
        self.assertEqual("战法甲", latest["slots"][0]["hero"]["skills"][0]["name"])
        self.assertEqual(8, latest["slots"][0]["hero"]["skills"][0]["level"])
        self.assertEqual("/static/hero-portraits/cards/100003.webp", latest["slots"][0]["hero"]["portraitUrl"])
        self.assertEqual(5, latest["slots"][0]["hero"]["camp"])

    def test_shared_hero_keeps_only_the_newer_trio(self):
        rows = [
            *_trio(1, 10, "10:00", (100003, "吕布"), (100001, "关羽"), (100002, "张飞")),
            *_trio(2, 20, "11:00", (100003, "吕布"), (100687, "小乔"), (100030, "孙权")),
            *_trio(4, 15, "10:30", (100010, "邓艾"), (100011, "袁绍"), (100012, "黄忠")),
        ]
        teams = own_teams.report_teams_from_rows(rows, {}, {})
        self.assertEqual(["吕布 / 小乔 / 孙权", "邓艾 / 袁绍 / 黄忠"], [
            " / ".join(slot["hero"]["name"] for slot in team["slots"]) for team in teams
        ])

    def test_other_player_rows_are_not_grouped_here(self):
        self.assertEqual([], own_teams.report_teams_from_rows([], {}, {}))

    def test_newer_report_without_skills_keeps_older_skills_and_latest_troops(self):
        skilled = "1,200016,10,200201,5,200194,5;2,200022,10,200643,2;3,200930,10,200228,7"
        rows = [
            _report_row(2, 20, "11:00", 200, "新地", 0, 100016, "刘备", "", max_hp=7200),
            _report_row(2, 20, "11:00", 200, "新地", 1, 100022, "张飞", "", max_hp=7200),
            _report_row(2, 20, "11:00", 200, "新地", 2, 100649, "魏延", "", max_hp=7500),
            _report_row(1, 10, "10:00", 100, "旧地", 0, 100016, "刘备", skilled, max_hp=3995),
            _report_row(1, 10, "10:00", 100, "旧地", 1, 100022, "张飞", skilled, max_hp=4485),
            _report_row(1, 10, "10:00", 100, "旧地", 2, 100649, "魏延", skilled, max_hp=3971),
        ]
        teams = own_teams.report_teams_from_rows(rows, {
            200016: "仁德载世",
            200201: "战法乙",
            200194: "战法丙",
        }, {})
        hero = teams[0]["slots"][0]["hero"]
        self.assertEqual("新地", teams[0]["lastPlace"])
        self.assertEqual(7200, hero["hpMax"])
        self.assertEqual([200016, 200201, 200194], [skill["id"] for skill in hero["skills"]])
        self.assertEqual([10, 5, 5], [skill["level"] for skill in hero["skills"]])


def _trio(battle_id, time_value, time_str, front, middle, back):
    rows = []
    for pos, (hero_id, name) in enumerate((front, middle, back)):
        rows.append(_report_row(battle_id, time_value, time_str, 1, "地", pos, hero_id, name, ""))
    return rows


def _report_row(battle_id, time_value, time_str, wid, place, pos, hero_id, name, skill, max_hp=1000):
    return {
        "battle_id": battle_id,
        "time": time_value,
        "time_str": time_str,
        "wid": wid,
        "wid_name": place,
        "side": "atk",
        "all_skill_info": skill,
        "advance": "",
        "pos": pos,
        "hero_id": hero_id,
        "hero_name": name,
        "level": 26,
        "max_hp": max_hp,
        "remain_hp": 800,
    }


if __name__ == "__main__":
    unittest.main()
