# Deploy na https://snake-adamini.pages.dev/

Projekt má **dvě části**:

| Část | Název | Co dělá |
|------|-------|---------|
| Worker | `snake-game-server` | Multiplayer + dárky (Durable Object) |
| Pages | `snake-adamini` | Hra v prohlížeči + WebSocket proxy |

GitHub: [github.com/matus159/snake](https://github.com/matus159/snake)

## 1. Cloudflare API token

1. [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**
2. Šablona **Edit Cloudflare Workers** (nebo Custom s těmito oprávněními):
   - Account → **Workers Scripts** → Edit
   - Account → **Workers KV Storage** → Edit
   - Account → **Cloudflare Pages** → Edit
3. Token si ulož

## 2. Account ID

Dashboard → vpravo dole **Account ID** → zkopíruj

## 3. GitHub Secrets

Repo **matus159/snake** → **Settings → Secrets and variables → Actions**

| Secret | Hodnota |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | token z kroku 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID z kroku 2 |

## 4. Cloudflare Pages – vypni starý build

1. [Workers & Pages](https://dash.cloudflare.com/) → **snake-adamini**
2. **Settings → Builds**
3. Vypni automatický Git build (pokud deployuje jen staré `index.html` bez Workeru)
4. Production branch: **`main`**

Deploy teď řeší GitHub Action `.github/workflows/deploy.yml`.

## 5. První deploy

```bash
git add .
git commit -m "Add Cloudflare Worker server and Pages deploy"
git push origin main
```

Na GitHubu: **Actions** → **Deploy to Cloudflare Pages** → měl by proběhnout:
1. deploy Workeru `snake-game-server`
2. deploy Pages `snake-adamini`

### Deploy z počítače (volitelně)

```bash
npm install
npx wrangler login
npm run deploy
```

## 6. Ověření

Otevři [https://snake-adamini.pages.dev/](https://snake-adamini.pages.dev/)

- Multiplayer by se měl připojit (bez hlášky o `npm start`)
- Dárky mezi hráči přes server

WebSocket: `wss://snake-adamini.pages.dev/` (stejná doména jako hra)

## Lokální vývoj

```bash
npm install
# terminál 1 – game server Worker
npm run dev:worker
# terminál 2 – Pages + proxy (nebo jen npm run dev)
npm run dev
```

Upravuj `index.html` v kořeni → `npm run sync` nebo `npm run dev` to zkopíruje do `public/`.

## Struktura

```
index.html              – hra (upravuješ tady)
public/index.html       – kopie pro Pages
functions/_middleware.ts – WebSocket proxy na Durable Object
game-server/            – Worker snake-game-server (herní logika)
wrangler.toml           – konfigurace Pages projektu snake-adamini
```
