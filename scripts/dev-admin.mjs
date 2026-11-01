#!/usr/bin/env node
/**
 * Local admin helper.
 *
 * Usage:
 *   pnpm dev:admin:create
 *   pnpm dev:admin:reset
 *   pnpm dev:admin:status
 *
 * This is intentionally local-only. It creates admins through the real
 * /api/v1/setup endpoint so Better Auth owns password hashing. The same
 * request sets up the new store (country, currency, time zone, units: the
 * dashboard's "Tell us about your store" step); Egypt by default.
 */

import { execFileSync, spawn } from "child_process";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { DEV_PORT_ENV, devOrigins, readDevPorts, syncLocalPlatform } from "./dev-ports.mjs";
import { localAuthResetSql } from "./dev-admin-reset.mjs";
import {
  assertLocalUrl,
  assertPassword,
  assertStringOptions,
  parseOptions,
  resolvePnpmExecutable,
  resolveLocalStatePath,
  trimTrailingSlash,
} from "./dev-local-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const apiDir = resolve(root, "apps", "api");
const pnpmExecutable = resolvePnpmExecutable();

/** Default time zone by country when no `--time-zone` override is supplied. */
const DEFAULT_TIME_ZONE_BY_COUNTRY = {
  BD: "Asia/Dhaka",
  EG: "Africa/Cairo",
};

/** Build the default configuration from environment variables. */
export function buildDefaults(env = process.env) {
  return {
    apiBaseUrl: env.LOCAL_API_BASE_URL || devOrigins().apiUrl,
    email: env.LOCAL_ADMIN_EMAIL || "admin@local.scalius.test",
    password: env.LOCAL_ADMIN_PASSWORD || "ScaliusLocal123!",
    name: env.LOCAL_ADMIN_NAME || "Local Admin",
    country: env.LOCAL_STORE_COUNTRY || "EG",
    storeName: env.LOCAL_STORE_NAME || "Scalius Local",
    wranglerState: resolveLocalStatePath(root, env.SCALIUS_WRANGLER_STATE),
  };
}

/** Resolve the store time zone: explicit override, country default, then machine/UTC fallback. */
export function resolveStoreTimeZone(timeZone, country) {
  return (
    timeZone ??
    DEFAULT_TIME_ZONE_BY_COUNTRY[country] ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC"
  );
}

/** Build the runtime config from parsed CLI options and defaults. CLI options take precedence. */
export function buildConfig(options, defaults) {
  return {
    apiBaseUrl: trimTrailingSlash(options.api || defaults.apiBaseUrl),
    email: options.email || defaults.email,
    password: options.password || defaults.password,
    name: options.name || defaults.name,
    country: String(options.country || defaults.country).trim().toUpperCase(),
    storeName: options["store-name"] || defaults.storeName,
    timeZone: options["time-zone"] || null,
    currency: options.currency || null,
    noStart: Boolean(options["no-start"]),
    skipMigrations: Boolean(options["skip-migrations"] || options["no-migrate"]),
    wranglerState: resolveLocalStatePath(root, options.state || defaults.wranglerState),
  };
}

let defaults = buildDefaults();
let config = buildConfig({}, defaults);
let migrationsApplied = false;

async function run() {
  const args = process.argv.slice(2);
  const validCommands = new Set(["create", "reset", "status", "help"]);

  const positionalCommand = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const command = positionalCommand || "create";
  const options = parseOptions(positionalCommand ? args.slice(1) : args);

  // The stack's ports (`--api-port` ... or the SCALIUS_DEV_*_PORT variables, as scripts/dev.sh takes
  // them) are the one source of every origin below and of the Platform settings written to the store.
  for (const [name, key] of [["api-port", "api"], ["storefront-port", "storefront"], ["admin-port", "admin"]]) {
    if (options[name] === true) {
      console.error(`Option --${name} requires a value.`);
      process.exit(1);
    }
    if (options[name]) process.env[DEV_PORT_ENV[key]] = String(options[name]);
  }
  try {
    readDevPorts();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  defaults = buildDefaults();

  if (options.help || command === "help") {
    printHelp();
    process.exit(0);
  }

  if (!validCommands.has(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  try {
    assertStringOptions(options, ["api", "email", "password", "name", "state", "country", "store-name", "time-zone", "currency"]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  config = buildConfig(options, defaults);

  try {
    assertLocalUrl(config.apiBaseUrl);
    if (command !== "status") {
      assertPassword(config.password);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  try {
    if (command === "status") {
      await withApi(async () => {
        const status = await getSetupStatus();
        console.log(status.adminExists ? "Local admin exists." : "No local admin exists.");
      });
    } else if (command === "create") {
      await withApi(async () => {
        await createAdmin({ allowExisting: true });
      });
    } else if (command === "reset") {
      ensureLocalMigrations();
      await withApi(async () => {
        resetLocalAuthTables();
        await createAdmin({ allowExisting: false });
      });
    } else {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
  } catch (error) {
    console.error(`\nLocal admin ${command} failed.`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Local admin helper

Commands:
  create   Create the first local admin if none exists
  reset    Delete local auth/session data, then create a fresh local admin
  status   Print whether a local admin exists

Options:
  --email <email>       Admin email (default: ${defaults.email})
  --password <value>    Admin password, 12+ chars (or LOCAL_ADMIN_PASSWORD)
  --name <name>         Admin name (default: ${defaults.name})
  --country <code>      The new store's country, ISO 3166-1 alpha-2 (default: ${defaults.country})
  --store-name <name>   The new store's name (default: ${defaults.storeName})
  --time-zone <zone>    IANA time zone (default: Africa/Cairo for EG, Asia/Dhaka for BD, else this machine's)
  --currency <code>     Currency (default: the country's)
  --api <url>           Local API origin (default: ${defaults.apiBaseUrl})
  --api-port <n>, --storefront-port <n>, --admin-port <n>
                        This stack's ports (or SCALIUS_DEV_{API,STOREFRONT,ADMIN}_PORT); the
                        printed dashboard URL and the store's saved web addresses follow them
  --state <path>        Wrangler local state path; relative paths resolve from repo root
  --no-start            Require API to already be running
  --skip-migrations     Do not apply local D1 migrations before starting/resetting

Environment overrides:
  LOCAL_ADMIN_EMAIL, LOCAL_ADMIN_PASSWORD, LOCAL_ADMIN_NAME, LOCAL_API_BASE_URL,
  LOCAL_STORE_COUNTRY, LOCAL_STORE_NAME,
  SCALIUS_WRANGLER_STATE
`);
}

async function withApi(work) {
  const alreadyRunning = await isApiReady(config.apiBaseUrl);
  let child = null;

  if (!alreadyRunning) {
    if (config.noStart) {
      throw new Error(`API is not running at ${config.apiBaseUrl}. Start it with pnpm --filter @scalius/api dev.`);
    }
    if (config.apiBaseUrl !== defaults.apiBaseUrl) {
      throw new Error(
        `Custom --api ${config.apiBaseUrl} requires --no-start with an already running API worker. ` +
        `The bundled API dev script starts on ${defaults.apiBaseUrl}.`,
      );
    }

    ensureLocalMigrations();
    console.log(`Starting temporary API worker at ${config.apiBaseUrl}...`);
    child = spawn(pnpmExecutable, ["--filter", "@scalius/api", "dev"], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        SCALIUS_WRANGLER_STATE: config.wranglerState,
      },
    });
    let childStatus = null;
    child.once("exit", (code, signal) => {
      childStatus = { code, signal };
    });

    const stop = () => {
      if (child && !child.killed) child.kill("SIGTERM");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    try {
      await waitForApi(config.apiBaseUrl, () => childStatus);
    } catch (error) {
      stop();
      throw error;
    }
  }

  try {
    await work();
  } finally {
    if (child && !child.killed) {
      console.log("Stopping temporary API worker...");
      child.kill("SIGTERM");
    }
  }
}

const API_READY_TIMEOUT_MS = 30_000;

export async function isApiReady(apiBaseUrl, timeoutMs = API_READY_TIMEOUT_MS) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/setup`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForApi(apiBaseUrl, getChildStatus = () => null) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const requestTimeout = Math.min(API_READY_TIMEOUT_MS, remaining);

    // Cancellable child-exit polling: the timer is always cleared in finally
    // so no unresolved timer outlives the readiness attempt.
    let childExitTimer;
    let childExitResolved = false;
    const childExit = new Promise((resolve) => {
      const poll = () => {
        if (childExitResolved) return;
        const status = getChildStatus();
        if (status) {
          childExitResolved = true;
          resolve(status);
        } else {
          childExitTimer = setTimeout(poll, 200);
        }
      };
      poll();
    });

    try {
      const ready = isApiReady(apiBaseUrl, requestTimeout);
      const outcome = await Promise.race([ready, childExit]);

      if (outcome === true) return;
      if (outcome && typeof outcome === "object" && !Array.isArray(outcome)) {
        const reason = outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`;
        throw new Error(`Temporary API worker exited before it was ready (${reason}).`);
      }
      // outcome === false: not ready yet, continue
    } finally {
      childExitResolved = true;
      if (childExitTimer) clearTimeout(childExitTimer);
    }

    await sleep(Math.min(1000, deadline - Date.now()));
  }
  throw new Error(`Timed out waiting for API at ${apiBaseUrl}.`);
}

function ensureLocalMigrations() {
  if (config.skipMigrations || migrationsApplied) return;

  console.log("Ensuring local D1 migrations are applied...");
  execFileSync("node", ["scripts/deploy.mjs", "--migrate-only", "--local"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      SCALIUS_WRANGLER_STATE: config.wranglerState,
    },
  });
  migrationsApplied = true;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function getSetupStatus() {
  return requestJson("GET", "/api/v1/setup");
}

export async function createAdmin({ allowExisting }) {
  const status = await getSetupStatus();
  if (status.adminExists) {
    if (allowExisting) {
      console.log("Local admin already exists; leaving credentials unchanged.");
      console.log("Use pnpm dev:admin:reset to recreate the local admin account.");
      return;
    }
    throw new Error("Admin still exists after auth reset.");
  }

  const result = await requestJson("POST", "/api/v1/setup", {
    name: config.name,
    email: config.email,
    password: config.password,
    store: storeSetup(),
  });

  // The API stores its built-in local origins (4322/4323) for a new store; point them at this stack.
  try {
    const { origins } = await syncLocalPlatform({ state: config.wranglerState });
    console.log(`Local web addresses: storefront ${origins.storefrontUrl}, dashboard ${origins.dashboardUrl}.`);
  } catch (error) {
    console.warn(`Could not point the store's web addresses at this stack (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); run node scripts/dev-ports.mjs sync-platform.`);
  }

  console.log("\nLocal admin ready:");
  console.log(`  Admin URL: ${devOrigins().dashboardUrl}/admin`);
  console.log(`  Email:     ${config.email}`);
  console.log(`  Store:     ${config.storeName}, ${config.country} (${result?.storeSetup ?? "not_requested"})`);
  console.log("  Password:  use the value supplied through --password or LOCAL_ADMIN_PASSWORD");
}

/**
 * The new store's setup: the country's currency and units (the API derives
 * them), and its time zone (Egypt: Africa/Cairo; Bangladesh: Asia/Dhaka;
 * elsewhere this machine's unless --time-zone names one).
 */
export function storeSetup(configOverride) {
  const cfg = configOverride ?? config;
  const timeZone = resolveStoreTimeZone(cfg.timeZone, cfg.country);
  return {
    storeName: cfg.storeName,
    countryCode: cfg.country,
    timeZone,
    ...(cfg.currency ? { currencyCode: String(cfg.currency).toUpperCase() } : {}),
  };
}

async function requestJson(method, path, body) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || response.statusText;
    throw new Error(`${method} ${path} failed (${response.status}): ${message}`);
  }
  return data?.data ?? data;
}

function resetLocalAuthTables() {
  const dbName = readLocalD1DatabaseName();
  const sql = localAuthResetSql();

  console.log(`Resetting local auth tables in D1 database "${dbName}"...`);
  execFileSync(
    pnpmExecutable,
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      dbName,
      "--local",
      "--persist-to",
      config.wranglerState,
      "--command",
      sql,
    ],
    { cwd: apiDir, stdio: "inherit" },
  );
}

function readLocalD1DatabaseName() {
  const raw = readFileSync(resolve(apiDir, "wrangler.jsonc"), "utf8");
  const stripped = raw.replace(/(?<!https?:)\/\/[^\n]*/g, "");
  const configJson = JSON.parse(stripped);
  const dbName = configJson.d1_databases?.[0]?.database_name;
  if (!dbName) {
    throw new Error("Could not find d1_databases[0].database_name in apps/api/wrangler.jsonc.");
  }
  return dbName;
}

// Only execute when run directly as a script, not when imported as a module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("\nLocal admin failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
