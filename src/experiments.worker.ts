import { benchmark } from './experiments'
import type { Launch } from './analytics'

self.onmessage = (event: MessageEvent<Launch[]>) => {
  try { self.postMessage({ descent: benchmark(event.data, 'descent'), altitude: benchmark(event.data, 'altitude') }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not train experiments.' }) }
}
