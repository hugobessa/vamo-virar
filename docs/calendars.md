# Calendar integrations

Implements architecture.md §18–§19: the app checks a person's calendar **on
their phone** to show whether they can make an event. Nothing from the
calendar is sent to the community, the node, or anyone else.

## What is read, per source

| Source | How | Permission / scope | What we keep |
|---|---|---|---|
| Phone calendars (iOS EventKit, Android CalendarContract) | `expo-calendar` `listEvents` | iOS full calendar access (read); Android `READ_CALENDAR` | start, end, all-day, busy/tentative |
| Google Calendar | `freeBusy.query`, primary calendar | `https://www.googleapis.com/auth/calendar.freebusy` (busy times only: Google never returns titles, places or guests to us) | start, end |
| Outlook / Microsoft 365 | Graph `GET /me/calendarView` with `$select=start,end,showAs,isAllDay,isCancelled` | `Calendars.ReadBasic` (least privileged for calendarView) + `offline_access` | start, end, all-day, busy/tentative |

- Only the window from yesterday to 90 days ahead is fetched; refreshed at
  most every 15 minutes while the app is open.
- Busy intervals are stored sealed (XChaCha20-Poly1305 under the device key,
  like community data). OAuth tokens are kept in the Keychain/Keystore.
- Google and Microsoft are called directly from the phone with OAuth 2
  authorization code + PKCE. There is no client secret in the app.
- Disconnecting deletes the tokens and cached intervals (and asks Google
  to revoke the grant).

## How availability is decided

`@vamo-virar/matching` (`availability()`), per event time window:

- overlaps a busy entry → "You have something at that time";
- overlaps a tentative entry, an all-day entry (unless the person says
  all-day entries make them busy), or comes within the person's chosen
  free buffer (default 30 min) of another commitment → "Maybe";
- otherwise → "You're free at that time";
- no connected calendar covers that time → nothing is shown (unknown is
  never presented as free).

The verdict is shown only to the person. It is a hint: they can still
volunteer or accept.

## Setting up the OAuth clients (maintainers)

The providers appear in the app only when a client ID is configured in
`apps/mobile/app.json` → `expo.extra`:

```json
"extra": {
  "googleClientIdIos": "…apps.googleusercontent.com",
  "googleClientIdAndroid": "…apps.googleusercontent.com",
  "googleClientIdWeb": "",
  "microsoftClientId": "00000000-0000-0000-0000-000000000000"
}
```

- **Google Cloud Console**: create OAuth client IDs of type iOS and Android
  for bundle/package `org.vamovirar.app`; enable the Google Calendar API;
  add only the `calendar.freebusy` scope to the consent screen.
- **Microsoft Entra ID**: register a public client (mobile) app, allow
  personal and work accounts (`common`), add the redirect URI
  `vamovirar://oauth`, and the delegated permissions
  `Calendars.ReadBasic` and `offline_access`.

Device calendars need a development build (`npx expo run:ios|android` or
EAS): `expo-calendar` is not included in Expo Go.
