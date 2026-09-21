import "dotenv/config";
import { runLocalTokenCommand } from "./local-token-cmd.ts";

process.exit(await runLocalTokenCommand(process.argv.slice(2)));
