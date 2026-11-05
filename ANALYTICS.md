# CHAIN RUSH analytics

Analytics uses the private Google Analytics 4 property **Chain Rush** and loads only after the player chooses **Allow anonymous analytics**. Declining loads no Google tag. Revoking consent under **Settings → Privacy** disables GA4 and removes Chain Rush's `_ga` cookies.

## Dashboard

- Dashboard: `https://analytics.google.com/analytics/web/#/a414744068p562399374/reports/intelligenthome`
- Live validation: open **Reports → Realtime**.
- Gameplay totals: open **Reports → Engagement → Events**.
- Return visits: open **Reports → Retention** and inspect `return_visit` for the explicit day-1/day-7 milestones.
- Traffic: open **Reports → Acquisition → Traffic acquisition**. Campaign links also emit the normalized `traffic_source` event.
- Performance and crashes: filter the Events report for `performance_problem` and `game_error`.

The dashboard requires access to the Google account that owns the private Chain Rush property. GA4 Measurement ID: `G-DDJ5VFPKPK`.

## Events

| Event | Purpose |
| --- | --- |
| `game_loaded` | Loading time in milliseconds and a performance band |
| `play_clicked` | Main Play button clicks |
| `game_started` | First game start in the current page session |
| `level_started` | Level number and whether it is a replay |
| `level_completed` | Level, duration, score, destruction percentage and coins |
| `level_failed` | Level, duration and non-sensitive failure reason |
| `session_ended` | Rounded session seconds and duration band |
| `return_visit` | Anonymous day-1 or day-7 return milestone |
| `traffic_source` | TikTok, YouTube, X, Reddit, direct or other |
| `game_error` | Sanitized error category only |
| `performance_problem` | Low FPS and automatic quality downgrade |
| `challenge_shared` | A real result was shared, with level and destruction percentage |

GA4 reports users, average engagement time, first visits and returning users without CHAIN RUSH creating its own account system. Return milestones are calculated in local storage; only the milestone name is sent. Error messages, full referrer URLs and arbitrary query parameters are not sent. Google Signals, ad storage and ad personalization are disabled; analytics cookies expire after 90 days.

For clean campaign attribution, share links such as:

- `https://chain-rush-ten.vercel.app/?utm_source=tiktok&utm_medium=social`
- `https://chain-rush-ten.vercel.app/?utm_source=youtube&utm_medium=video`
- `https://chain-rush-ten.vercel.app/?utm_source=x&utm_medium=social`
- `https://chain-rush-ten.vercel.app/?utm_source=reddit&utm_medium=social`
