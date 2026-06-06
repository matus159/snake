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
