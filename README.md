# Snake

Had s obchodem, multiplayerem a dárky na [snake-adamini.pages.dev](https://snake-adamini.pages.dev/).

## Lokální vývoj

Upravuj **`index.html`** v kořeni. Před spuštěním se zkopíruje do `public/`.

```bash
npm install
npm run dev
```

Otevři **http://localhost:8788**. Multiplayer jde **i sám** – v lobby klikni **Začít hru**. Druhého hráče otestuješ druhou záložkou se stejnou adresou a jiným jménem.

## Deploy

Podrobný návod: **[DEPLOY.md](./DEPLOY.md)**

```bash
npm run deploy
```

Nebo push na `main` → GitHub Actions deployne automaticky (potřebuje Cloudflare secrets).

## Verze hry a obrazovka „Upravování“

Číslo verze je v `index.html` v `<meta name="snake-version" content="…">`. **Při každé změně hry ho zvyš.** Hráčům s otevřenou hrou se pak ukáže „Upravování“ a hra se načte znovu; kdo hru otevře později a naposledy viděl starší verzi, uvidí „Upravování“ po otevření.

## Statistiky návštěv

Návštěvnost měří **Cloudflare Web Analytics** (bez cookies). Zapíná se v Cloudflare: Workers & Pages → projekt → Metrics → Web Analytics. Měřicí kód Cloudflare přidává do stránky sám při každém nasazení, v `index.html` není. Statistiky jsou v Cloudflare pod Analytics & Logs → Web Analytics.

## Autoři obrázků

Obrázek taca (Tacos event) je z [Twemoji](https://github.com/jdecked/twemoji) © Twitter, Inc. a další přispěvatelé, licence [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
