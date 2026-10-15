"""Repair Codacy's null rule arrays without accepting missing scan results."""

import json
from pathlib import Path
import sys


def normalize(report):
    """Keep findings intact and reject reports from failed or missing scans."""
    if report.get("version") != "2.1.0":
        raise ValueError("Expected a SARIF 2.1.0 report")
    runs = report.get("runs")
    if not isinstance(runs, list) or not runs:
        raise ValueError("No SARIF runs found; check the Codacy scanner log")

    for run in runs:
        driver = run["tool"]["driver"]
        if not driver.get("name"):
            raise ValueError("SARIF run is missing its tool name")
        for invocation in run.get("invocations", []):
            if invocation.get("executionSuccessful") is False:
                raise ValueError("SARIF reports an unsuccessful scanner invocation")
        # Codacy discards rule definitions. Keep rule IDs, but remove indexes
        # that would otherwise point into the now-empty rules array.
        if driver.get("rules") is None:
            driver["rules"] = []
            for result in run.get("results", []):
                if "ruleIndex" in result:
                    if not result.get("ruleId"):
                        raise ValueError("Cannot recover a finding without its rule ID")
                    del result["ruleIndex"]
    return report


if __name__ == "__main__":
    path = Path(sys.argv[1])
    data = normalize(json.loads(path.read_text(encoding="utf-8")))
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
