# CLAUDE.md - Quran Knowledge Graph

## Project
Interactive Quran explorer with Obsidian-style neural network graph. Click a topic node to see all related verses with Arabic text + Bengali translation.

## Stack
- **Framework:** Next.js 16 (App Router)
- **Graph:** D3.js force-directed graph
- **Styling:** Tailwind CSS 4
- **Data:** Static JSON (no backend needed)

## Running
- **Service:** `systemctl restart quran-graph`
- **Port:** 3003
- **URL:** https://quran.mehediai.com
- **Build:** `npm run build` then restart service

## Data Files
```
data/quran_arabic.json    # 114 surahs, Arabic text (from quran-json npm)
data/quran_bn.json        # Bengali translations (from quran-json npm)
data/topics.json          # Topic definitions + verse references
```

## Key Files
```
src/components/QuranGraph.tsx   # Main component (graph + verse panel)
src/app/page.tsx                # Entry point
src/app/globals.css             # Dark theme + Arabic/Bengali fonts
```

## Topics Structure (data/topics.json)
Each topic has: id, name (Bengali), nameAr (Arabic), nameEn (English), color, verses[]
Verses are referenced as "surah:verse" (e.g., "2:255" = Al-Baqarah verse 255)

## Current Topics (15)
Shaytan, Angels, Paradise, Hellfire, Prayer, Prophets, Quran, Repentance, Death, Day of Judgment, Charity, Patience, Monotheism, Women, Jihad, Creation

## Adding New Topics
Add to `data/topics.json` → rebuild → restart service

## Common Tasks
- **Add a topic:** Edit `data/topics.json`, add object with id/name/nameAr/nameEn/color/verses
- **Change graph physics:** Edit `QuranGraph.tsx`, modify D3 force parameters
- **Add English translation:** Download `quran_en.json` from quran-json, add to verse card
- **After changes:** `npm run build && systemctl restart quran-graph`
