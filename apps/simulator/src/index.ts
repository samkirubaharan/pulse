// Programmatic entrypoint for the simulator.
// The CLI lives in ./runner.ts; this file re-exports its public surface
// so other packages (e.g. a future e2e harness) can invoke scenarios in-process.
export * from './runner';
