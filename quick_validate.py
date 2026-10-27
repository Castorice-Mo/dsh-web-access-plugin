#!/usr/bin/env python3
"""Manifest and contract checks for the dsh-web-access bundle.

Every check corresponds to a failure this repository has actually produced, so
a green run means those specific regressions are absent:

* ``package.json`` ``files`` / ``exports`` naming a path that no longer exists
  (the first release listed PLUG.md and agents/openai.yaml before they existed).
* a tool ``parameters`` block losing ``type: "object"``, which the model API
  rejects with INVALID_REQUEST / "got 'type: null'" and fails the whole turn.
* configuration defaults drifting away from the documented table.
* documentation quietly acquiring a personal absolute path.

Standard library only, no third-party dependency. Exit code 1 on any failure.

Usage:  python quick_validate.py
"""

from __future__ import annotations

import glob
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FAILURES: list[str] = []
CHECKS = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global CHECKS
    CHECKS += 1
    if ok:
        print(f"PASS  {name}")
    else:
        print(f"FAIL  {name}{('  ->  ' + detail) if detail else ''}")
        FAILURES.append(name)


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def resolves(pattern: str) -> list[str]:
    """Resolve one manifest path, glob or directory, relative to the package root."""
    target = ROOT / pattern
    if target.exists():
        return [str(target.relative_to(ROOT))]
    return [str(Path(hit).relative_to(ROOT)) for hit in glob.glob(str(target))]


def main() -> int:
    manifest = json.loads(read("package.json"))

    # --- 1. required manifest fields -------------------------------------
    required = ["name", "version", "description", "license", "type", "exports", "files"]
    missing = [key for key in required if not manifest.get(key)]
    check("package.json has required fields", not missing, f"missing: {', '.join(missing)}")

    dsh = manifest.get("dsh") or {}
    check(
        "package.json declares dsh.bundle.patch and dsh.client",
        bool((dsh.get("bundle") or {}).get("patch")) and bool(dsh.get("client")),
        "both are required for a bundle with a browser half",
    )

    # --- 2. every declared file exists -----------------------------------
    for pattern in manifest.get("files", []):
        check(f"files entry resolves: {pattern}", bool(resolves(pattern)))

    # --- 3. every export target exists -----------------------------------
    for key, value in (manifest.get("exports") or {}).items():
        check(f"export {key} resolves", bool(resolves(value)), value)

    # --- 4. the patch row matches the package ----------------------------
    patch_path = (dsh.get("bundle") or {}).get("patch")
    patch_text = read(patch_path.lstrip("./"))
    row_names = re.findall(r"^\s*-\s*id:\s*(\S+)\s*$", patch_text, re.M)
    bundled = re.findall(r"^\s+name:\s*'?([^'\n]+)'?\s*$", patch_text, re.M)
    check("patch inserts at least one row", bool(row_names), patch_path)
    check(
        "patch row name equals the package name",
        manifest["name"] in bundled,
        f"expected {manifest['name']}, found {bundled}",
    )

    # --- 5. configuration keys exist in the implementation ---------------
    index_text = read("index.js")
    defaults_block = re.search(r"const DEFAULTS = \{([\s\S]*?)\n\}", index_text)
    check("index.js declares DEFAULTS", bool(defaults_block))
    defaults = set(
        re.findall(r"^\s{2}(\w+):", defaults_block.group(1), re.M) if defaults_block else []
    )
    patch_config_keys = set(
        re.findall(r"^\s{8}([a-zA-Z]\w*):", patch_text, re.M)
    )
    unknown = patch_config_keys - defaults
    check(
        "patch config only uses known keys",
        not unknown,
        f"unknown: {', '.join(sorted(unknown))}",
    )

    # --- 6. documented defaults match the code ---------------------------
    readme = read("README.md")
    undocumented = [key for key in sorted(defaults) if f"`{key}`" not in readme]
    check(
        "every default is documented in README",
        not undocumented,
        f"missing: {', '.join(undocumented)}",
    )

    # --- 7. tool parameters are object-rooted JSON Schema ----------------
    blocks = re.findall(r"parameters:\s*\{(.{0,400}?)\n\s*},", index_text, re.S)
    check("index.js declares two tool parameter blocks", len(blocks) == 2, f"found {len(blocks)}")
    for number, block in enumerate(blocks, start=1):
        check(
            f"tool parameters #{number} is an object schema",
            re.search(r"type:\s*'object'", block) is not None,
            "must contain type: 'object' or the model API rejects the request",
        )

    # --- 8. agent descriptor names real tools ----------------------------
    agent_yaml = read("agents/openai.yaml")
    declared_tools = set(re.findall(r"^\s+tool:\s*(\S+)\s*$", agent_yaml, re.M))
    registered = set(re.findall(r"^const (?:SEARCH|FETCH)_TOOL = '([^']+)'", index_text, re.M))
    check("agents/openai.yaml names at least one tool", bool(declared_tools))
    check(
        "every tool in agents/openai.yaml is registered in index.js",
        declared_tools <= registered,
        f"unknown: {', '.join(sorted(declared_tools - registered))}",
    )

    # --- 9. locale resources carry display metadata ----------------------
    for locale in sorted((ROOT / "locale").glob("*.json")):
        meta = json.loads(locale.read_text(encoding="utf-8")).get("meta") or {}
        check(
            f"locale {locale.name} has meta.title and meta.description",
            bool(meta.get("title")) and bool(meta.get("description")),
        )

    # --- 10. no personal absolute paths in documentation -----------------
    private_markers = ["C:\\Users\\", "/home/", "/Users/"]
    for doc in ["README.md", "PLUG.md", "agents/openai.yaml"]:
        text = read(doc)
        leaked = [marker for marker in private_markers if marker in text]
        check(f"{doc} has no personal absolute path", not leaked, f"found: {', '.join(leaked)}")

    # --- 11. licence file agrees with the manifest -----------------------
    licence = manifest.get("license", "")
    licence_file = ROOT / "LICENSE"
    check("LICENSE file exists", licence_file.exists())
    if licence_file.exists() and licence:
        check(
            f"LICENSE text matches {licence}",
            licence.lower() in licence_file.read_text(encoding="utf-8").lower(),
        )

    print()
    if FAILURES:
        print(f"{len(FAILURES)} of {CHECKS} checks failed.")
        return 1
    print(f"All {CHECKS} checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
