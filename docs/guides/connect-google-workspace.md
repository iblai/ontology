# Guide: connecting Gmail and Google Workspace

This guide connects one Gmail mailbox to ibl.ai/ontology, so that the agents you choose can read
it. They only read: sending, drafting and labelling stay off unless you turn them on. It takes
about 15 minutes, most of them in Google Cloud. The same steps connect Google Drive, Calendar,
Classroom, Sheets and Workspace Admin.

**What you need**

- To sign in to the console as an administrator of your ibl.ai platform.
- The Google account whose mail the agents will read. An account in your organization's Google
  Workspace is best.
- Someone allowed to create a project in your organization's Google Cloud, often your Google
  Workspace administrator. Steps 1 and 2 are theirs if that is not you.

**Why Google Cloud.** Google lets an outside system read Gmail only through an app your
organization registers with Google. You register it once, sign in to it once with the mailbox's
account, and give the console the three values that produces. From then on the console keeps
itself signed in. The three values are saved on your ontology server and nowhere else.

## 1. Register the app in Google Cloud

**Connecting your own mailbox?** Google's
[quick setup](https://console.cloud.google.com/auth/overview/personal?apis=ws,wsmcp,tasksmcp&clientType=web&isAgent=true)
does this whole step on one page, with no consent screen to fill in: create a project, add the
redirect address `https://developers.google.com/oauthplayground`, and press **Continue**. It
serves only the Google account that creates it, so the mailbox's owner must do it. The **?**
beside **Upstream Auth** in the console shows the same steps.

1. Open the [Google Cloud console](https://console.cloud.google.com) and create a project, for
   example _ibl.ai ontology_.
2. Under **APIs & Services**, then **Library**, find **Gmail API** and press **Enable**.
3. Open **Google Auth Platform** (**APIs & Services**, then **OAuth consent screen**, leads there)
   and set it up: an app name such as _ibl.ai ontology_, a support email, and **Internal** as the
   audience. Internal means only accounts in your organization can use the app, so Google does not
   need to review it and its access does not lapse after 7 days.
4. Under **Clients**, press **Create client**:
   - Application type: **Web application**.
   - Under **Authorized redirect URIs**, add `https://developers.google.com/oauthplayground`, so
     that Google's own sign-in page can hand you the result in step 2.
   - Press **Create** and copy the **Client ID** and the **Client secret**. Keep them at hand for
     the next steps: Google shows the secret only once.

**A personal Gmail account** cannot use Internal. Choose **External**, keep the app in
**Testing** and add the account as a test user: it works, but Google ends the access after 7 days.

## 2. Sign in once with the mailbox's account

1. Open Google's [OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Press the gear at the top right, tick **Use your own OAuth credentials**, and paste the Client
   ID and the Client secret. Leave the other settings as they are.
3. In **Input your own scopes**, paste the permission that matches what agents may do:
   - read mail only: `https://www.googleapis.com/auth/gmail.readonly`
   - also draft, send and label: `https://www.googleapis.com/auth/gmail.modify`
4. Press **Authorize APIs**, sign in as the mailbox's account, and allow the access.
5. Press **Exchange authorization code for tokens** and copy the **Refresh token**. It usually
   starts with `1//`.
6. Back in Google Cloud, remove the Playground's address from the client's **Authorized redirect
   URIs**. Nothing else needs it.

## 3. Connect Gmail in the console

1. Sign in to the console and open **Systems**, then **APIs**, then the **Gmail** tile.
2. The form is filled in for Gmail. Under **Upstream Auth**, **OAuth 2.0** is chosen: paste the
   **Client ID**, the **Client Secret** and the **Refresh Token**. Leave **Credentials in the
   body** ticked.
3. Under **Endpoints to Wrap**, the nine that read are ticked, and sending, drafting and labelling
   are not. Leave them so for read-only access.
4. Press **Add & Expose**.

## 4. Make it available to agents

1. The **New MCP Server** page opens. Name the server, for example _mail_, tick **gmail-reads**
   and press **Deploy**.
2. Check it on the server's **Playground** tab: choose **gmail_get_profile**, type `me` between
   the quotes under **Arguments**, and press **Run**. The answer names the mailbox's address and
   how many messages it holds.
3. Give it to an agent: [Connect agents](connect-agents.md).

## What agents can and cannot do

- They read the one mailbox that signed in at step 2, and no other.
- They cannot send, draft or change labels: those stay off unless you tick them at step 3 and the
  permission chosen at step 2 allows it.
- Only the agents and people you allow may call the server at all: [Permissions](permissions.md).

## When access stops

- Google ends it when the account goes unused for 6 months or changes its password, and when your
  Workspace administrator restricts the app.
- To end it yourself, delete the client in Google Cloud: the console can no longer sign in, and
  access ends within the hour.
- To sign in again, repeat step 2 and enter the new refresh token on the **Gmail** tile under the
  same name. It replaces the old one.

## The other Google systems

The same app and a single sign-in serve Google Drive, Calendar, Classroom, Sheets and Workspace
Admin. Enable their APIs at step 1, paste every system's permissions together at step 2,
separated by spaces, and enter the same three values on each system's tile at step 3. Each
system's permissions are listed in
[Connect data sources](connect-data-sources.md#google-and-microsoft). Microsoft 365 has its own
guide: [Connect Outlook and Microsoft 365](connect-microsoft-365.md).

## Good to know

From 1 February 2027, Google asks AI agents to reach Google Workspace through Google's own MCP
servers rather than the APIs these systems call. Agents that keep calling the APIs directly are
held to Google's standard usage limits.
