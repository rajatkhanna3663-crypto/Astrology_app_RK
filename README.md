# Kundli

Simple Vedic kundli viewer for iPhone (PWA, no build step).

- **D1 (Rashi) + D9 (Navamsa)**, North Indian style
- **Time control**: ◀ ▶ step by Min / Hour / Day / Week / Month / Year (× 1–30), hold to repeat, tap the date to pick, **Now**
- **Rotate the chart** by house (any house becomes Lagna) or by graha (e.g. Moon as Lagna)
- Table: house, rashi, degree, nakshatra + pada, D9 rashi/house, retro for every graha
- **Ayanamsa: Lahiri**; place chosen from a list of cities/countries (DST and historic time zones handled)

Positions are checked against Swiss Ephemeris (within 0.02°). Rahu/Ketu = mean node.

## iPhone par chalana
Repo Settings → Pages → Source: *GitHub Actions*; `main` par push karo. Phir iPhone Safari me URL kholo → Share → **Add to Home Screen**.

## Development
```
npm test
npm run serve   # http://localhost:8080
```
