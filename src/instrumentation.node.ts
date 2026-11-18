import { EnvValidationError, getServerEnv } from './lib/env'

try {
  getServerEnv()
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(`\n${error.message}\n`)
    process.exit(1)
  }
  throw error
}
