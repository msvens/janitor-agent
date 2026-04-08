import { randomBytes } from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error("Usage: pnpm run auth:init <password>");
  process.exit(1);
}

const jwtSecret = randomBytes(32).toString("hex");

console.log("\nAdd this to your .env.local:\n");
console.log(`JANITOR_USERNAME=admin`);
console.log(`JANITOR_PASSWORD=${password}`);
console.log(`JANITOR_JWT_SECRET=${jwtSecret}`);
