# Astro Signal Lab

Bank Nifty (ya koi bhi index) ko monitor + walk-forward backtest karne wala Vedic/Western astro signal engine. Pure JavaScript PWA — iPhone Safari me chalta hai, koi build step / Xcode nahi.

## Kya account me leta hai
| Factor | Detail |
|---|---|
| Positions | sidereal longitude (Lahiri/KP/Raman/Fagan), degree, rashi, nakshatra, pada, nakshatra lord, house (market-open lagna / Chandra lagna / fixed), retro, combust, dignity, sandhi, gandanta |
| Vedic aspects | graha drishti (7th; Mars 4/8, Jupiter 5/9, Saturn 3/10, Rahu-Ketu 5/9) + same-rashi conjunction |
| Western aspects | conj / sextile / square / trine / opposition with orb-based strength |
| Sarvatobhadra | 9x9 chakra, nakshatra + rashi cells, row/column/diagonal vedha, malefic/benefic vedha counts (Abhijit optional) |
| Calendar | tithi, paksha, weekday |
| Your rules | JSON rules (Rules tab) jo prior ki tarah kaam karte hain |

Ephemeris: [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT, vendored, offline). Mean node for Rahu/Ketu.

## Engine kaise seekhta hai
Do layers: **Fast** (open→close of the day) aur **Slow** (agle ~20 trading days ka trend).
1. Return ko trailing volatility se divide karke z-score banata hai.
2. Har factor ke liye "jab active tha tab excess z" nikalta hai, **independent episodes** (din nahi) se shrink karke — Saturn ek rashi me 900 din rehta hai, wo 900 observation nahi, ~1 episode hai.
3. Weights har `blockDays` (default 63) par sirf us tak ke data se re-estimate hote hain (slow layer me H-din embargo) → look-ahead nahi (test me verified).
4. Har block ke baad har planet-group (Moon, Venus, Mars, … SBC, Calendar) ka out-of-sample information coefficient naapa jata hai aur uska multiplier upar/neeche hota hai. Prior = tumhari belief (Moon > Venus > Mars fast me; Saturn/Jupiter slow me; Sun/Mercury/Rahu/Ketu low jab tak backtest na ho). "Weights" tab me dikhta hai kya badla.
5. Rules: tumhari baat prior hai (`direction`, `strength`, `confidence`). Data support kare to weight badhta hai, nahi to shrink; `lock: true` se pin kar sakte ho.

Backtest tab me: out-of-sample Sharpe/CAGR/DD, buy&hold, direction accuracy, **circular-shift p-value** (kya same positions misaligned returns par bhi itne hi achhe lagte?), aur **in-sample vs out-of-sample** gap (overfit check). Itne saare factors/features ke saath overfit asaani se ho jata hai — OOS number hi sach hai.

## iPhone par chalana
**Option A (recommended): GitHub Pages**
1. Repo Settings → Pages → Source: *GitHub Actions*. `main` par push / manual run karo.
2. Workflow tests chalata hai, Yahoo se `^NSEBANK` / `^NSEI` ka daily data `data/` me laata hai (har weekday shaam) aur deploy karta hai.
3. iPhone Safari me URL kholo → Share → **Add to Home Screen**. Offline bhi chalega (service worker).

**Option B: manual CSV** — Data tab me CSV file (Files app) import ya paste. Browser Yahoo se direct fetch nahi kar sakta (CORS), isliye Option A ya manual.

**Option C: local** — `npm run serve` (Mac/PC) aur same Wi-Fi par `http://<ip>:8080` kholo. (Service worker/PWA install ke liye HTTPS chahiye; Pages automatically deta hai.)

**Sideload (native app)**: yeh folder bina badlaav ke WKWebView wrapper (Xcode, free Apple ID se 7-din sideload / AltStore) me load ho sakta hai — chahiye to alag se bana denge.

## Development
```
npm test        # ephemeris sanity, engine recovery of planted effect, no-lookahead, rules
npm run serve   # http://localhost:8080
```
Structure: `src/jyotish.js` (positions) · `aspects.js` · `sarvatobhadra.js` · `features.js` · `rules.js` · `model.js` (walk-forward learner) · `backtest.js` · `live.js` · `app.js` (UI).

## Known simplifications (tweak karne ke liye ready)
- Sarvatobhadra layout nakshatra ring + rashi ring ka reconstruction hai; vedha = poori row/column/diagonal (retro/direct ki 3-direction rule nahi). Apna exact chart batao → `sarvatobhadra.js` me data change.
- Rahu/Ketu mean node. Houses = whole sign. Chart ek fixed time (09:15 IST) par — Moon ~13°/day chalta hai, intraday Moon-change abhi nahi.
- Yeh research tool hai, financial advice nahi.
