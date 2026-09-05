/* global process, URL, console */
// Compile in memory with the project's TypeScript dependency; no test runtime dependency.
import ts from 'typescript'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const folder = mkdtempSync(join(tmpdir(), 'apexflite-tests-'))
try {
  for (const name of ['analytics', 'experiments', 'massRange', 'seed', 'predictionV2', 'predictionTypes', 'legacyEngine']) {
    const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
    writeFileSync(join(folder, `${name}.mjs`), output)
  }
  if (process.argv.includes('--benchmark')) {
    const { benchmark } = await import(pathToFileURL(join(folder, 'experiments.mjs')))
    const { seedLaunches } = await import(pathToFileURL(join(folder, 'seed.mjs')))
    const file = process.argv[process.argv.indexOf('--benchmark') + 1]
    const flights = file ? JSON.parse(readFileSync(file, 'utf8')) : seedLaunches
    console.log(file ? `Evaluating supplied flight log: ${file}` : 'DEMONSTRATION ONLY: eight bundled synthetic/example flights; not real-flight validation.')
    for (const task of ['descent', 'altitude']) {
      console.log(task)
      const suite = benchmark(flights, task)
      console.table(suite.results.map(r => ({ method: r.method, trainingMae: r.trainingMae?.toFixed(3) ?? 'unavailable', mae: r.mae?.toFixed(3) ?? 'unavailable', rmse: r.rmse?.toFixed(3) ?? 'unavailable', r2: r.r2?.toFixed(3) ?? 'unavailable', tested: `${r.tested}/${r.total}`, massMae: r.massMae?.toFixed(2) ?? 'unavailable', massCoverage: `${r.massCount}/${r.total}` })))
      if (file) console.table(suite.results[0].rows.map(r => ({ id: r.id, fold: r.fold, trainedOn: r.trainingCount, actual: r.actual, predicted: r.predicted.toFixed(2), absoluteError: Math.abs(r.residual).toFixed(2), mass: r.predictedMass?.toFixed(2) ?? 'unsupported' })))
    }
  } else {
    for (const name of ['experiments.test.mjs', 'prediction-v2.test.mjs']) writeFileSync(join(folder, name), readFileSync(new URL(`../tests/${name}`, import.meta.url), 'utf8'))
    const result = spawnSync(process.execPath, ['--test', join(folder, 'experiments.test.mjs'), join(folder, 'prediction-v2.test.mjs')], { stdio: 'inherit' })
    process.exitCode = result.status ?? 1
  }
} finally { rmSync(folder, { recursive: true, force: true }) }
