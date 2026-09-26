# Wind, flight path and same-day mass planning

Analysis of the supplied `apexFlite-workspace-v2.json`: 12 flights on 6 dates, mass 482.9–553.5 g, wind 0–5 mph. The original file is not modified or checked into the repository.

## Findings

| Factor | Raw altitude correlation | Correlation after inverse-mass adjustment |
| --- | ---: | ---: |
| Wind | −0.501 | −0.586 |
| Pressure | +0.126 | −0.061 |
| Humidity | +0.209 | −0.237 |
| Temperature | −0.313 | −0.049 |

These are descriptive Pearson correlations, not causal weights or significance estimates. Several flights share launch dates and weather readings. Accounting for mass does not remove launch-day, motor or flight-path confounding.

The September 13 flight was 550.1 g / 815 ft; September 26 was 553.5 g / 786 ft. Both recorded 0.5 mph wind. The user described the first as straight and the second as noticeably tilted; those observations were not present in the export. Their actual altitude difference is −29 ft. Fitting an inverse-mass trend to the other ten flights predicts −7.29 ft from the added 3.4 g, leaving −21.71 ft unexplained. That is consistent with a substantial flight-path contribution but is not a measured tilt penalty. No angle or physical tilt coefficient can be recovered from these records.

An inverse-mass fit to all twelve flights gives **547.65 g** for an 800 ft starting target, with a local sensitivity of approximately **−2.14 ft/g**. This is a starting estimate, not a perfect setting. A practical initial trial is about **548–550 g**, repeated three times under comparable conditions before chasing small differences. Three repeats is a conservative workflow rule, not a statistically established optimum. A noticeably tilted flight should prompt confirmation rather than an aggressive ballast response.

Leaving out each entire launch date gives an MAE of 10.94 ft for the mass-only baseline versus 12.12 ft for the sandbox's mass-and-wind model. The small atmospheric physics correction has MAE 10.70 ft, a difference too small to favor the more complex model under the sandbox's preset 3 ft simplicity tolerance. There is wind association, but this log does not show that adding a learned wind term improves future-day predictions. Those same validation folds select the model, so their scores are not an independent final test.

Eleven records have identical total and descent times. Check whether these were actually total flight times before interpreting recovery calibration.

## Implemented workflow

The production `predictionV2.ts`, `analytics.ts`, and `experiments.ts` algorithms are unchanged. All new calculations live in Analysis:

- A next-flight mass suggestion starts from the historical inverse-mass trend, excluding future dates.
- Same-day residuals calibrate an offset against two historical pseudo-observations. The previous flight has twice the recency weight. Weight also decreases as wind differs from the scenario.
- Qualitative straight / slight / noticeable tilt observations receive weights 1 / 0.5 / 0.15; unknown is 0.7. These settings are deliberately conservative assumptions, not learned tilt physics. A single unknown same-day record contributes about 41% of the offset evidence at matching wind; a noticeably tilted one contributes about 13%. Repeated straight flights can outweigh the historical prior.
- Ask for three comparable repeats within 1 g and 1 mph. Unknown flight paths remain unknown; noticeably tilted flights do not count toward repeatability. A next-step adjustment is limited to 3 g and the intersection of logged mass support and Settings limits.
- Interpolate directly only when two straight, same-day flights at least 2 g apart bracket the target, have a decreasing mass/altitude relationship, and have winds within 1 mph of one another and the scenario. Two points still require a confirmation flight.
- Creation timestamps establish within-day order when available; the user can explicitly select the previous flight for ambiguous imports.
- Analysis flight-path selections are temporary what-if observations. Persistent optional observations are edited in Flights and round-trip through JSON and cloud storage. No tilt input reaches the production predictor.
- The flight comparison tool separates the observed altitude difference from the mass-trend expectation and labels the remainder unexplained.

The selected date cannot guarantee constant launch conditions. The displayed residual spread is descriptive, not a calibrated confidence interval. Saved flight observations are never inferred from altitude alone.

## Mobile and release

The flight form uses a fixed header and action row with an independently scrolling field area. It follows the visual viewport during keyboard resizing, supports safe-area insets, traps keyboard focus, restores focus on close, and supports Escape. Save feedback is displayed inside the form so it cannot cover the buttons.

Apply `supabase/migrations/0005_observed_flight_path.sql` **before deploying** the new client to a cloud workspace. Existing data are preserved; the new nullable field distinguishes unknown from straight. Local guest mode does not require this migration. No live database migration or site deployment was performed as part of the local changes.

Checks: `npm test`, `npm run lint`, `npm run build`, `npm run test:browser`, and `npm run test:analysis-mobile`. The dedicated mobile suite covers Chromium at 320×568, 360×640, 375×667, 390×844, 412×915, 430×932, 844×390, 390×360 (keyboard-height simulation), and 768×1024. These checks do not replace physical iOS/Android keyboard and browser testing.
