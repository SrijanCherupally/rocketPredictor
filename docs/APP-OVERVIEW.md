# App overview and prediction experiments

apexFlite is a React/TypeScript dashboard for recording rocket flights and using comparable past flights to estimate altitude, recovery duration, and a mass that reaches a target altitude. Vite builds it; Recharts draws the graphs. Local mode stores the log in the browser. Configured cloud mode uses Supabase authentication, row-level security, and realtime synchronization.

## Main flows

- **Overview:** selected-date original altitude models, mass zoom controls, original prediction tools, and recent flights. The weather-aware graph and simulator use the same entered weather.
- **Experiments:** experimental descent sensitivity and mass predictions, training-versus-held-out comparisons, and exportable per-flight validation details. Weather and the date filter are shared with Overview.
- **Flights:** create/edit/delete records and import/export JSON. Storage uses feet, grams, inches, mph, inHg and Fahrenheit; metric conversion belongs at input/display boundaries.
- **Insights:** trends, configuration summaries, model residuals and suggested experiments. Some original insight scores are heuristics and should not be read as statistical confidence.
- **Settings:** units, target altitude and light/dark themes.

`src/App.tsx` still owns most navigation, storage, authentication and older screens. `src/cloud.ts` implements Supabase operations. The new `PredictionLab.tsx`, `MassRangeControl.tsx`, and `experiments.ts` separate the experimental UI and math from that large component. A dedicated worker performs training and validation whenever selected flight records change.

## Findings addressed

1. The original altitude zoom used tiny Recharts brush handles with no precise input. The replacement has larger handles, visible bounds, keyboard control, exact numeric inputs, visible-flight counts and a reset per graph. Zoom clips the x-axis without refitting the model. Bounds clamp when records or filters change; one-mass datasets have a disabled control.
2. The old descent graph swept an arbitrary 500–900 g region even though the bundled examples cover 560–602 g. Three curves at arbitrary ±10% altitudes did not show the underlying observations. The new graph sweeps the logged mass support, overlays measured recovery times, displays the entered scenario, and quantifies the end-to-end mass effect.
3. Training MAE and training R² were presented as expected accuracy/confidence. Original training diagnostics are now identified as such on the overview and baseline tools; the experimental lab reports held-out error and coverage. Prediction/error tooltips retain actual units and distinguish observations from scenario estimates.
4. Metric flight-entry labels did not convert several values before saving. Altitude, parachute size, wind and pressure now convert between display and canonical storage units, including when editing existing flights.
5. Invalid imported values could propagate through every chart and regression. Import now checks measurements and duplicate IDs, and rejects malformed files before adding records. New saves reject nonpositive or inconsistent recovery durations. Experimental training independently filters invalid/incomplete records.
6. Signing into a configured empty preview could inject example flights into local storage. Automatic example injection is removed; matching bundled examples in the lab are explicitly labeled.
7. The overview date and “+2 this month” statistic were hard-coded. Those displays are corrected. Unused components and render-created insight components were removed or moved to module scope, resolving the existing lint failures.

## Preserved baseline

**`src/analytics.ts` is unchanged.** Original mass-only altitude, weather-aware altitude and descent regression functions remain available. The experimental engine calls them directly for baseline comparisons. The original altitude graphs and prediction controls are visible on Overview; the experimental additions are on Experiments.

Preserving the baseline also preserves its limitations: training-fit optimism, heuristic impact scores, unconstrained extrapolation in its old mass simulator, and a ballast helper that omits temperature despite the weather model including it. Those calculations were not silently repaired or promoted into new experimental models. The new lab provides the bounded, validated alternatives.

## Model versions

| Version | Descent | Altitude / mass |
| --- | --- | --- |
| Original regression | Existing standardized ridge | Existing weather-aware regression |
| Original mass-only | Not applicable | Existing simple linear regression |
| Calibrated physics | Median calibration of terminal-speed descent scaling | Empirical inverse-mass response constrained to decrease with mass |
| Regularized regression | Ridge learns the log correction to physics | Standardized mass/weather ridge |
| Nearest flights | Five distance-weighted, physics-normalized flight durations | Five distance-weighted observed altitudes |
| Neural network | Learns a bounded weather correction to calibrated physics | Learns a bounded weather correction to an inverse-mass trend |

The neural network now supports eight-flight logs, including their four-flight training folds. It is a hybrid residual model: a physical prior supplies the mass/configuration response, and three tanh hidden units learn a weather correction through 320 full-batch backpropagation steps with L2 regularization. The prior, scaling and weights are refitted entirely within each training fold. Training requires four valid records; a held-out score also needs enough independent launch dates. There are no pretrained weights, duplicated training records or synthetic flights added to the log.

Weather inputs are centered on the training data and tanh-bounded, with scale floors of 2 mph, 0.1 inHg, 10 humidity percentage points and 10 °F. Columns with no training variation have zero input weights. The output is a log correction bounded to ±0.2, or approximately 0.82–1.22 times the fitted physical prior. This is a regularization constraint, not an uncertainty interval. Keeping the altitude correction independent of mass preserves the inverse-mass trend for mass recommendations. When no valid decreasing trend can be fitted, a positive constant prior allows altitude forecasts but does not invent a mass recommendation.

Physics uses `t = h × sqrt(rho × A / (2mg))` and a median calibration factor learned from the training flights. This follows the force-balance relationship in [NASA’s terminal velocity explanation](https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/termvr.html). It assumes a broadly comparable deployment and canopy; dry-air density uses station pressure and temperature. This is a calibrated approximation, not a trajectory simulator. Recorded liftoff mass stands in for recovery mass. The inverse-mass altitude variant is an empirical model and does not simulate motor thrust or drag.

## Validation and interpretation

Up to five folds group flights by launch date. Every held-out prediction is made by a model whose training excluded that entire date group. Scaling, calibration and weights are fitted within each training fold, following the training/test separation described in [scikit-learn’s leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html). At least three date groups are needed for scoring; at least eight fully held-out predictions are needed for the “lowest error” comparison and error band.

The lab reports training MAE alongside held-out MAE, RMSE, unclipped R², number of held-out predictions, and individual recorded/predicted flight rows. A negative R² remains visible. Finite nonpositive forecasts count toward validation errors even though the scenario tools reject those forecasts. Fold diagnostics identify training/scored counts, unsupported mass inversions, and conditions outside the training range. Export validation details downloads the underlying records, models and calculations in canonical units. The shaded band is the empirical 80th percentile of held-out absolute errors. It is a descriptive error scale, **not** an independently calibrated probability interval. Comparing and selecting models on these folds introduces selection optimism; these scores do not establish prospective performance.

Mass is obtained by inverting each altitude response at the entered weather and target. Inversion is restricted to the training/logged mass range, checks for a decreasing identifiable response and refuses unsupported targets or flat/non-monotonic curves. Held-out mass MAE reports its coverage denominator because edge flights and unsupported targets have no solution. Do not compare mass errors without their coverage counts.

The initial implementation had only the eight-record example in `src/seed.ts`. Real-flight measurements were subsequently supplied to investigate the reported regression failure; see [the investigation](REGRESSION-INVESTIGATION.md). Run `npm run benchmark` to reproduce the following **example-only** results, or `npm run benchmark -- path/to/flights.json` to inspect a supplied log:

| Model | Descent held-out MAE (s) | Altitude held-out MAE (ft) | Mass MAE (g) / supported flights |
| --- | ---: | ---: | ---: |
| Original regression | 0.345 | 3.094 | 1.82 / 6 of 8 |
| Original mass-only | — | 1.569 | 0.91 / 6 of 8 |
| Calibrated physics | 0.902 | 1.495 | 0.87 / 6 of 8 |
| Regularized regression | 0.342 | 4.330 | 3.09 / 4 of 8 |
| Nearest flights | 0.630 | 12.098 | 3.51 / 2 of 8 |
| Neural network | 0.679 | 1.495 | 0.87 / 6 of 8 |

The 0.003 s descent difference is negligible on eight examples. More complex does not necessarily mean more accurate. Import comparable real flight records and inspect held-out performance before choosing a model.

## Verification

- `npm test`: physics scaling, baseline compatibility, input rejection, all model families, neural learning/reproducibility, eight-flight neural validation, neural prior isolation, bounded corrections and monotonic mass, mass inversion, held-out date isolation and preprocessing, validation metrics, sparse data, range clamping, the reported 449.1 error, weather responsiveness, and nonphysical validation forecasts.
- `npm run lint` and `npm run build`.
- `scripts/browser-smoke.mjs`: isolated browser storage, tab separation, shared weather, live mass updates, validation export, empty workspace, example records, keyboard/pointer/numeric zoom, resetting, neural data gate, extrapolation notice, metric entry/save, mobile width, dark mode and constant-mass data. Requires Playwright and a browser (`TEST_BROWSER`, default `msedge`); `PLAYWRIGHT_PACKAGE` can point at an existing package. Start a local Vite instance without cloud credentials first. Set `TEST_REPORTED_FILE` to the supplied eight-flight log to check its exact regression row in the browser. Test output screenshots go into ignored `artifacts/`.

## Remaining structural limits

The record schema does not identify motor, rocket configuration, deployment delay, recovery mass, parachute material/shape, or measurement uncertainty. Mixing those configurations can produce misleading associations regardless of algorithm. The next substantive modeling improvement is collecting those identifiers and holding out whole configurations or future launch sessions. The original insights and account/sync flows remain larger areas for a separate audit; this work is not a claim that every existing bug is fixed.
