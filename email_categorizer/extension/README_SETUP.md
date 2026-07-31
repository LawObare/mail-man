# Gmail OAuth Setup for the Inbox Categorizer extension

This guide automates the Google Cloud setup so the extension can sign in to
Gmail. It covers:

- Installing the Google Cloud CLI (`gcloud`)
- Creating a Google Cloud project and enabling the Gmail API
- Creating the OAuth client ID for the extension
- Patching `manifest.json` with the real client ID

> Why is one step still manual?
> Google offers no `gcloud` command or public REST API for creating Google-API
> **OAuth client IDs** (the "Chrome Extension" credential). They can only be
> created in the Google Cloud Console UI. The script automates everything
> else and walks you through that single screen, then patches the manifest
> for you.

---

## Prerequisites

1. **Google Cloud CLI** (`gcloud`)

   Linux / macOS:

   ```bash
   curl https://sdk.cloud.google.com | bash
   exec -l $SHELL
   gcloud init
   ```

   Windows: use the installer at
   https://cloud.google.com/sdk/docs/install#windows

2. **A Google account** (your normal Gmail account is fine).

3. **The extension loaded in Chrome** (needed only to read the extension ID):

   - Open `chrome://extensions`
   - Turn on **Developer mode** (top-right)
   - Click **Load unpacked** and select **this folder** (the one containing
     `manifest.json`)
   - Note the 32-character ID shown under "Inbox Categorizer" (keep this
     folder in place; moving it changes the ID)

---

## Run the setup

From this folder (the extension folder, where `manifest.json` lives):

```bash
python3 setup_oauth.py
```

The script will:

1. Check that `gcloud` is installed (and tell you how to install it if not).
2. Check you are logged in (opens the browser for `gcloud auth login` if not).
3. Ask whether to use your current Google Cloud project, reuse an existing
   one, or create a new one (it suggests `mail-man-1234`).
4. Enable the **Gmail API** on that project.
5. Ask for the **extension ID** (from `chrome://extensions`).
6. Open the **OAuth consent screen** page for you to configure once
   (External, app name "Inbox Categorizer", a support email).
7. Open the **Credentials** page for you to create the OAuth client ID
   (Chrome Extension type, Application ID = your extension ID).
8. Ask you to paste the finished **client ID**.
9. Patch `manifest.json` (in this folder) with that client ID
   (a backup copy is saved as `manifest.json.bak`).

### After the script finishes

- Reload the extension in Chrome (`chrome://extensions` -> refresh icon).
- Open the popup and click **Sign in with Gmail**.
- If you see an "unverified app" warning, click **Advanced -> Continue**.
  This is expected while the app is in *Testing* mode.
- If sign-in is rejected, open the consent screen's **Audience** tab and
  make sure your Gmail address is in **Test users**:
  `https://console.cloud.google.com/apis/credentials/consent/audience?project=PROJECT_ID`

---

## What the script does not do (and why)

| Step | Automated? | Why |
| --- | --- | --- |
| Check/install `gcloud` | Check only | Installation is OS-specific |
| `gcloud auth login` | Yes | Opens the browser |
| Create / select project | Yes | `gcloud projects create` |
| Enable Gmail API | Yes | `gcloud services enable` |
| Configure OAuth consent screen | No | No `gcloud`/REST API exists |
| Create Chrome Extension OAuth client | No | No `gcloud`/REST API exists |
| Patch `manifest.json` | Yes | The script does it |

---

## Manual fallback

If you prefer (or if automation fails), do the same thing by hand:

```bash
# 1. Install and log in
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud auth login

# 2. Project
gcloud projects create mail-man-XXXX
gcloud config set project mail-man-XXXX

# 3. Enable the Gmail API
gcloud services enable gmail.googleapis.com

# 4. Consent screen (browser)
#    https://console.cloud.google.com/apis/credentials/consent?project=mail-man-XXXX
#    User type: External -> Create
#    App name: Inbox Categorizer, add a support email.
#    Audience tab -> add your Gmail address to Test users.

# 5. OAuth client ID (browser)
#    https://console.cloud.google.com/apis/credentials?project=mail-man-XXXX
#    + Create Credentials -> OAuth client ID
#    Application type: Chrome Extension
#    Application ID: <your extension ID from chrome://extensions>

# 6. Paste the client ID into manifest.json (this folder)
#    "oauth2": { "client_id": "PASTE_HERE.apps.googleusercontent.com", ... }

# 7. Reload the extension and sign in.
```

---

## Troubleshooting

- **`gcloud` not found** — install the Cloud SDK (see Prerequisites) and
  start a new terminal so the `PATH` updates.
- **"The project could not be created"** — project IDs are globally unique.
  Run the script again and pick a different ID (it suggests a new random one
  each run).
- **Sign-in opens the consent page but errors** — add your Gmail address to
  the consent screen's **Test users** list. It is required while the app is
  in Testing mode.
- **Sign-in immediately fails with "OAuth2 not supported"** — the client ID
  in `manifest.json` is still the placeholder, or the extension was reloaded
  from a different path (different extension ID). Re-run `setup_oauth.py`.
- **Wrong extension ID was used** — the extension ID depends on the extension
  folder path. Load the extension from the same path every time, or create a
  new OAuth client with the correct ID.
