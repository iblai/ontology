# Guide: connecting Outlook and Microsoft 365

This guide connects Microsoft Outlook to ibl.ai/ontology, so that the agents you choose can read
your organization's mail, calendars and contacts. They only read: sending mail and creating events
or contacts stay off unless you turn them on. It takes about 10 minutes, most of them in the
Microsoft Entra admin center. The same steps connect Microsoft Teams, SharePoint, OneDrive, Entra
ID, Planner and Microsoft 365 Education.

**What you need**

- To sign in to the console as an administrator of your ibl.ai platform.
- Someone allowed to register apps in your organization's Microsoft Entra ID: the Application
  Developer role is enough. Steps 1 and 2 are theirs if that is not you.
- A Privileged Role Administrator or Global Administrator for step 3, which lets the app read
  Microsoft 365 on its own. An Application Administrator cannot grant that.

**Why Microsoft Entra.** Microsoft 365 lets an outside system in only as an app registered in
Microsoft Entra ID, the directory behind your Microsoft 365 accounts, with permissions an
administrator has allowed. You register that app once, allow it what it may read, and give the
console the three values that produces. From then on the console signs in by itself, as the app
rather than as a person. The three values are saved on your ontology server and nowhere else.

## 1. Register the app in Microsoft Entra

The **?** beside **Upstream Auth** in the console shows steps 1 to 3 in short.

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com) and sign in.
2. Under **Entra ID**, open **App registrations** and press **New registration**.
3. Name the app, for example _ibl.ai ontology_. Under **Supported account types**, choose
   **Single tenant only**, so that only your organization can use it. Press **Register**.
4. The app's **Overview** opens. Copy the **Application (client) ID** and the **Directory (tenant)
   ID**, and keep them at hand for step 4.

## 2. Give it a client secret

1. In the app, open **Certificates & secrets**, then **Client secrets**, and press **New client
   secret**.
2. Describe it, for example _ibl.ai ontology_, and choose when it expires. Microsoft allows 24
   months at most and recommends less than 12. Note the date: the connection stops then.
3. Press **Add** and copy the secret's **Value**. Microsoft shows it only once: if you leave the
   page first, add another secret.

## 3. Allow it to read Outlook

1. In the app, open **API permissions** and press **Add a permission**, then **Microsoft Graph**,
   then **Application permissions**.
2. Tick the permissions that match what agents may do. They are grouped by the word before the
   dot: expand **Mail** to find **Mail.Read**, and so on.
   - read only: **Mail.Read**, **Calendars.Read** and **Contacts.Read**
   - also send mail and create events and contacts: add **Mail.Send**, **Calendars.ReadWrite** and
     **Contacts.ReadWrite**
3. Press **Add permissions**.
4. Press **Grant admin consent for** followed by your organization's name, then **Yes**. Each
   permission's **Status** then reads **Granted for** your organization.

These permissions reach every mailbox in your organization. To limit them to some mailboxes, read
[What agents can and cannot do](#what-agents-can-and-cannot-do) before you grant them.

The list also holds **User.Read**, which Microsoft adds to every new app. The console does not use
it, so you may remove it.

## 4. Connect Outlook in the console

1. Sign in to the console and open **Systems**, then **APIs**, then the **Microsoft Outlook** tile.
2. The form is filled in for Outlook. Under **Upstream Auth**, **OAuth 2.0** is chosen. Enter:
   - **Token URL**: `https://login.microsoftonline.com/<Directory ID>/oauth2/v2.0/token`, with the
     **Directory (tenant) ID** from step 1 in place of `<Directory ID>`.
   - **Client ID**: the **Application (client) ID** from step 1.
   - **Client Secret**: the **Value** from step 2.

   Leave **Scope** and **Refresh Token** as they are, and **Credentials in the body** ticked.

3. Under **Endpoints to Wrap**, the 14 that read are ticked, and the 4 that send, reply and create
   are not. Leave them so for read-only access.
4. Press **Add & Expose**. The console signs in to Microsoft once before it saves: if Microsoft
   refuses, its answer shows under the button. Check the three values.

## 5. Make it available to agents

1. The **New MCP Server** page opens. Name the server, for example _mail_, tick **outlook-reads**
   and press **Deploy**.
2. Check it on the server's **Playground** tab: choose **outlook_list_messages**, type a person's
   sign-in name, usually their email address, between the quotes under **Arguments**, for example
   `jane@example.edu`, and press **Run**. The answer lists that mailbox's messages, 10 at a time.
3. Give it to an agent: [Connect agents](connect-agents.md).

## What agents can and cannot do

- They can read every mailbox, calendar and contact list in your organization: Microsoft grants an
  app's permissions over the whole organization, not one account. To limit the app to some
  mailboxes, your Exchange administrator grants it the same permissions in Exchange Online, with
  [RBAC for Applications](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
  scoped to those mailboxes, and the **Mail**, **Calendars** and **Contacts** permissions of step 3
  are removed. Microsoft adds the two together, so step 3's would still reach every mailbox.
- They cannot send mail, reply, or create events or contacts: those stay off unless you tick them
  at step 4 and the app holds their permissions from step 3.
- Only the agents and people you allow may call the server at all: [Permissions](permissions.md).

## When access stops

- The client secret ends on the date chosen at step 2. Before then, add a new secret as in step 2,
  and enter the three values again on the **Microsoft Outlook** tile under the same name, with the
  new secret: it replaces the old one.
- To end access yourself, delete the secret, or the whole app, in the Microsoft Entra admin center.
  The console can no longer sign in, and access ends within 90 minutes, when the token it holds
  runs out. Removing a permission or the admin consent ends that access the same way.

## The other Microsoft systems

The same app can serve Microsoft Teams, SharePoint, OneDrive, Entra ID, Planner and Microsoft 365
Education. Add each system's permissions at step 3 and grant the consent again, then enter the
same three values on each system's tile at step 4. Each system's permissions and limits are listed
in [Connect data sources](connect-data-sources.md#google-and-microsoft), and the **?** beside
**Upstream Auth** shows them for the tile you chose.

Like Outlook's, these permissions cover the whole organization: every team, site and drive. One
app is simplest, but its secret then opens everything the app may read. Give a system its own app
where that matters, such as Outlook, whose permissions reach every mailbox.

## Good to know

Microsoft recommends a certificate rather than a client secret for apps in production. The console
signs in with a client secret only, and keeps it on your ontology server and nowhere else: choose a
short expiry at step 2, and replace the secret before it ends.
