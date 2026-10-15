"""Regression tests for Codacy SARIF output accepted by GitHub code scanning."""

from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "normalize_sarif", Path(__file__).with_name("normalize-sarif.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def report(rules, results):
    return {
        "version": "2.1.0",
        "runs": [{"tool": {"driver": {"name": "test", "rules": rules}}, "results": results}],
    }


class NormalizeSarifTests(unittest.TestCase):
    def test_preserves_valid_findings_and_rule_indexes(self):
        data = report([{"id": "test-rule"}], [{"ruleId": "test-rule", "ruleIndex": 0}])
        self.assertEqual(MODULE.normalize(deepcopy(data)), data)

    def test_repairs_null_rules_without_losing_findings(self):
        finding = {"ruleId": "test-rule", "ruleIndex": 4, "message": {"text": "Finding"}}
        data = MODULE.normalize(report(None, [finding]))
        self.assertEqual(data["runs"][0]["tool"]["driver"]["rules"], [])
        self.assertEqual(data["runs"][0]["results"], [
            {"ruleId": "test-rule", "message": {"text": "Finding"}}
        ])

    def test_accepts_successful_scan_without_findings(self):
        data = MODULE.normalize(report(None, []))
        self.assertEqual(data["runs"][0]["results"], [])

    def test_rejects_absent_or_empty_runs(self):
        for runs in [None, [], {}]:
            with self.subTest(runs=runs), self.assertRaises(ValueError):
                MODULE.normalize({"version": "2.1.0", "runs": runs})

    def test_rejects_failed_scanner(self):
        data = report([], [])
        data["runs"][0]["invocations"] = [{"executionSuccessful": False}]
        with self.assertRaises(ValueError):
            MODULE.normalize(data)

    def test_rejects_unrecoverable_rule_reference(self):
        with self.assertRaises(ValueError):
            MODULE.normalize(report(None, [{"ruleIndex": 2}]))

    def test_normalizes_all_runs(self):
        data = report(None, [])
        data["runs"].append(deepcopy(data["runs"][0]))
        self.assertTrue(all(
            run["tool"]["driver"]["rules"] == []
            for run in MODULE.normalize(data)["runs"]
        ))


if __name__ == "__main__":
    unittest.main()
