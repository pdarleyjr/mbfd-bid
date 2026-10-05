"""Run with the document runtime: python -m unittest discover -s scripts/tests."""

import csv
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "extract_bid_form_source", Path(__file__).resolve().parents[1] / "extract-bid-form-source.py"
)
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


class Cell:
    def __init__(self, value, row, column):
        self.value = value
        self.row = row
        self.coordinate = f"{chr(64 + column)}{row}"
        self.data_type = "f" if isinstance(value, str) and value.startswith("=") else "s"


class Sheet:
    def __init__(self, title, rows):
        self.title = title
        self.rows = [[Cell(value, n, c) for c, value in enumerate(row, 1)] for n, row in enumerate(rows, 1)]

    def iter_rows(self, min_row=1, max_row=None):
        return iter(self.rows[min_row - 1:max_row])


class Book:
    def __init__(self, sheets):
        self.sheets = {s.title: s for s in sheets}
        self.sheetnames = list(self.sheets)

    def __iter__(self):
        return iter(self.sheets.values())

    def __getitem__(self, title):
        return self.sheets[title]

    def close(self):
        pass


def submitted_row(employee_id='=" 1001"', name="Member,Test", rank=" Firefighter"):
    return [name, employee_id, rank, "Yes", None, None,
            "A", "First unit", "C", "Second unit", "B", "Third unit",
            "A Group 4", "C Group 2", "B Group 1", "Days - Monday"]


class ExtractBidFormSourceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.workbook = self.folder / "final-source.xlsx"
        self.workbook.write_bytes(b"immutable source fixture")
        self.directory = self.folder / "directory.csv"
        with self.directory.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=["Employee ID", "Name", "Rank / Position"])
            writer.writeheader()
            writer.writerow({"Employee ID": "1001", "Name": "Member, Test", "Rank / Position": "Firefighter"})
            writer.writerow({"Employee ID": "1002", "Name": "Other, Member", "Rank / Position": "Captain"})
        self.backup = self.folder / "canonical.sql"
        self.backup.write_text("CREATE TABLE members(id,employee_id,first_name,last_name,rank);\n"
                               "INSERT INTO members VALUES(1,'1001','Test','Member','FF');\n"
                               "INSERT INTO members VALUES(2,'1002','Member','Other','CPT');\n", encoding="utf-8")
        self.resolutions = self.folder / "resolutions.json"
        self.set_resolutions([])
        self.args = SimpleNamespace(workbook=str(self.workbook), directory=str(self.directory),
                                    canonical_backup=str(self.backup), identity_resolutions=str(self.resolutions),
                                    year=2026, air_tech_rows=None)

    def set_resolutions(self, rows, **changes):
        document = {"source": self.workbook.name, "sourceSha256": hashlib.sha256(self.workbook.read_bytes()).hexdigest(),
                    "rows": rows, **changes}
        self.resolutions.write_text(json.dumps(document), encoding="utf-8")

    def packet(self, schema=1, rows=None, extra_sheets=None):
        sheet = Sheet("Oct_05_2026_custom_activity_351" if schema else "Bid Forms ",
                      [["Export"], extract.FORM_HEADERS[schema], *(rows or [submitted_row()])])
        with patch.object(extract.openpyxl, "load_workbook", return_value=Book([sheet, *(extra_sheets or [])])):
            return extract.build_packet(self.args)

    def test_both_schemas_preserve_order_and_final_absence_is_unknown(self):
        for schema in (0, 1):
            with self.subTest(schema=schema):
                packet = self.packet(schema)
                self.assertEqual(len(packet["forms"]), 1)
                form = packet["forms"][0]
                self.assertEqual(form["employeeId"], "1001")
                self.assertEqual(form["positionPreferences"], [
                    {"order": 1, "shift": "A", "unit": "First unit"},
                    {"order": 2, "shift": "C", "unit": "Second unit"},
                    {"order": 3, "shift": "B", "unit": "Third unit"}])
                self.assertEqual([a["group"] for a in form["aDayPreferences"]], ["G4", "G2", "G1", None])
                self.assertEqual(form["sourceLocation"]["row"], 3)
                self.assertEqual(packet["notSubmitted"], [])
                self.assertEqual(packet["unlinkedNotSubmitted"], [])

    def test_legacy_explicit_non_submission_still_links(self):
        packet = self.packet(0, extra_sheets=[Sheet("DID NOT SUBMIT", [["Member Other"]])])
        self.assertEqual(packet["notSubmitted"], [{"employeeId": "1002", "sourceName": "Member Other",
                                                  "sourceLocation": {"sheet": "DID NOT SUBMIT", "row": 1}}])

    def test_only_constant_text_formulas_are_decoded(self):
        self.assertEqual(extract.read_literal(Cell('="He said ""Yes"""', 3, 1)), 'He said "Yes"')
        for formula in ('=SUM(1,2)', '=HYPERLINK("https://example.invalid","open")', '=A1', '=WEBSERVICE("https://example.invalid")'):
            with self.subTest(formula=formula), self.assertRaisesRegex(ValueError, "Unsupported formula"):
                extract.read_literal(Cell(formula, 3, 1))

    def test_header_order_and_ambiguous_export_are_rejected(self):
        modified = list(extract.FORM_HEADERS[1])
        modified[6], modified[7] = modified[7], modified[6]
        invalid = Sheet("Export", [["Export"], modified])
        with self.assertRaisesRegex(ValueError, "exactly one"):
            extract.form_sheet(Book([invalid]))
        supported = [Sheet(title, [["Export"], extract.FORM_HEADERS[n]]) for n, title in enumerate(("Old", "New"))]
        with self.assertRaisesRegex(ValueError, "exactly one"):
            extract.form_sheet(Book(supported))

    def test_identity_requires_matching_source_id_name_and_canonical_rank(self):
        for values in (submitted_row("1002"), submitted_row(name="Other,Person"), submitted_row(rank="Captain")):
            with self.subTest(values=values[:3]), self.assertRaisesRegex(ValueError, "authoritative ID/name/rank"):
                self.packet(rows=[values])

    def test_correction_retains_original_and_is_bound_to_current_source(self):
        correction = {"sourceRow": 3, "sourceEmployeeId": "wrong-id", "sourceName": "Member,Test",
                      "sourceRank": "Firefighter", "resolvedEmployeeId": "1001"}
        self.set_resolutions([correction])
        form = self.packet(rows=[submitted_row("wrong-id")])["forms"][0]
        self.assertEqual(form["employeeId"], "wrong-id")
        self.assertEqual(form["identityResolution"]["employeeId"], "1001")
        self.assertIn("Original submission retained", form["identityResolution"]["discrepancy"])
        for changes in ({"source": "old-source.xlsx"}, {"sourceSha256": "0" * 64}):
            self.set_resolutions([correction], **changes)
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, "different workbook|workbook hash"):
                self.packet(rows=[submitted_row("wrong-id")])
        for field, value in (("sourceRow", 4), ("sourceEmployeeId", "different"), ("sourceName", "Other,Member"), ("sourceRank", "Captain")):
            self.set_resolutions([{**correction, field: value}])
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.packet(rows=[submitted_row("wrong-id")])

    def test_duplicate_resolved_forms_and_overlap_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "identity overlap or duplicate"):
            self.packet(rows=[submitted_row(), submitted_row()])
        with self.assertRaisesRegex(ValueError, "identity overlap or duplicate"):
            self.packet(extra_sheets=[Sheet("DID NOT SUBMIT", [["Test Member"]])])


if __name__ == "__main__":
    unittest.main()
