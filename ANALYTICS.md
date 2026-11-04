# CHAIN RUSH analytics

Analytics is private in the Vercel project and is loaded only after the player chooses **Allow anonymous analytics**. Declining sets Vercel's local opt-out flag and loads no analytics scripts. Players can change the choice under **Settings → Privacy**.

## Dashboard

- Visitors, page views, referrers and UTM sources: `https://vercel.com/dibbern/chain-rush/analytics`
- Crashes and gameplay events: open **Events** in the same Analytics dashboard.
- Web Vitals and device performance: `https://vercel.com/dibbern/chain-rush/speed-insights`

The dashboards require access to the private Vercel project.

## Events

| Event | Purpose |
| --- | --- |
| `game_loaded` | Loading time in milliseconds and a performance band |
| `play_clicked` | Main Play button clicks |
| `level_start` | Level number and whether it is a replay |
| `level_complete` | Level, score, destruction percentage and coins |
| `session_end` | Rounded session seconds and duration band |
| `return_visit` | Anonymous day-1 or day-7 return milestone |
| `traffic_source` | TikTok, YouTube, X, Reddit, direct or other |
| `game_error` | Sanitized error category only |
| `performance_problem` | Low FPS and automatic quality downgrade |

Vercel reports unique visitors without CHAIN RUSH creating its own player identifier. Return milestones are calculated in local storage; only the milestone name is sent. Error messages, full referrer URLs and arbitrary query parameters are not sent.

For clean campaign attribution, share links such as:

- `https://chain-rush-ten.vercel.app/?utm_source=tiktok&utm_medium=social`
- `https://chain-rush-ten.vercel.app/?utm_source=youtube&utm_medium=video`
- `https://chain-rush-ten.vercel.app/?utm_source=x&utm_medium=social`
- `https://chain-rush-ten.vercel.app/?utm_source=reddit&utm_medium=social`
