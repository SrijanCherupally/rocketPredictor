# Weather recommendations and the 449.1 error

The supplied eight-flight log reproduces the reported original weather-regression row:

| Measurement | Reproduced result |
| --- | ---: |
| Training MAE, all eight flights | 6.23 ft |
| Held-out MAE | 449.10 ft |
| Held-out RMSE | 565.46 ft |
| Held-out R² | −67.51 |
| Altitude predictions scored | 8 of 8 |
| Held-out mass MAE | 28.16 g |
| Supported mass solutions | 2 of 8 |

These are different tests of the same original algorithm. Training MAE describes its fit to records it has seen. Held-out MAE describes forecasts from refitted models that have not seen the evaluation date. The large held-out error is reproducible; it is not a unit conversion error or a miscomputed mean.

## Why the gap is so large

There are three launch dates: August 18 (two flights), August 27 (two), and September 1 (four). The grouped validation therefore has three folds with six, six and four training flights. The original altitude regression has six fitted parameters: intercept, mass, wind, pressure, humidity and temperature. Its original ridge penalty operates on unstandardized inputs.

Mass and weather also change together across launch dates. For example, August 18 has roughly 483 g rockets at the same weather, while later dates use roughly 535–551 g rockets at other weather. This small log cannot reliably separate all of those effects. When September 1 is held out, a six-parameter model is fitted to just four flights, spanning only two weather regimes.

That fold produces these altitude forecasts:

| Recorded mass | Recorded altitude | Held-out forecast | Absolute error |
| ---: | ---: | ---: | ---: |
| 541.3 g | 825 ft | 1692.72 ft | 867.72 ft |
| 551.0 g | 793 ft | 1752.27 ft | 959.27 ft |
| 549.4 g | 801 ft | 1567.59 ft | 766.59 ft |
| 548.1 g | 785 ft | 1246.80 ft | 461.80 ft |

The other four absolute errors are approximately 199.31, 175.15, 91.17 and 71.80 ft. Summing all eight absolute errors and dividing by eight yields 449.10 ft. Calculations use full precision; displayed values are rounded.

R² is `1 − squared prediction error / variation around the scored flights’ mean`. A value of −67.51 means the squared error is approximately 68.51 times that mean-based reference error. It is not a negative percentage or a display overflow. The two mass solutions come from the held-out August 27 flights; the other six targets have no supported mass solution within their training masses. Their absence from mass MAE is now explicit in the per-flight audit.

## Changes made

- Experimental graphs and algorithm comparisons now have their own **Experiments** navigation tab. Original prediction tools remain on Overview.
- Overview previously computed its weather-aware recommendation at median logged weather, while the original simulator and experimental lab had independent weather state. They now share one entered weather scenario, and the adjusted graph and recommendation both update with that scenario. Both tabs share the selected date window.
- The inverse-mass and original mass-only models intentionally exclude weather. Their selector labels and a visible explanation now say so. Weather-aware models show the mass change relative to median logged weather, or explain when either scenario has no supported mass solution. A measured zero effect is not artificially forced to become nonzero.
- The comparison table separates **training MAE** from **held-out MAE**. Inspection shows fold training counts, per-flight absolute errors, unsupported mass solutions and out-of-training-range conditions. A JSON export includes the data and calculations in canonical units.
- A separate validation bug was fixed: finite negative forecasts previously disappeared from scoring because the scenario prediction function rejected them. They now count as errors in validation. The supplied eight-flight baseline forecasts were all positive, so this fix does not change the reproduced 449.10 result.
- The original algorithm file remains unchanged. The comparison does not replace its held-out score with a more flattering training score.

## What the alternatives did on this log

| Method | Held-out altitude MAE | Held-out descent MAE |
| --- | ---: | ---: |
| Original weather / descent regressions | 449.10 ft | 6.40 s |
| Original mass-only | 16.02 ft | — |
| Inverse-mass altitude / calibrated physics descent | 13.38 ft | 1.98 s |
| Regularized regression | 228.18 ft | 5.44 s |
| Nearest flights | 100.42 ft | 2.02 s |
| Small-data neural network | 13.16 ft | 2.56 s |

The mass-only alternatives generalize better across these three recorded dates, but do not claim to learn a weather response. Eight flights across three dates are still a small evaluation sample; these comparisons are not proof of future-flight accuracy. No model weights or hyperparameters were tuned to make this reported test look better.

The revised neural network now scores all eight held-out flights using training folds of six, six and four records. It learns a bounded weather correction around a physical prior. Its supported held-out mass MAE is **6.32 g on 3 of 8 flights**; unsupported inversions remain excluded and counted explicitly. It slightly improves altitude MAE over inverse-mass alone on this log, but calibrated physics has lower descent MAE (1.98 s versus 2.56 s). The app keeps both comparisons visible. This network is enabled for small samples without claiming that eight flights establish reliable neural predictions.

Because the neural design was revised after inspecting this log, its scores are development validation results rather than an independent test of the new design.

The regression tests retain the measurements with neutral IDs and no notes. The supplied log used for the local browser audit is under ignored `artifacts/`; no user account or cloud record was edited during testing.
