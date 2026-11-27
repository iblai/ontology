// What a Google or Microsoft tile asks its vendor for, for the steps behind the form's "?".
// Written by hand from each tile's hint, which lib/library/library.test.ts checks it against.

export type Setup =
  | {
      vendor: "google";
      api: string; // as Google's API library names it
      service: string; // its id, for the API library's page
      scopes: string[]; // under https://www.googleapis.com/auth/
      account?: string; // who signs in, when it must be someone in particular
    }
  | {
      vendor: "microsoft";
      permissions: string[]; // Microsoft Graph application permissions, always needed
      writes: string[]; // added only when agents may write
    };

export const setup: Record<string, Setup> = {
  gmail: {
    vendor: "google",
    api: "Gmail API",
    service: "gmail.googleapis.com",
    scopes: ["gmail.modify"],
  },
  "google-calendar": {
    vendor: "google",
    api: "Google Calendar API",
    service: "calendar-json.googleapis.com",
    scopes: [
      "calendar.events",
      "calendar.calendarlist.readonly",
      "calendar.calendars.readonly",
      "calendar.events.freebusy",
    ],
  },
  "google-drive": {
    vendor: "google",
    api: "Google Drive API",
    service: "drive.googleapis.com",
    scopes: ["drive"],
  },
  "google-classroom": {
    vendor: "google",
    api: "Google Classroom API",
    service: "classroom.googleapis.com",
    scopes: [
      "classroom.courses.readonly",
      "classroom.rosters.readonly",
      "classroom.coursework.students",
      "classroom.announcements",
      "classroom.topics.readonly",
      "classroom.courseworkmaterials.readonly",
      "classroom.guardianlinks.students.readonly",
      "classroom.profile.emails",
    ],
    account: "a teacher or a Workspace for Education admin",
  },
  "google-sheets": {
    vendor: "google",
    api: "Google Sheets API",
    service: "sheets.googleapis.com",
    scopes: ["spreadsheets"],
  },
  "google-admin": {
    vendor: "google",
    api: "Admin SDK API",
    service: "admin.googleapis.com",
    scopes: [
      "admin.directory.user.readonly",
      "admin.directory.group.readonly",
      "admin.directory.group.member",
      "admin.directory.orgunit.readonly",
      "admin.directory.device.chromeos.readonly",
      "admin.directory.device.mobile.readonly",
      "admin.directory.domain.readonly",
      "admin.directory.rolemanagement.readonly",
      "admin.reports.audit.readonly",
      "admin.reports.usage.readonly",
    ],
    account: "a Workspace admin",
  },
  teams: {
    vendor: "microsoft",
    permissions: [
      "Team.ReadBasic.All",
      "Channel.ReadBasic.All",
      "TeamMember.Read.All",
      "ChannelMember.Read.All",
      "ChannelMessage.Read.All",
      "Chat.Read.All",
    ],
    writes: ["Channel.Create", "TeamMember.ReadWriteNonOwnerRole.All"],
  },
  sharepoint: {
    vendor: "microsoft",
    permissions: ["Sites.Read.All"],
    writes: ["Sites.ReadWrite.All"],
  },
  onedrive: {
    vendor: "microsoft",
    permissions: ["Files.Read.All"],
    writes: ["Files.ReadWrite.All"],
  },
  outlook: {
    vendor: "microsoft",
    permissions: ["Mail.Read", "Calendars.Read", "Contacts.Read"],
    writes: ["Mail.Send", "Calendars.ReadWrite", "Contacts.ReadWrite"],
  },
  "entra-id": {
    vendor: "microsoft",
    permissions: ["Directory.Read.All", "AuditLog.Read.All"],
    writes: [],
  },
  planner: { vendor: "microsoft", permissions: ["Tasks.ReadWrite.All"], writes: [] },
  "m365-education": {
    vendor: "microsoft",
    permissions: ["EduRoster.Read.All", "EduAssignments.Read.All"],
    writes: ["EduAssignments.ReadWriteBasic.All"],
  },
};

/** The scopes as the OAuth 2.0 Playground takes them: full addresses, space-separated. */
export const scopeLine = (scopes: string[]) =>
  scopes.map((s) => `https://www.googleapis.com/auth/${s}`).join(" ");

/** The page in Google's API library that turns an API on. */
export const apiPage = (service: string) =>
  `https://console.cloud.google.com/apis/library/${service}`;
