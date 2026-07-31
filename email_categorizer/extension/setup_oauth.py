#!/usr/bin/env python3
"""
setup_oauth.py
==============
Automates the Google Cloud side of configuring Gmail OAuth for the
Inbox Categorizer Chrome extension, then patches manifest.json with the
real client ID.

What this script automates:
  1. Verifies the Google Cloud CLI (gcloud) is installed and authenticated.
  2. Creates a new Google Cloud project (or reuses an existing one).
  3. Enables the Gmail API on that project.
  4. Opens the exact Google Cloud Console pages needed for the one step
     Google does NOT expose to any CLI or public REST API: creating the
     "OAuth client ID" (Chrome Extension type).
  5. Collects the finished client ID from you and patches manifest.json.

Why step 4 is interactive:
  Google deliberately does not offer a gcloud command or public REST API
  for creating Google-API OAuth client IDs. Only the Google Cloud Console
  can create them. This script removes every other manual step and makes
  the final one a copy-paste.

Usage:
  python3 setup_oauth.py
"""

import json
import os
import random
import re
import string
import subprocess
import sys
import webbrowser
from pathlib import Path

PLACEHOLDER_MARKERS = ("YOUR_", "YOUR_CLIENT_ID", "YOUR_GOOGLE_CLIENT_ID")
EXTENSION_ID_RE = re.compile(r"^[a-p]{32}$")
PROJECT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{5,29}$")
CLIENT_ID_RE = re.compile(r"^[0-9]{6,}-[A-Za-z0-9_-]{10,}\.apps\.googleusercontent\.com$")
CLIENT_ID_KEY_RE = re.compile(r'("client_id"\s*:\s*")[^"]*(")')

# Relative locations of the extension manifest, tried against both the
# current directory and the directory this script lives in.
MANIFEST_CANDIDATES = [
    "manifest.json",
    "extension/manifest.json",
    "email_categorizer/extension/manifest.json",
]

GMAIL_API = "gmail.googleapis.com"


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
def info(msg):
    print(f"[INFO] {msg}")


def ok(msg):
    print(f"[ OK ] {msg}")


def warn(msg):
    print(f"[WARN] {msg}")


def fail(msg):
    print(f"[FAIL] {msg}")


def banner(msg):
    print()
    print("=" * 70)
    print("  " + msg)
    print("=" * 70)


# ---------------------------------------------------------------------------
# gcloud helpers
# ---------------------------------------------------------------------------
def run_gcloud(args, check=True, passthrough=False):
    """Run a gcloud command. Returns stdout when capture mode is used."""
    cmd = ["gcloud"] + args
    if passthrough:
        code = subprocess.call(cmd)
        if check and code != 0:
            raise RuntimeError(f"gcloud {' '.join(args)} exited with code {code}")
        return ""
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"gcloud {' '.join(args)} failed")
    return proc.stdout.strip()


def check_gcloud():
    if not _which("gcloud"):
        fail("The Google Cloud CLI (gcloud) was not found.")
        print()
        print("  Install it from: https://cloud.google.com/sdk/docs/install")
        print()
        print("  Quick install (Linux/macOS):")
        print("    curl https://sdk.cloud.google.com | bash")
        print("    exec -l $SHELL          # refresh your shell")
        print("    gcloud init             # log in once")
        print()
        print("  On Windows, use the Cloud SDK installer instead:")
        print("    https://cloud.google.com/sdk/docs/install#windows")
        return False
    return True


def _which(name):
    for path in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(path) / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def ensure_authenticated():
    active = run_gcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"], check=False)
    if active:
        ok(f"Authenticated as {active.splitlines()[0]}")
        return

    warn("No active gcloud credentials found. Opening the browser to sign in...")
    print("  (If the browser does not open, run 'gcloud auth login' yourself.)")
    run_gcloud(["auth", "login"], check=True, passthrough=True)

    active = run_gcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"], check=False)
    if not active:
        raise RuntimeError("Authentication failed. Run 'gcloud auth login' and try again.")


def current_project():
    return run_gcloud(["config", "get-value", "project"], check=False)


def list_projects():
    raw = run_gcloud(["projects", "list", "--format=value(projectId)"], check=False)
    return [line.strip() for line in raw.splitlines() if line.strip()]


def choose_or_create_project():
    banner("GOOGLE CLOUD PROJECT")

    default = current_project()
    if default:
        answer = input(f"Use the current gcloud project '{default}'? [Y/n] ").strip().lower()
        if answer in ("", "y", "yes"):
            ok(f"Using existing project: {default}")
            return default

    existing = list_projects()
    if existing:
        print()
        print("  Existing projects:")
        for pid in existing:
            print(f"    - {pid}")

    print()
    print("  Enter an existing project ID, or press Enter to create a new one.")
    suggestion = _suggest_project_id()
    print(f"  (Suggestion for a new project: {suggestion})")
    raw = input("  Project ID: ").strip() or suggestion

    while not PROJECT_ID_RE.match(raw):
        warn(f"'{raw}' is not a valid project ID (6-30 chars, lowercase letters/digits/hyphens, starts with a letter).")
        raw = input("  Project ID: ").strip() or suggestion

    pid = raw
    if pid in existing:
        ok(f"Using existing project: {pid}")
        return pid

    info(f"Creating project '{pid}'...")
    run_gcloud(["projects", "create", pid, "--name=Mail Man"], check=True)
    run_gcloud(["config", "set", "project", pid], check=True)
    ok(f"Created and activated project: {pid}")
    return pid


def _suggest_project_id():
    return f"mail-man-{''.join(random.choices(string.digits, k=4))}"


def enable_gmail_api(project_id):
    info(f"Enabling the Gmail API on project '{project_id}'...")
    run_gcloud(["services", "enable", GMAIL_API, "--project=" + project_id], check=True)
    ok("Gmail API enabled")


# ---------------------------------------------------------------------------
# Manifest handling
# ---------------------------------------------------------------------------
def find_manifest():
    bases = [Path.cwd(), Path(__file__).resolve().parent]
    for base in bases:
        for rel in MANIFEST_CANDIDATES:
            candidate = base / rel
            if candidate.is_file():
                return candidate
    return None


def read_manifest(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def manifest_placeholder(text):
    """Extract the current client_id and return it if it is a placeholder."""
    match = re.search(r'"client_id"\s*:\s*"([^"]*)"', text)
    if not match:
        return None
    value = match.group(1)
    if any(marker in value for marker in PLACEHOLDER_MARKERS):
        return value
    return None


def patch_manifest(path, client_id):
    path = Path(path)
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()

    def _replace(match):
        return match.group(1) + client_id + match.group(2)

    new_text, count = CLIENT_ID_KEY_RE.subn(_replace, text, count=1)
    if count == 0:
        raise RuntimeError("Could not locate the 'client_id' key in the manifest.")

    # Safety check: the result must still be valid JSON.
    json.loads(new_text)

    backup = path.with_suffix(path.suffix + ".bak")
    if not backup.exists():
        import shutil
        shutil.copy2(path, backup)
        ok(f"Backed up original manifest to {backup}")

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(new_text)

    manifest = read_manifest(path)
    ok(f"Patched manifest: oauth2.client_id = {manifest['oauth2']['client_id']}")


# ---------------------------------------------------------------------------
# Interactive guidance for the Console-only step
# ---------------------------------------------------------------------------
def configure_consent_screen(project_id):
    banner("OAuth CONSENT SCREEN (step 1 of the manual step)")
    print("""
  Before Chrome will accept a Google sign-in, the project needs an OAuth
  consent screen. The browser will open the right page now. In the console:
    1. User type: External  ->  Create
    2. App name:   Inbox Categorizer
    3. Support email: choose any address you control
    4. Save (leave the rest blank)

  Then, on the 'Audience' tab, make sure your own Gmail address is listed
  under 'Test users' (the app stays in Testing mode, which is fine for
  personal use).
""")
    webbrowser.open(f"https://console.cloud.google.com/apis/credentials/consent?project={project_id}")
    input("  Press Enter here once you have saved the consent screen...")
    ok("Consent screen configured")


def collect_client_id(project_id, extension_id):
    banner("CREATE THE OAUTH CLIENT ID (step 2 of the manual step)")
    print(f"""
  The browser will open the Credentials page. In the console:
    1. Click '+ Create Credentials'  ->  'OAuth client ID'
    2. Application type: Chrome Extension
    3. Name: Inbox Categorizer
    4. Application ID: {extension_id}
    5. Click 'Create'

  Copy the client ID that appears (looks like
  123456789012-abcdefghijklmnop.apps.googleusercontent.com) and paste it
  below.
""")
    webbrowser.open(f"https://console.cloud.google.com/apis/credentials?project={project_id}")

    while True:
        raw = input("  OAuth client ID: ").strip()
        if not CLIENT_ID_RE.match(raw):
            warn("That does not look like a Google OAuth client ID (it must end with .apps.googleusercontent.com).")
            retry = input("  Try again [y] / continue anyway [c]? ").strip().lower()
            if retry.startswith("c"):
                return raw
            continue
        return raw


def prompt_extension_id():
    banner("EXTENSION ID")
    print("""
  Chrome generates the extension ID when you load the extension unpacked.
  It is NOT stored in the project files, so it cannot be read from disk.

  Do this once:
    1. Open chrome://extensions
    2. Enable 'Developer mode' (top right)
    3. Click 'Load unpacked' and select the folder:
         {ext_dir}
    4. Copy the 32-character ID shown under 'Inbox Categorizer'

  Note: moving the extension folder will change its ID. Keep it in place.
""".format(ext_dir=_extension_dir_hint()))
    while True:
        ext_id = input("  Extension ID: ").strip().lower()
        if EXTENSION_ID_RE.match(ext_id):
            return ext_id
        warn("Extension IDs are exactly 32 lowercase letters (a-p). Please copy it again.")


def _extension_dir_hint():
    manifest = find_manifest()
    if manifest:
        return str(manifest.parent.resolve())
    return "the 'extension' folder of this project"


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------
def main():
    print()
    print("Inbox Categorizer - Gmail OAuth setup")
    print("-------------------------------------")

    # 1. Locate the manifest.
    manifest_path = find_manifest()
    if manifest_path is None:
        fail("Could not find manifest.json.")
        print("  Looked for:", ", ".join(MANIFEST_CANDIDATES))
        print("  Run this script from the project root.")
        sys.exit(1)
    info(f"Manifest found: {manifest_path}")

    manifest = read_manifest(manifest_path)
    current = manifest_placeholder(json.dumps(manifest))
    if current is None:
        current_id = manifest.get("oauth2", {}).get("client_id", "")
        if current_id:
            answer = input(f"manifest.json already has a client ID ({current_id}). Overwrite it? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                ok("Leaving manifest.json unchanged.")
                sys.exit(0)
        else:
            warn("manifest.json has no oauth2.client_id; a new one will be inserted.")

    # 2. gcloud prerequisites.
    if not check_gcloud():
        sys.exit(1)

    # 3. Authentication.
    try:
        ensure_authenticated()
    except RuntimeError as exc:
        fail(str(exc))
        sys.exit(1)

    # 4. Project.
    try:
        project_id = choose_or_create_project()
    except RuntimeError as exc:
        fail(f"Project step failed: {exc}")
        sys.exit(1)

    # 5. Enable the Gmail API.
    try:
        enable_gmail_api(project_id)
    except RuntimeError as exc:
        warn(f"Could not enable the Gmail API: {exc}")
        warn("Check that billing/activation is possible on this project, or choose another one.")

    # 6. Extension ID.
    extension_id = prompt_extension_id()

    # 7. The two Console-only steps.
    configure_consent_screen(project_id)
    client_id = collect_client_id(project_id, extension_id)

    # 8. Patch the manifest.
    try:
        patch_manifest(manifest_path, client_id)
    except RuntimeError as exc:
        fail(f"Could not patch the manifest: {exc}")
        sys.exit(1)

    # 9. Summary.
    banner("SETUP COMPLETE")
    print(f"""
  Project        : {project_id}
  Extension ID   : {extension_id}
  OAuth client ID: {client_id}
  Manifest       : {manifest_path}

  Next steps:
    1. Reload the extension in Chrome (chrome://extensions -> refresh).
    2. Open the popup and click 'Sign in with Gmail'.
    3. If you see an 'unverified app' warning, click Advanced -> allow.
       This is normal while the app is in Testing mode.
    4. If sign-in is rejected, add your Gmail address to the consent
       screen's 'Test users' list:
         https://console.cloud.google.com/apis/credentials/consent/audience?project={project_id}
""")

    # 10. Manual fallback, printed for reference.
    print_manual_fallback(manifest_path, project_id, extension_id)


def print_manual_fallback(manifest_path, project_id, extension_id):
    print("=" * 70)
    print("  MANUAL FALLBACK (if the automated flow ever breaks)")
    print("=" * 70)
    print(f"""
  1. Install the Google Cloud CLI:  https://cloud.google.com/sdk/docs/install
  2. Log in:                          gcloud auth login
  3. Create a project (or reuse one): gcloud projects create mail-man-XXXX
                                      gcloud config set project mail-man-XXXX
  4. Enable the Gmail API:            gcloud services enable gmail.googleapis.com
  5. Open the consent screen and configure it (External, name, support email):
       https://console.cloud.google.com/apis/credentials/consent?project={project_id}
     Add your Gmail address to 'Test users'.
  6. Create the Chrome Extension OAuth client ID:
       https://console.cloud.google.com/apis/credentials?project={project_id}
     Application type: Chrome Extension, Application ID: {extension_id}
  7. Copy the client ID into {manifest_path}:
       "oauth2": {{ "client_id": "PASTE_HERE.apps.googleusercontent.com", ... }}
  8. Reload the extension and sign in.
""")


if __name__ == "__main__":
    main()
