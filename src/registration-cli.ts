import { parseStateConfig } from "./config.js";
import { runManualRegistrationCommand } from "./registration.js";

void runManualRegistrationCommand(
  process.argv.slice(2),
  parseStateConfig(),
  (message) => {
    console.info(message);
  },
).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
