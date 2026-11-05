"""WP0 spike: check a LiteLLM pin against known-bad PyPI releases.

Usage: python3 check.py [version ...]   (defaults to the vendor-stated safe pin, 1.106.2)
Exit 1 if any checked version is listed as compromised or is missing on PyPI.
Advisory data is hand-entered from public reports dated 2026-03-24 and 2026-10-21; re-verify
against LiteLLM's own incident post before relying on it.
"""
import json
import sys
import urllib.error
import urllib.request

COMPROMISED = {
    "1.82.7": "Mar 2026 incident (TeamPCP), credential stealer",
    "1.82.8": "Mar 2026 incident (TeamPCP), credential stealer",
    "1.107.0": "Oct 21 2026 incident, credential stealer; vendor says pin to 1.106.2 or earlier",
}
DEFAULT = ["1.106.2"]  # the vendor-stated safe pin


def pypi(version):
    url = f"https://pypi.org/pypi/litellm/{version}/json"
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.load(r)
        return data["urls"][0]["upload_time"] if data["urls"] else "no files"
    except urllib.error.HTTPError as err:
        return f"HTTP {err.code} (removed or never published)"


bad = False
for v in (sys.argv[1:] or DEFAULT):
    status = pypi(v)
    note = COMPROMISED.get(v, "")
    # PyPI removes compromised releases, so a pin that is gone is caught even before the list above is updated.
    if not note and status.startswith("HTTP"):
        note = f"not downloadable from PyPI ({status})"
    if note:
        bad = True
    print(f"{v:10} pypi={status:32} {'COMPROMISED: ' + note if note else 'not on the advisory list'}")
sys.exit(1 if bad else 0)
