# Go Window 🌿

**The best time to go outside, inside the hours you are actually free.**

Go Window looks at the next 3 days of weather and air quality, keeps only the slots you said you are free, and tells you
when to step outside. A local open-weight model (Gemma, through Ollama) explains the plan in plain words. Every time you
tell it how a walk felt, it learns your personal heat, humidity, air and rain limits.

Built for the DEV Hacktoberfest Open-Source AI Challenge, Week 1: **Touch Grass**.

## What it does

- **Plans around your real day.** You set free hours (e.g. Mon–Fri 07:00–08:30 and 18:00–20:00). It only suggests time inside them.
- **Never a dead end.** If nothing fits all your limits (common in a hot, smoggy city), it offers the closest free slot within a tolerance you choose (Strict / Balanced / Relaxed), clearly marked with what is over and by how much. Thunderstorms always block.
- **3 days ahead.** Today, tomorrow and the day after, each with its best window, other good windows, and the reason a free slot does not work ("PM2.5 58 µg/m³, your limit 35").
- **Better time elsewhere.** If a much better slot sits outside your free hours, it tells you, in case you can move something.
- **Learns your limits.** After a window, tap how it felt (too hot, muggy, air felt bad, great…) or just write a sentence. Limits tighten quickly when something felt bad and loosen slowly when it felt great, within safe bounds, and every change is explained.
- **Phone alerts** via [ntfy](https://ntfy.sh): a morning digest, a nudge when the window opens, and a one-tap check-in afterwards. Alerts are scheduled on the ntfy server, so they still arrive when the laptop sleeps.
- **Nearby park** from OpenStreetMap, sized to fit the window. **Add to calendar** to defend the slot like a meeting.
- **Touch-grass receipt**: minutes and days outside this week, from your check-ins.

## How it works

```
Browser (React)  ──►  Local API (Node + Hono)
                        ├─ Open-Meteo: forecast + air quality (no key, location rounded to ~1 km)
                        ├─ OpenStreetMap (Overpass, Nominatim fallback): nearby parks
                        ├─ Scoring engine: every hour vs YOUR limits → windows inside free hours
                        ├─ Ollama ► Gemma: writes the words, parses free-text feedback
                        ├─ Learning: feedback → bounded limit changes, with a log
                        └─ ntfy: scheduled phone alerts (replace / cancel by sequence id)
```

**The model narrates; code decides.** The plan (times, scores, conditions) is computed by plain, unit-tested code.
Gemma gets the facts as short sentences and writes a headline, a reason and one idea for each day.
Every number in its answer is checked against the facts; if it invents one, it gets one retry and then that day
falls back to template text. When it reads your feedback note, it must quote the words behind each feeling it reports,
and any feeling without a real quote is dropped.

## Run it

Requirements: Node 20.11+ and [Ollama](https://ollama.com) with a Gemma model.

```bash
ollama pull gemma3:4b      # or a Gemma 4 model if your machine can take it
npm install
npm start                  # builds the UI and serves everything on http://127.0.0.1:8787
```

Development (hot reload): `npm run dev`, then open http://localhost:5173.

### Phone alerts

1. Install the ntfy app (Android / iOS).
2. In **Settings → Phone alerts**, turn alerts on, subscribe to the topic shown (or scan the QR code), save, and send a test.
3. To make the check-in buttons open the app on your phone, run `npm run start:lan`, open the printed Wi-Fi link once on
   your phone, and set **Advanced → Link for phone check-in buttons** to that address.

When the server listens on your network, requests from other devices must carry an access key. The printed link and
notification buttons include it. Requests from the laptop itself do not need it.

## Configuration

Everything a user would change is in the app (**Settings** and **My limits**): location, activity, sensitivity, after-dark,
free hours, shortest window, alerts and their timing, ntfy server and topic, local model, and every limit.

Environment variables (all optional):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API / UI port |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for phone access; `npm run start:lan` sets it) |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama endpoint |
| `GO_WINDOW_MODEL` | `gemma3:4b` | Default model for a new install |
| `GO_WINDOW_DATA` | `data/store.json` | Where settings, check-ins and learned limits are stored |

## Privacy

- Only your coarse location (about 1 km) is sent, to Open-Meteo and OpenStreetMap. Your free hours, check-ins, notes and learned limits stay in `data/store.json`.
- The model runs on your machine. Nothing is sent to a hosted AI.
- ntfy messages contain window times and park names, not your location. Use a private topic, or point it at your own ntfy server.

## Tests

```bash
npm test         # scoring, windows, plan, learning, grounding, note parsing, notification schedule
npm run typecheck
```

## Notes and limits

- The air-quality forecast is a coarse model (about 10–40 km grid). It is good for "better or worse hour", not a sensor reading.
- PM2.5 limits use µg/m³; US AQI is not used for decisions.
- On a laptop CPU, Gemma 3 4B takes roughly 15–20 s per day to narrate. It runs in the background, and the page shows template text until it finishes.

## License

MIT
