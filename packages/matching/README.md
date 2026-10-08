# @vamo-virar/matching

Decides, on the device, whether a person can make an event. Phase 6:
calendar availability (`availability`, `BusyCache`) and read-only,
least-privilege adapters for Google free/busy, Microsoft Graph and device
calendars. Phase 7: places with radius and dates (`locationFit`), travel
time, and the combined `eligibility()` used for event hints and probe
answers. See [`docs/calendars.md`](../../docs/calendars.md).

Nothing in this package talks to a community node.
