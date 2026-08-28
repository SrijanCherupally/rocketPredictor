import type { Launch } from './analytics'

export const seedLaunches: Launch[] = [
  { id: 'flight-1', date: '2026-03-15', altitude: 789, flightTime: 45.3, descentTime: 33.1, parachuteSize: 18, rocketMass: 586, windSpeed: 4, airPressure: 29.91, humidity: 51, temperature: 72, notes: 'Stable flight.' },
  { id: 'flight-2', date: '2026-04-02', altitude: 806, flightTime: 46.8, descentTime: 34.2, parachuteSize: 18, rocketMass: 574, windSpeed: 2, airPressure: 30.04, humidity: 43, temperature: 70, notes: 'Near target.' },
  { id: 'flight-3', date: '2026-04-16', altitude: 774, flightTime: 44.7, descentTime: 32.7, parachuteSize: 18, rocketMass: 593, windSpeed: 8, airPressure: 29.78, humidity: 67, temperature: 76, notes: 'Crosswind.' },
  { id: 'flight-4', date: '2026-05-04', altitude: 819, flightTime: 47.4, descentTime: 35.0, parachuteSize: 19, rocketMass: 567, windSpeed: 3, airPressure: 30.12, humidity: 39, temperature: 68 },
  { id: 'flight-5', date: '2026-05-21', altitude: 798, flightTime: 46.1, descentTime: 33.6, parachuteSize: 18, rocketMass: 579, windSpeed: 5, airPressure: 29.95, humidity: 48, temperature: 74 },
  { id: 'flight-6', date: '2026-06-10', altitude: 762, flightTime: 43.9, descentTime: 31.8, parachuteSize: 18, rocketMass: 602, windSpeed: 10, airPressure: 29.68, humidity: 73, temperature: 82, notes: 'Warm and humid.' },
  { id: 'flight-7', date: '2026-06-25', altitude: 828, flightTime: 48.2, descentTime: 36.5, parachuteSize: 20, rocketMass: 560, windSpeed: 1, airPressure: 30.09, humidity: 36, temperature: 79 },
  { id: 'flight-8', date: '2026-07-12', altitude: 786, flightTime: 45.1, descentTime: 33.0, parachuteSize: 18, rocketMass: 587, windSpeed: 7, airPressure: 29.83, humidity: 61, temperature: 77 },
]
