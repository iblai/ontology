# ibl.ai/ontology

## Sign-in: there is no login screen, and that is by design

The console keeps no session of its own. It uses the ibl.ai SDK's, as the OS does
(`docs/auth.md` has the whole model).

- **Where the session is.** In the browser's `localStorage` for the console's origin: `dm_token`
  and `axd_token` (each with `_expires`), `edx_jwt_token`, `userData`, `current_tenant`, `tenant`
  and `tenants`. `/sso-login-complete` (the SDK's `SsoLogin`) writes them, and every
  `/api/host/*` call sends `Token <dm_token>`. The SDK also keeps a few cookies with no token in
  them: `ibl_user_data`, `ibl_current_tenant`, `ibl_tenant`, `ibl_login_timestamp`,
  `ibl_logout_timestamp`.
- **Why no form shows.** With no `dm_token` the app goes to ibl.ai's sign-in app
  (`login.iblai.app`) and comes back with the session. That app has a session of its own, which
  every ibl.ai app uses: a browser signed in to the OS, the LMS or any other ibl.ai app is signed
  in here with no form shown. Do not report it as a bug, and do not add a login or a
  confirmation screen (rei, 2026-11-21).
- **To see ibl.ai's form.** Use a browser profile with no ibl.ai session, such as a private
  window. Do not add `logout=1` to the sign-in address to force it: that signs the browser out
  of the other ibl.ai apps too.
- **Handle with care.** Never print `localStorage`, a `/sso-login-complete?data=…` address or
  the SDK's `[auth-redirect]` console lines: they hold the tokens.
