# Guide to Making Capsule Art for Games

This guide explains how to create and export **capsule art** (store and library graphics) for digital storefronts such as Steam. It is game-agnostic: use it for any project.

---

## General goal of capsule art

Capsule art is the set of key images that represent your game on the store and in the library. The goals are:

- **Recognition** — At a glance, players can identify your game and its tone (genre, mood, style).
- **Readability** — The game name/logo stays legible at every size, including very small thumbnails.
- **Consistency** — All capsule sizes feel like one coherent brand (same logo, palette, and visual language).
- **Compliance** — Art follows platform rules (e.g. no review scores, award badges, or misleading text on the capsule image itself).

Design for the smallest size first (e.g. small capsule at 462×174, or the 120×45 thumbnail Steam derives from it). If the title and key art read well there, they will scale up. Avoid tiny text, fine detail that disappears when scaled down, or important content at the edges (cropping and safe areas vary by size).

---

## Dimensions and which capsule each size is for

All dimensions are **width × height** in pixels. PNG is typical.

### Store capsules (store page, search, recommendations)

| Dimensions (W×H) | Capsule name   | Where it appears |
|------------------|----------------|------------------|
| **920 × 430**    | Header         | Store page top, recommendations, Big Picture |
| **462 × 174**    | Small          | Search results, top sellers, genre lists. Steam also auto-generates smaller thumbnails (e.g. 184×69, 120×45) from this — ensure the logo is still readable at 120×45. |
| **1232 × 706**   | Main (portrait)| Homepage carousel, wishlist emails |
| **748 × 896**    | Vertical       | Seasonal sales, some sale layouts |

### Library assets (Steam client library)

| Dimensions (W×H) | Capsule name     | Where it appears |
|------------------|------------------|------------------|
| **600 × 900**    | Library capsule  | Library grid, collections |
| **920 × 430**    | Library header   | Library locations, recent games |
| **3840 × 1240**  | Library hero     | Wide hero banner in library. Artwork only (no logo required). Keep important content in a safe area (e.g. center 860×380). |

### Optional / supplementary

| Dimensions (W×H) | Purpose |
|------------------|--------|
| **1280 × 720**   | Library logo (transparent or on a neutral background; aspect often 16∶9). |
| **256 × 256**    | Shortcut / game icon (e.g. desktop, taskbar). |
| **1438 × 810**   | Page background (optional; store page background). |

---

## Language suffixes (localized capsule art)

Storefronts like Steam let you upload **per-language** capsule art so users see the correct language for the title/logo. Steam uses **Steamworks API language codes** for store localization (including graphical assets). The authoritative list is on Steam’s documentation: [Languages Supported on Steam](https://partner.steamgames.com/doc/store/localization/languages).

For **full platform supported** languages (the set used for store and client localization), the official **API language codes** are:

| Code        | Language              |
|------------|------------------------|
| `english`  | English                |
| `schinese` | Chinese (Simplified)   |
| `tchinese` | Chinese (Traditional)  |
| `japanese` | Japanese               |
| `koreana`  | Korean                 |
| `german`   | German                 |
| `french`   | French                 |
| `spanish`  | Spanish (Spain)        |
| `latam`    | Spanish (Latin America)|
| `portuguese` | Portuguese (Portugal) |
| `brazilian`| Portuguese (Brazil)    |
| `russian`  | Russian                |
| `polish`   | Polish                 |
| `thai`     | Thai                   |
| `turkish`  | Turkish                |
| `vietnamese` | Vietnamese           |
| `ukrainian`| Ukrainian              |
| `dutch`    | Dutch                  |
| `czech`    | Czech                  |
| `danish`   | Danish                 |
| `finnish`  | Finnish                |
| `greek`    | Greek                  |
| `hungarian`| Hungarian              |
| `indonesian` | Indonesian          |
| `italian`  | Italian                |
| `norwegian`| Norwegian              |
| `romanian` | Romanian               |
| `swedish`  | Swedish                |
| `arabic`   | Arabic                 |
| `bulgarian`| Bulgarian              |

For filenames or asset keys, a common convention is to append the code with an underscore (e.g. `header_english.png`, `header_schinese.png`, `library_capsule_japanese.png`). In Steamworks you assign each uploaded asset to a language in the Graphical Assets / Localization UI; use the same API language code there. Not every capsule type may support every language — check the platform’s current documentation.

---

## Workflow tips

1. **Master size** — Author at one high resolution (e.g. 2× the largest capsule you need), then export or scale down to each target size to avoid blurry text.
2. **Safe zones** — Keep the logo and key art away from the very edges; some sizes are cropped or displayed in different aspect ratios.
3. **Small capsule** — Test at 462×174 and again at ~120×45 (or the platform’s smallest thumbnail). If the title is unreadable, simplify or enlarge it.
4. **Localization** — Generate one set of assets per language (e.g. `header_en.png`, `header_schinese.png`) and name them with the correct suffix for upload.
5. **Rules** — Do not put review scores, award logos, or “Coming soon” / “Sale” text on the capsule image unless the platform explicitly allows it; use the store’s built-in fields instead.

---

## Reference

- **Steam:** [Store Graphical Assets](https://partner.steamgames.com/doc/store/assets/standard), [Library Assets](https://partner.steamgames.com/doc/store/assets/libraryassets), [Graphical Asset Rules](https://partner.steamgames.com/doc/store/assets/rules), [Languages Supported on Steam](https://partner.steamgames.com/doc/store/localization/languages) (official API language codes).
- Dimensions and naming may change; always confirm against the platform’s latest documentation before final export.
