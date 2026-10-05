"""Read a supplied form workbook into a private documentary API packet.

The workbook, directory and PDF are never rewritten. Constant text formulas are
decoded, not executed. Exactly approved source-ID corrections are annotated.
No personnel, qualifications, preferences or awards are changed by this tool.
Requires openpyxl in the bundled document runtime. Outputs must stay private.
"""

import argparse
import csv
import hashlib
import json
import re
import sqlite3
from pathlib import Path

import openpyxl


FORM_HEADERS = (
    ("Name", "Employee ID", "Rank", "Attending Teams", "Phone #1", "Phone #2", "Shift", "Unit", "Shift2", "Unit2", "Shift3", "Unit3", "A-Day Preference #1", "A-Day Preference #2", "A-Day Preference #3", "A-Day Preference #4"),
    ("Name", "Employee ID", "Rank", "Teams?", "Phone #1", "Phone #2", "Shift", "Unit", "Shift2", "Unit3", "Shift4", "Unit5", "A-Day  #1", "A-Day  #2", "A-Day  #3", "A-Day #4"),
)


def form_sheet(book):
    """Recognize one supported export by its complete, ordered row-two schema."""
    matches = [sheet for sheet in book
               if tuple(cell.value for cell in next(sheet.iter_rows(min_row=2, max_row=2), ())) in FORM_HEADERS]
    if len(matches) != 1:
        raise ValueError("Expected exactly one sheet with supported form headers")
    return matches[0]


def normalized(value):
    return "".join(c for c in value.casefold() if c.isalnum())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_literal(cell):
    if cell.data_type != "f":
        return str(cell.value).strip() if cell.value is not None else ""
    match = re.fullmatch(r'=\s*"((?:[^"]|"")*)"\s*', cell.value)
    if not match:
        raise ValueError(f"Unsupported formula at {cell.coordinate}; no formulas were executed.")
    return match.group(1).replace('""', '"').strip()


def build_packet(args):
    workbook = Path(args.workbook)
    directory_path = Path(args.directory)
    resolutions_path = Path(args.identity_resolutions)
    workbook_sha = digest(workbook)
    with directory_path.open(encoding="utf-8-sig", newline="") as stream:
        directory = list(csv.DictReader(stream))
    # Read the independently verified backup into an isolated in-memory database.
    db = sqlite3.connect(":memory:")
    db.executescript(Path(args.canonical_backup).read_text(encoding="utf-8-sig"))
    canonical = [dict(zip(["id", "employeeId", "firstName", "lastName", "rank"], row)) for row in db.execute("SELECT id,employee_id,first_name,last_name,rank FROM members")]
    rank_codes = {"Firefighter": "FF", "Lieutenant": "LT", "Captain": "CPT", "Division Chief": "DC"}
    resolution_source = json.loads(resolutions_path.read_text(encoding="utf-8-sig"))
    if resolution_source.get("source", workbook.name) != workbook.name:
        raise ValueError("Approved identity resolutions are for a different workbook")
    if resolution_source.get("sourceSha256", workbook_sha) != workbook_sha:
        raise ValueError("Approved identity resolutions do not match this workbook hash")
    resolutions = resolution_source["rows"]
    resolved_by_row = {row["sourceRow"]: row for row in resolutions}
    if len(resolved_by_row) != len(resolutions):
        raise ValueError("Duplicate approved resolution rows")
    book = openpyxl.load_workbook(workbook, read_only=True, data_only=False)
    sheet = form_sheet(book)
    forms = []
    applied = set()
    for row in sheet.iter_rows(min_row=3):
        values = [read_literal(cell) for cell in row]
        if not any(values):
            continue
        source_row = row[0].row
        employee_id = values[1]
        if not employee_id:
            raise ValueError(f"Missing employee ID in source row {source_row}")
        effective_id = employee_id
        approved = resolved_by_row.get(source_row)
        if approved:
            if (approved["sourceEmployeeId"] != employee_id or approved["sourceName"] != values[0]
                    or approved.get("sourceRank", values[2]) != values[2]):
                raise ValueError(f"Approved correction does not match original source row {source_row}")
            effective_id = approved["resolvedEmployeeId"]
        matches = [member for member in canonical if member["employeeId"] == effective_id
                   and normalized(member["lastName"] + member["firstName"]) == normalized(values[0])
                   and member["rank"] == rank_codes.get(values[2])]
        directory_matches = [(index + 2, member) for index, member in enumerate(directory)
                             if member["Employee ID"].strip() == effective_id and member["Rank / Position"].strip() == values[2]]
        if len(matches) != 1 or (approved and len(directory_matches) != 1):
            raise ValueError(f"Source row {source_row} lacks one authoritative ID/name/rank link")
        if approved:
            directory_row, directory_member = directory_matches[0]
            if normalized(directory_member["Name"]) != normalized(values[0]):
                raise ValueError(f"Approved correction lacks exact directory name at source row {source_row}")
        form = {"employeeId": employee_id, "sourceName": values[0], "sourceRank": values[2],
                "attendingTeams": values[3], "phone1": values[4] or None, "phone2": values[5] or None,
                "positionPreferences": [{"order": n + 1, "shift": values[6 + n * 2], "unit": values[7 + n * 2]} for n in range(3)],
                "aDayPreferences": [], "sourceLocation": {"sheet": sheet.title, "row": source_row}}
        for n in range(4):
            label = values[12 + n]
            group = re.fullmatch(r"([ABC]) Group ([1-4])", label)
            weekday = re.fullmatch(r"Days - (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)", label)
            if not group and not weekday:
                raise ValueError(f"Unrecognized A-Day label at source row {source_row}")
            form["aDayPreferences"].append({"order": n + 1, "sourceLabel": label,
                "shift": group.group(1) if group else "D", "group": "G" + group.group(2) if group else None})
        if approved:
            applied.add(source_row)
            form["identityResolution"] = {"employeeId": effective_id, "method": "AUTHORITATIVE_DIRECTORY_CORRECTION",
                "source": {"name": directory_path.name, "sha256": digest(directory_path)},
                "sourceLocation": f"CSV row {directory_row}; independently confirmed by canonical directory",
                "discrepancy": f"Submitted employee ID {employee_id}; linked to employee ID {effective_id} using the authoritative directory's exact name and rank. Original submission retained."}
        forms.append(form)
    if applied != set(resolved_by_row):
        raise ValueError("Not every approved correction was applied")
    not_submitted = []
    # A final activity export may contain submissions only. Absence is unknown,
    # not an assertion that a member failed to submit a form.
    non_submission_rows = book["DID NOT SUBMIT"].iter_rows() if "DID NOT SUBMIT" in book.sheetnames else ()
    for row in non_submission_rows:
        source_name = read_literal(row[0])
        if not source_name:
            continue
        matches = []
        for member in canonical:
            if normalized(member["firstName"] + member["lastName"]) == normalized(source_name):
                matches.append(member)
        if len(matches) != 1:
            raise ValueError(f"Unlinked not-submitted name at row {row[0].row}")
        not_submitted.append({"employeeId": matches[0]["employeeId"], "sourceName": source_name,
                              "sourceLocation": {"sheet": "DID NOT SUBMIT", "row": row[0].row}})
    form_ids = [f.get("identityResolution", {}).get("employeeId", f["employeeId"]) for f in forms]
    not_ids = [row["employeeId"] for row in not_submitted]
    if len(set(form_ids)) != len(form_ids) or len(set(not_ids)) != len(not_ids) or set(form_ids) & set(not_ids):
        raise ValueError("Resolved source identity overlap or duplicate")
    packet = {"v": 1, "year": args.year, "source": {"name": workbook.name, "sha256": workbook_sha},
              "forms": forms, "notSubmitted": not_submitted, "unlinkedNotSubmitted": []}
    if args.air_tech_rows:
        metadata = json.loads(Path(args.air_tech_metadata).read_text(encoding="utf-8-sig"))
        rows = json.loads(Path(args.air_tech_rows).read_text(encoding="utf-8-sig"))
        references = []
        for row in rows:
            employee_id = str(row["employeeId"])
            matches = [m for m in canonical if m["employeeId"] == employee_id
                       and normalized(m["lastName"] + m["firstName"]) == normalized(row["names"])
                       and m["rank"] == "FF"]
            if len(matches) != 1 or len(row["values"]) != 8:
                raise ValueError(f"Unlinked Air Tech source order {row['order']}")
            fields = ["driverEngineerPoints", "airTechPoints", "carSeatPoints", "dronePoints", "operationsPoints", "technicianPoints", "totalPoints", "rankSeniority"]
            reference = {"employeeId": employee_id, "sourceMemberName": row["names"], "bidOrder": row["order"],
                         **dict(zip(fields, row["values"])), "generatedAt": args.air_tech_generated_at,
                         "sourceName": Path(metadata["path"]).name, "sourceSha256": metadata["sha256"]}
            references.append(reference)
        if len({r["employeeId"] for r in references}) != len(references):
            raise ValueError("Duplicate Air Tech employee IDs")
        packet["airTechReferences"] = references
    book.close()
    db.close()
    return packet


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--canonical-backup", required=True)
    parser.add_argument("--identity-resolutions", required=True)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--air-tech-rows")
    parser.add_argument("--air-tech-metadata")
    parser.add_argument("--air-tech-generated-at")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.air_tech_rows and (not args.air_tech_metadata or not args.air_tech_generated_at):
        parser.error("Air Tech rows require metadata and the source's printed generation date")
    packet = build_packet(args)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(packet, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"submittedForms": len(packet["forms"]), "notSubmitted": len(packet["notSubmitted"]),
                      "explicitIdentityCorrections": sum("identityResolution" in form for form in packet["forms"]),
                      "airTechReferences": len(packet.get("airTechReferences", [])), "sourceSha256": packet["source"]["sha256"],
                      "outputIsPrivateSourcePacket": True}))


if __name__ == "__main__":
    main()
