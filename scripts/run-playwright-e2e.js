"use strict";

const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

function resolvePlaywrightBinary() {
  const executable = process.platform === "win32" ? "playwright.cmd" : "playwright";
  return path.join(process.cwd(), "node_modules", ".bin", executable);
}

function findAvailablePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a local test port.")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function main() {
  const playwrightBinary = resolvePlaywrightBinary();
  const port = await findAvailablePort();
  const child = spawn(playwrightBinary, ["test", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_PORT: String(port),
    },
  });

  child.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code === null ? 1 : code);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
