const crypto = require("node:crypto");
const readline = require("node:readline/promises");

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const username = (await rl.question("Username: ")).trim();
  const password = await rl.question("Password: ");
  rl.close();

  if (!username || !password) {
    console.error("Username and password are required.");
    process.exit(1);
  }

  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64url");
  const passwordHash = `pbkdf2$210000$${salt}$${hash}`;

  console.log(JSON.stringify([{ username, passwordHash }]));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
