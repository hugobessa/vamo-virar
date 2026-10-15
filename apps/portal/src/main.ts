import { createServer } from "node:http";

import { loadConfig, railwayVolumeProblem } from "./config.js";
import { Requests } from "./db.js";
import { logMailer, mailgunMailer, smtpMailer } from "./mailer.js";
import { nodeOperator } from "./node.js";
import { createHandler } from "./server.js";

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`configuração inválida: ${(e as Error).message}`);
  process.exit(2);
}

const volume = railwayVolumeProblem(process.env, config.dataDir);
if (volume) {
  console.error(`não vou iniciar: ${volume}`);
  process.exit(2);
}

const db = Requests.open(config.dataDir);
db.recoverInterrupted();
let mailer;
if (config.mailgun) {
  mailer = mailgunMailer(config.mailgun.apiKey, config.mailgun.domain, config.mailFrom, config.mailgun.apiUrl);
} else if (config.smtpUrl) {
  mailer = smtpMailer(config.smtpUrl, config.mailFrom);
} else {
  console.warn("Nem PORTAL_MAILGUN_API_KEY nem PORTAL_SMTP_URL definidos: os emails (com os códigos!) vão para o log. Só para desenvolvimento.");
  mailer = logMailer();
}
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
