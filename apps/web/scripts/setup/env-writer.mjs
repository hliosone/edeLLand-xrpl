import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../../.env.local");

/**
 * Reads the current .env.local (or empty string if it doesn't exist).
 */
function readEnv() {
  return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
}

/**
 * Writes an object of key/value pairs into .env.local.
 * Existing keys are replaced in-place; new keys are appended.
 *
 * @param {Record<string, string>} vars
 */
export function writeEnvVars(vars) {
  let content = readEnv();

  for (const [key, value] of Object.entries(vars)) {
    const escaped = value.includes(" ") || value.includes("#") ? `"${value}"` : value;
    const line = `${key}=${escaped}`;
    const regex = new RegExp(`^${key}=.*$`, "m");

    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content ? `${content.trimEnd()}\n${line}\n` : `${line}\n`;
    }
  }

  fs.writeFileSync(ENV_PATH, content, "utf8");
  console.log(`  ✔ .env.local updated (${Object.keys(vars).join(", ")})`);
}
