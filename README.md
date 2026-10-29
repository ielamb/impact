# VinChain local backend

This project now includes a small local API for the VinChain proprietary bottle catalog. It uses a JSON file for persistence, so you can run it without PostgreSQL or a cloud account. The frontend is served by the same server and loads bottles from `/api/bottles`.

## Requirements

- Node.js 22 or newer
- npm

## First-time setup

From this folder:

```bash
npm install
npm run build
```

## Run the application

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

During development, use:

```bash
npm run dev
```

The server watches the compiled output and restarts when you rebuild.

## My bottles

Connect the demo wallet on the timeline page, then select **My bottles** beside the wallet ID. Enter a proprietary bottle ID to claim it. Claimed bottles appear on the My Bottles page; select a bottle to open its memory form and record an opening note.

## API

### List bottles

```http
GET /api/bottles
GET /api/bottles?search=margaux
GET /api/bottles?status=sealed
```

### Get one bottle

```http
GET /api/bottles/VIN-00482
```

### Claim a proprietary bottle

The demo claim flow assigns an available VinChain bottle to the demo wallet:

```bash
curl -X POST http://localhost:3000/api/bottles/VIN-00482/claim \
  -H 'Content-Type: application/json' \
  -d '{"walletAddress":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
```

### Record an opening memory

```bash
curl -X POST http://localhost:3000/api/bottles/VIN-02198/memories \
  -H 'Content-Type: application/json' \
  -d '{"note":"A toast with friends.","openedAt":"2026-10-29T18:00:00Z"}'
```

The API updates the bottle status, stores the note, and adds a bottle-opened event. Data is persisted in [`data/bottles.json`](./data/bottles.json). Bottle creation is intentionally not exposed: the catalog contains only VinChain proprietary bottles.

## Important next steps before production

This is a local development backend, not a production service. Before deploying it:

1. Replace the JSON file with PostgreSQL or another transactional database.
2. Add authentication and authorization to mutation endpoints.
3. Validate and rate-limit sensor ingestion.
4. Move blockchain work to a background job.
5. Keep private location and collector data behind authenticated endpoints.
6. Add automated tests and deployment secrets through environment variables.
