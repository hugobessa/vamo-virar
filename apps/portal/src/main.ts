import { createServer } from "node:http";

import { loadConfig } from "./config.js";
import { Requests } from "./db.js";
import { logMailer, smtpMailer } from "./mailer.js";
import { nodeOperator } from "./node.js";
import { createHandler } from "./server.js";

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`configuração inválida: ${(e as Error).message}`);
  process.exit(2);
}

const db = Requests.open(config.dataDir);
db.recoverInterrupted();
if (!config.smtpUrl) {
  console.warn("PORTAL_SMTP_URL não definido: os emails (com os códigos!) vão para o log. Só para desenvolvimento.");
}
const mailer = config.smtpUrl ? smtpMailer(config.smtpUrl, config.mailFrom) : logMailer();
const handler = createHandler({ config, db, mailer, node: nodeOperator(config.operatorUrl, config.operatorToken) });

// Unconfirmed requests are deleted once their link expires.
const purge = () => db.purgeUnverified(Date.now());
purge();
setInterval(purge, 3_600_000).unref();

const server = createServer((req, res) => void handler(req, res));
server.listen(config.port, config.host, () => {
  console.log(`portal ouvindo em http://${config.host}:${config.port} (público: ${config.publicUrl})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
