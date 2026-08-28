# Apogee — Rocket Predictor

Apogee is a web-based flight logbook and prediction dashboard for TARC rocket teams. It records launch results, visualizes historical performance, and estimates the rocket mass most likely to reach a selected target altitude.

The current prototype stores data in the browser with `localStorage`. The React/Vite structure is intended to support a future shared online database, hosted deployment, custom domain, and mobile clients.

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
- Browser `localStorage` for prototype persistence

## Requirements

- Node.js 18 or newer is recommended.
- npm

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

The selected display preference is saved locally in the browser.

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

## Local storage

The prototype uses these browser storage keys:

- `apogee-launches-v1` — saved launch records
- `apogee-prefs-v1` — selected display units

Data is device- and browser-specific in the current prototype. Clearing browser site data removes the locally saved records. Use the in-app **Export** action to save a JSON copy before clearing storage or changing browsers.

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
