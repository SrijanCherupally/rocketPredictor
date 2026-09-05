# apexFlite

**apexFlite** helps rocket teams record flights, understand past results, and choose a rocket weight that is likely to reach a target altitude.

You can use it in two ways:

- **Cloud mode:** Create an account and keep your flight records safely in Supabase. Your data follows you across devices.
- **Local mode:** Use the app without an account. Records stay in that browser only.

The live site is hosted on Vercel.

## What you can do

- Add, edit, and remove flight records
- Track altitude, flight time, descent time, rocket weight, parachute size, and weather
- Set a target altitude, with **800 ft** as the starting target
- Switch between Imperial and Metric units
- See recent flights and your full flight history
- Plan an altitude-focused launch mass using expected weather and held-out validation
- Switch to Legacy mode whenever you need the original algorithms and experiment workflow
- View descent time predictions based on flight conditions
- Review prediction accuracy and sample size
- Explore insights dashboard with flight trends and variable impact analysis
- Export your flights as a JSON backup
- Keep the same account updated on multiple devices

## What you need

- Node.js 18 or newer
- npm
- A Supabase project if you want accounts and cloud storage

## Run apexFlite on your computer

Install the project packages:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Open the local address shown in your terminal. It is usually:

```text
http://localhost:5173
```

## Cloud accounts and storage

Cloud mode uses Supabase for:

- Email and password sign-in
- Account verification emails
- Securely storing flights and preferences
- Keeping each user's records private
- Updating the app when the same account is used on another device

Database migrations are saved in [`supabase/migrations`](supabase/migrations). Apply all migrations in filename order. Migration `0003` closes the dormant multi-rocket security policy and adds synchronized planner preferences without deleting existing data.

### Environment variables

Create a `.env.local` file in the project folder with your Supabase project URL and public key:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-key
```

These values are safe for the browser. **Never use a Supabase service-role key in this file or in the website.**

If the variables are missing, apexFlite automatically uses local-only mode.

### Email verification

After creating an account, check your email and open the verification link. If you do not receive it, use **Resend verification email** on the sign-in screen. The link should open the live apexFlite site, not your local computer.

Supabase may limit how often verification emails can be sent. If a resend does not arrive immediately, wait a little while before trying again.

## Your data

Cloud records are tied to your account. Other users cannot read or change them.

For extra safety, use **Export** regularly to download a backup of your flights. Local browser data is also kept as a backup after cloud migration, but clearing browser data removes the local copy.

Important storage details:

- Rocket weight includes the motor.
- Temperature is saved in Fahrenheit and converted for display when Metric mode is selected.
- Cloud mode is the main source of truth after you sign in.
- Existing local flights can be imported when you first sign in.

## How predictions work

The default **Launch Planner** uses the separate Current v2 engine. It automatically selects
an eligible altitude model using launch-day-grouped held-out validation, responds to expected
wind, pressure, humidity and temperature, and refuses to recommend outside recorded mass support.

**Legacy mode** is available in Settings. It restores the original **Flight prediction lab**
with its physics, ridge, nearest-flight and neural-network experiments. The original
`analytics.ts` and `experiments.ts` files are protected by source hashes and remain unchanged.
The legacy lab validates on held-out
launch dates, shows actual flights, and restricts mass recommendations to logged support.
See [the app overview and experiment report](docs/APP-OVERVIEW.md) for methods, benchmark
results, caveats, and the bugs addressed. Overview and Experiments share entered weather;
mass-only models explicitly identify that they do not use weather. See the
[regression investigation](docs/REGRESSION-INVESTIGATION.md) for the reproduced 449.1 ft
held-out error and why it differs from the original model's training error.
The neural option now works with eight flights: a small network learns a bounded weather
correction around a physical trend, including validation folds containing four records.

### Basic prediction (altitude)

The basic altitude prediction compares rocket weight with peak altitude from previous flights. It uses a simple linear regression model. At least three flights are needed before it can make a prediction.

### Weather-aware prediction (altitude)

The original weather-aware altitude prediction also considers wind, air pressure, humidity, and temperature. It becomes available at four flights; this minimum alone does not establish accuracy. The experimental lab compares held-out performance against simpler models.

### Descent time prediction

The descent time prediction estimates how long a parachute descent will take based on rocket mass, apogee altitude, parachute size, and weather conditions. It uses a normalized linear regression model trained on flight data. The prediction equation displays the standardized coefficients and variable scales for transparency.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the local development app |
| `npm run build` | Checks the code and creates the production files |
| `npm run lint` | Checks the code for common problems |
| `npm run typecheck` | Checks TypeScript without creating a production bundle |
| `npm run preview` | Lets you preview the production build locally |
| `npm test` | Verifies Legacy v1 hashes and runs both engine test suites |
| `npm run test:legacy` | Verifies the original algorithm files are byte-for-byte unchanged |
| `npm run test:browser` | Runs the cross-device and responsive browser smoke suite |
| `npm run benchmark` | Compares models on the bundled example flights |

Before publishing changes, run:

```bash
npm run lint
npm test
npm run build
```

## Project layout

```text
.
├── src/
│   ├── App.tsx          # Application shell, dashboard, flights and settings
│   ├── LaunchPlanner.tsx # Current v2 weather-aware planner
│   ├── predictionV2.ts  # Separate current prediction engine
│   ├── analytics.ts     # Frozen Legacy v1 calculations
│   ├── experiments.ts   # Frozen Legacy v1 experiment engine
│   ├── cloud.ts         # Cloud saving and syncing
│   ├── supabase.ts      # Supabase connection and sign-in
│   ├── seed.ts          # Starter demo flights
│   ├── useTheme.ts      # Light/dark theme hook
│   └── styles.css       # App styling with custom properties
├── supabase/
│   └── migrations/      # Database setup
├── index.html           # Page title and description
└── package.json         # Project commands and packages
```

## Need help?

If sign-in, email verification, or cloud saving is not working:

1. Confirm the Supabase URL and public key are present.
2. Make sure Email sign-in is enabled in Supabase.
3. Confirm the verification email link points to the current Vercel site.
4. Try signing out and signing in again.
5. Use **Export** before clearing browser data.

For the latest version, open the deployed apexFlite site or pull the newest changes from the repository.

## License

See the repository for licensing information.
