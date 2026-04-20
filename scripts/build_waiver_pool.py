"""
Build public/IPL-Fantasy-Phase-2/data/waiver-pool.json from scripts/espn_ipl2026_squads.md,
franchises.json (owned ids), and players.json (existing ids + nationality).

Waiver pool = IPL 2026 squad players who are not on any fantasy franchise roster
and who are not already listed in players.json (those stay in players.json only).

Refresh espn_ipl2026_squads.md from ESPN series-squads pages when IPL squads change.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "IPL-Fantasy-Phase-2" / "data"
SCRIPTS = Path(__file__).resolve().parent
CACHE = SCRIPTS / "espn_ipl2026_squads.md"
LEAGUE_SHEET = SCRIPTS / "ipl2026_league_sheet.pipe"

# Also listed in players.json but must appear in waiver-pool.json (full waiver catalog).
POOL_ALSO_FROM_PLAYERS_JSON: frozenset[str] = frozenset(
    {
        "lungi-ngidi",
        "vijaykumar-vyshak",
        "xavier-bartlett",
        "jacob-duffy",
        "t-natarajan",
        "cooper-connolly",
        "mitchell-santner",
        "nandre-burger",
        "aniket-verma",
    }
)

# Display name -> app id (must match players.json / waiver-pool conventions)
DISPLAY_TO_ID: dict[str, str] = {
    "M Shahrukh Khan": "shahrukh-khan",
    "AM Ghazanfar": "am-ghazanfar",
    "T Natarajan": "t-natarajan",
}

LINK_RE = re.compile(
    r"\[([^\]]+)\]\(https://www\.espncricinfo\.com/cricketers/([^)]+)\)"
)
TEAM_HEAD = re.compile(r"^===([A-Z]+)===$", re.MULTILINE)

# ESPN slug base -> app player id (when ESPN spelling/slug differs)
SLUG_TO_ID = {
    "abishek-porel": "abhishek-porel",
    "m-shahrukh-khan": "shahrukh-khan",
    "avesh-khan": "avesh-kumar",
}

# player id -> nationality when not present in players.json
EXTRA_NAT: dict[str, str] = {
    "ms-dhoni": "IND",
    "shahrukh-khan": "IND",
    "zak-foulkes": "OVS",
    "ramakrishna-ghosh": "IND",
    "matthew-short": "OVS",
    "prashant-veer": "IND",
    "gurjapneet-singh": "IND",
    "akeal-hosein": "OVS",
    "spencer-johnson": "OVS",
    "mukesh-choudhary": "IND",
    "sahil-parakh": "IND",
    "madhav-tiwari": "IND",
    "tripurana-vijay": "IND",
    "anuj-rawat": "IND",
    "tom-banton": "OVS",
    "kumar-kushagra": "IND",
    "arshad-khan": "IND",
    "ashok-sharma": "IND",
    "gurnoor-brar": "IND",
    "kulwant-khejroliya": "IND",
    "tejasvi-dahiya": "IND",
    "manish-pandey": "IND",
    "rovman-powell": "OVS",
    "ramandeep-singh": "IND",
    "sarthak-ranjan": "IND",
    "rahul-tripathi": "IND",
    "daksh-kamra": "IND",
    "saurabh-dubey": "IND",
    "kartik-tyagi": "IND",
    "prashant-solanki": "IND",
    "abdul-samad": "IND",
    "akshat-raghuwanshi": "IND",
    "matthew-breetzke": "OVS",
    "mukul-choudhary": "IND",
    "himmat-singh": "IND",
    "akash-singh": "IND",
    "prince-yadav": "IND",
    "manimaran-siddharth": "IND",
    "arjun-tendulkar": "IND",
    "naman-tiwari": "IND",
    "danish-malewar": "IND",
    "robin-minz": "IND",
    "sherfane-rutherford": "OVS",
    "atharva-ankolekar": "IND",
    "raj-bawa": "IND",
    "corbin-bosch": "OVS",
    "mayank-rawat": "IND",
    "ashwani-kumar": "IND",
    "mayank-markande": "IND",
    "mohd-izhar": "IND",
    "raghu-sharma": "IND",
    "pyla-avinash": "IND",
    "harnoor-singh": "IND",
    "vishnu-vinod": "IND",
    "musheer-khan": "IND",
    "mitchell-owen": "OVS",
    "suryansh-shedge": "IND",
    "praveen-dubey": "IND",
    "ben-dwarshuis": "OVS",
    "vishal-nishad": "IND",
    "yash-thakur": "IND",
    "aman-rao": "IND",
    "shubham-dubey": "IND",
    "ravi-singh": "IND",
    "lhuan-dre-pretorius": "OVS",
    "donovan-ferreira": "OVS",
    "brijesh-sharma": "IND",
    "sushant-mishra": "IND",
    "vignesh-puthur": "IND",
    "yash-raj-punja": "IND",
    "yudhvir-singh": "IND",
    "jordan-cox": "OVS",
    "kanishk-chouhan": "IND",
    "vihaan-malhotra": "IND",
    "mangesh-yadav": "IND",
    "abhinandan-singh": "IND",
    "satvik-deswal": "IND",
    "vicky-ostwal": "IND",
    "rasikh-salam": "IND",
    "suyash-sharma": "IND",
    "swapnil-singh": "IND",
    "salil-arora": "IND",
    "ravichandran-smaran": "IND",
    "krains-fuletra": "IND",
    "kamindu-mendis": "OVS",
    "shivang-kumar": "IND",
    "amit-kumar": "IND",
    "praful-hinge": "IND",
    "eshan-malinga": "OVS",
    "david-payne": "OVS",
    "sakib-hussain": "IND",
    "onkar-tarmale": "IND",
    "jaydev-unadkat": "IND",
    "aman-khan": "IND",
    "urvil-patel": "IND",
    "sarfaraz-khan": "IND",
    "rahul-chahar": "IND",
    "shreyas-gopal": "IND",
    "karun-nair": "IND",
    "ajay-mandal": "IND",
    "ashutosh-sharma": "IND",
    "nishant-sindhu": "IND",
    "manav-suthar": "IND",
    "jayant-yadav": "IND",
    "anukul-roy": "IND",
    "navdeep-saini": "IND",
    "umran-malik": "IND",
    "arshin-kulkarni": "IND",
    "shahbaz-ahmed": "IND",
    "kuldeep-sen": "IND",
    "adam-milne": "OVS",
    "am-ghazanfar": "OVS",
    "anrich-nortje": "OVS",
    "brydon-carse": "OVS",
    "dasun-shanaka": "OVS",
    "dushmantha-chameera": "OVS",
    "harpreet-brar": "IND",
    "harsh-dubey": "IND",
    "ishant-sharma": "IND",
    "kwena-maphaka": "OVS",
    "kyle-jamieson": "OVS",
    "lockie-ferguson": "OVS",
    "luke-wood": "OVS",
    "mayank-yadav": "IND",
    "nuwan-thushara": "OVS",
    "prithvi-shaw": "IND",
    "shivam-mavi": "IND",
    "tim-david": "OVS",
}


def display_name_to_id(display: str) -> str:
    display = display.replace("\xa0", " ").strip()
    if display in DISPLAY_TO_ID:
        return DISPLAY_TO_ID[display]
    return "-".join(display.lower().split())


def load_league_sheet() -> dict[str, dict[str, str]]:
    """Canonical name, IPL team, nationality, role from league auction sheet."""
    if not LEAGUE_SHEET.is_file():
        return {}
    out: dict[str, dict[str, str]] = {}
    for line in LEAGUE_SHEET.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) != 4:
            continue
        name, team, nat, role = (x.strip() for x in parts)
        if nat not in ("IND", "OVS") or role not in ("BAT", "WK", "AR", "BOWL"):
            continue
        pid = display_name_to_id(name)
        out[pid] = {
            "name": name,
            "iplTeam": team,
            "nationality": nat,
            "role": role,
        }
    return out


def slug_to_app_id(slug: str) -> str:
    base = re.sub(r"-\d+$", "", slug)
    return SLUG_TO_ID.get(base, base)


def role_for_blob(section: str, blob: str) -> str:
    if re.search(r"^\s*Withdrawn\s*$", blob, re.MULTILINE):
        return "WITHDRAWN"
    if section == "ALLROUNDERS":
        return "AR"
    if section == "BOWLERS":
        return "BOWL"
    # BATTERS
    if re.search(r"Wicketkeeper", blob):
        return "WK"
    return "BAT"


def parse_squads(md: str) -> list[tuple[str, str, str, str]]:
    """team_code, display_name, app_id, role (BAT|WK|AR|BOWL|WITHDRAWN)"""
    out: list[tuple[str, str, str, str]] = []
    for m in TEAM_HEAD.finditer(md):
        team = m.group(1)
        start = m.end()
        nxt = TEAM_HEAD.search(md, m.end())
        block = md[start : nxt.start() if nxt else len(md)]
        section = "BATTERS"
        lines = block.split("\n")
        i = 0
        while i < len(lines):
            raw = lines[i]
            if raw.strip().upper() == "BATTERS":
                section = "BATTERS"
            elif raw.strip().upper() == "ALLROUNDERS":
                section = "ALLROUNDERS"
            elif raw.strip().upper() == "BOWLERS":
                section = "BOWLERS"
            lm = LINK_RE.match(raw.strip())
            if lm:
                name, slug = lm.group(1), lm.group(2)
                # collect following lines until next link line or empty+link
                j = i + 1
                bits: list[str] = []
                while j < len(lines):
                    sj = lines[j].strip()
                    if LINK_RE.match(sj):
                        break
                    if sj.upper() in ("BATTERS", "ALLROUNDERS", "BOWLERS"):
                        break
                    bits.append(lines[j])
                    j += 1
                blob = "\n".join(bits)
                role = role_for_blob(section, blob)
                pid = slug_to_app_id(slug)
                if role != "WITHDRAWN":
                    out.append((team, name, pid, role))
                i = j
                continue
            i += 1
    return out


def main() -> None:
    franchises = json.loads((DATA / "franchises.json").read_text(encoding="utf-8"))
    owned: set[str] = set()
    for fr in franchises["franchises"]:
        owned.update(fr["playerIds"])

    players_file = json.loads((DATA / "players.json").read_text(encoding="utf-8"))
    known_ids = {p["id"] for p in players_file["players"]}
    players_by_id = {p["id"]: p for p in players_file["players"]}
    nat_from_json = {p["id"]: p.get("nationality", "IND") for p in players_file["players"]}

    md = CACHE.read_text(encoding="utf-8")
    rows = parse_squads(md)
    # last occurrence wins for duplicates across sections mistake
    by_id: dict[str, tuple[str, str, str, str]] = {}
    for team, name, pid, role in rows:
        by_id[pid] = (team, name, pid, role)

    def skip_players_json(pid: str) -> bool:
        return pid in known_ids and pid not in POOL_ALSO_FROM_PLAYERS_JSON

    pool: list[dict] = []
    for pid, (team, name, _, role) in sorted(by_id.items(), key=lambda x: x[0]):
        if pid in owned:
            continue
        if skip_players_json(pid):
            continue
        nat = nat_from_json.get(pid) or EXTRA_NAT.get(pid)
        if not nat:
            raise SystemExit(f"Missing nationality for waiver-pool player {pid} ({name})")
        pool.append(
            {
                "id": pid,
                "name": name.strip(),
                "iplTeam": team,
                "role": role,
                "nationality": nat,
                "seasonTotal": 0,
                "byMatch": [],
            }
        )

    sheet = load_league_sheet()
    pool_by_id: dict[str, dict] = {p["id"]: p for p in pool}

    for pid, s in sheet.items():
        if pid in owned:
            continue
        if pid in known_ids and pid not in POOL_ALSO_FROM_PLAYERS_JSON:
            continue
        if pid not in pool_by_id:
            pool_by_id[pid] = {
                "id": pid,
                "name": s["name"],
                "iplTeam": s["iplTeam"],
                "role": s["role"],
                "nationality": s["nationality"],
                "seasonTotal": 0,
                "byMatch": [],
            }

    for pid in POOL_ALSO_FROM_PLAYERS_JSON:
        if pid in owned or pid in pool_by_id:
            continue
        p = players_by_id.get(pid)
        if not p:
            raise SystemExit(f"POOL_ALSO_FROM_PLAYERS_JSON id missing from players.json: {pid}")
        pool_by_id[pid] = {
            "id": pid,
            "name": p["name"],
            "iplTeam": p["iplTeam"],
            "role": p["role"],
            "nationality": p.get("nationality", "IND"),
            "seasonTotal": 0,
            "byMatch": [],
        }

    for p in pool_by_id.values():
        pid = p["id"]
        if pid in sheet:
            s = sheet[pid]
            p["name"] = s["name"]
            p["iplTeam"] = s["iplTeam"]
            p["role"] = s["role"]
            p["nationality"] = s["nationality"]

    pool = sorted(pool_by_id.values(), key=lambda x: x["id"])

    for p in players_file["players"]:
        pid = p["id"]
        if pid not in sheet:
            continue
        s = sheet[pid]
        bad: list[str] = []
        if p.get("iplTeam") != s["iplTeam"]:
            bad.append(f"iplTeam json={p.get('iplTeam')} sheet={s['iplTeam']}")
        if p.get("role") != s["role"]:
            bad.append(f"role json={p.get('role')} sheet={s['role']}")
        if p.get("nationality") != s["nationality"]:
            bad.append(f"nationality json={p.get('nationality')} sheet={s['nationality']}")
        if bad:
            print(f"WARN players.json[{pid}]: {', '.join(bad)}")

    out_path = DATA / "waiver-pool.json"
    payload = {
        "source": "espncricinfo-ipl-2026-squads",
        "sourceNote": "Merged with scripts/ipl2026_league_sheet.pipe (auction roles/teams/nationality). ESPN cache: scripts/espn_ipl2026_squads.md. Excludes franchise-owned players; players in players.json are omitted except POOL_ALSO_FROM_PLAYERS_JSON (also in waiver catalog).",
        "players": pool,
    }
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(pool)} players to {out_path}")


if __name__ == "__main__":
    main()
