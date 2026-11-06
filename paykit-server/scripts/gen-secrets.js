// Prints fresh values for ADMIN_TOKEN and MASTER_KEY. Paste them into .env.
const crypto = require("crypto");
console.log(`ADMIN_TOKEN=adm_${crypto.randomBytes(24).toString("base64url")}`);
console.log(`MASTER_KEY=${crypto.randomBytes(32).toString("hex")}`);
