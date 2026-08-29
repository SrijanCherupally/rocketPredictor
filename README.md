# Apogee — Rocket Predictor

Apogee is a web-based flight logbook and prediction dashboard for TARC rocket teams. It records launch results, visualizes historical performance, and estimates the rocket mass most likely to reach a selected target altitude.

When Supabase is configured, authenticated cloud storage is the source of truth. The app supports email/password accounts, first-login migration from browser storage, real-time multi-device updates, and local JSON backups. Without the public Supabase variables, it runs in local-only mode.

## Features

- Log, edit, and delete flight records.
- Persist launch data locally between browser sessions.
- Track:
  - Launch date
  - Peak altitude
  - Total flight time
  - Descent time
  - Parachute size
  - Total rocket mass, including the motor
  - Wind speed
  - Air pressure
  - Humidity
  - Temperature
  - Optional notes
- Review recent launches and the complete flight log.
- Export all saved launches as JSON.
- Set an editable target altitude, defaulting to **800 ft**.
- Switch between Imperial and Metric display units.
- Preserve fractional gram values without rounding in normal mass displays.
- Display mass recommendations to exactly two decimal places.
- View a raw altitude-versus-mass regression model.
- View a weather-adjusted model using wind speed, air pressure, and humidity.
- Inspect model fit statistics including R², MAE, and sample size.
- Zoom both regression charts with Recharts Brush controls.
- See launch temperature in flight tables and chart tooltips.
- Migrate recognizable temperatures from older notes stored in `localStorage`.

## Technology

- React
- TypeScript
- Vite
- Recharts
- lucide-react
- ESLint with flat configuration
- Supabase Auth, Postgres, row-level security, and Realtime for cloud persistence
- Browser `localStorage` as a local-only fallback, migration source, and backup cache
- GitHub Pages deployment via GitHub Actions

## Requirements

- Node.js 18 or newer is recommended.
- npm

## Cloud setup with Supabase

Cloud mode requires a Supabase project. The frontend uses only the public project URL and publishable anonymous key; never put a Supabase service-role key in frontend code, `.env.local`, GitHub secrets used by the browser build, or any committed file.

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/migrations/0001_cloud_workspace.sql`](supabase/migrations/0001_cloud_workspace.sql). It creates the launches and preferences tables, enables row-level security, and registers both tables for Realtime.
3. In **Authentication → Providers**, enable Email. Choose whether email confirmation is required for new accounts.
4. In **Authentication → URL Configuration**, add both redirect URLs:
   - Local development: `http://localhost:5173/`
   - GitHub Pages: `https://<your-github-owner>.github.io/rocketPredictor/`
5. Create `.env.local` in the repository root:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-anon-key
```

These are Vite build-time public variables. Do not use a service-role or secret key here.

Run locally with cloud mode enabled:

```bash
npm run dev
```

On the first sign-in, Apogee reads the existing `apogee-launches-v1` records in that browser and asks whether to transfer them. The import is idempotent per account and launch ID, writes the migration marker only after success, and leaves the local backup intact. A later sign-in on another device will load the same cloud workspace.

For GitHub Pages, add these repository **Actions secrets** under **Settings → Secrets and variables → Actions**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The deployment workflow injects them only while building the browser bundle. GitHub Pages is static, so the values must be configured before deployment.

## Cloud behavior and safety

- Every launch and preference row is owned by the authenticated user. Postgres row-level security prevents one account from reading or changing another account's data.
- The same account can be signed in on multiple devices at once. Launch inserts, edits, and deletes are broadcast through Supabase Realtime.
- Edits and deletes use a version number. If another device changed the same flight first, the later operation is rejected instead of silently overwriting it; reload the current flight before trying again.
- Cloud state is loaded before local cache writes can replace it. Signing out clears the active cloud records from the page.
- **Export** downloads the current launch list as JSON. Keep exports as an additional backup; local browser storage is also retained after migration.
- If Supabase variables are absent, the app shows local-only mode and does not attempt cloud authentication.

## Getting started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Vite will print a local URL, usually:

```text
http://localhost:5173
```

Open that URL in a browser. To expose the development server on a local network, use Vite's host option if needed:

```bash
npm run dev -- --host
```

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Type-check and create the production bundle in `dist/`. |
| `npm run lint` | Run ESLint across the project. |
| `npm run preview` | Serve the built `dist/` bundle locally. |

A typical verification sequence is:

```bash
npm run lint
npm run build
npm run preview
```

## Entering a flight

Use **Log a flight** from the Overview or Flights page. Enter the total loaded rocket mass in grams; motor mass is already part of this value and should not be entered separately.

Temperature is stored internally in Fahrenheit. The form displays Fahrenheit in Imperial mode and Celsius in Metric mode, converting values automatically when the unit preference changes. Temperature values from older records can be recovered from notes when written in recognizable formats such as:

```text
Temperature: 72°F
Temp: 22 C
72 degrees F
22°C
```

Unrecognized note text is preserved. Records without a temperature value receive the app's default temperature so they remain valid and editable.

## Units

Imperial mode displays:

- Altitude: feet
- Mass: grams
- Wind: miles per hour
- Pressure: inches of mercury
- Temperature: Fahrenheit

Metric mode displays:

- Altitude: meters
- Mass: grams
- Wind: kilometers per hour
- Pressure: hectopascals
- Temperature: Celsius

The selected display preference is saved locally in the browser. After sign-in, the account preference is also saved to Supabase and shared across devices.

## Prediction models

### Raw altitude model

The raw model uses only total rocket mass and peak altitude. It is a least-squares linear regression and does not compensate for weather conditions. The mass recommendation is calculated by inverting this relationship for the selected target altitude.

At least three launches are required for the raw model.

### Weather-adjusted model

The adjusted model uses:

- Total rocket mass
- Wind speed
- Air pressure
- Humidity

It uses a lightly regularized linear model and adjusts launches to a median weather profile before plotting the relationship. At least seven launches are required before this model is shown as active.

Temperature is currently recorded and displayed but is intentionally not included in the adjusted regression feature matrix yet. This keeps the existing model behavior stable while more temperature data is collected.

## Data format

A launch record has this shape:

```ts
type Launch = {
  id: string
  date: string
  altitude: number
  flightTime: number
  descentTime: number
  parachuteSize: number
  rocketMass: number
  windSpeed: number
  airPressure: number
  humidity: number
  temperature: number
  notes?: string
}
```

`rocketMass` is the complete loaded rocket mass in grams, including the motor. Temperatures are stored canonically in Fahrenheit regardless of the selected display unit.

## Local storage and migration

The app uses these browser storage keys as a fallback/cache and migration source:

- `apogee-launches-v1` — saved launch records
- `apogee-prefs-v1` — selected display units
- `apogee-migrated-<user-id>` — per-account marker written only after local records are imported successfully

In cloud mode, clearing browser site data does not remove records already transferred to Supabase. In local-only mode, clearing site data removes the local records. Use the in-app **Export** action to save a JSON copy before clearing storage or changing browsers.

## Project structure

```text
.
├── index.html
├── package.json
├── eslint.config.js
├── src/
│   ├── App.tsx          # Dashboard, forms, tables, persistence, and unit display
│   ├── analytics.ts     # Launch types and regression calculations
│   ├── main.tsx         # React entry point
│   ├── seed.ts          # Initial demo launch records
│   ├── styles.css       # Responsive application styling
│   └── vite-env.d.ts    # Vite type declarations
└── dist/                # Generated production output
```

## Future direction

The current local-only implementation is a prototype. A production version can add Supabase for authentication, shared team workspaces, synchronized launch records, permissions, and multi-device access without replacing the React front end.
