import express, { Request, Response } from "express";
import os from "os";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_NAME = process.env.APP_NAME ?? "week04-container-orchestration";
const startedAt = new Date();

app.disable("x-powered-by");

const uptimeSeconds = () => Math.round(process.uptime());

app.get("/", (_req: Request, res: Response) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_NAME}</title>
  <link rel="icon" href="data:," />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
    code { background: #eee; padding: 0.1rem 0.3rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${APP_NAME}</h1>
  <p>Served by container: <code>${os.hostname()}</code></p>
  <p>Uptime: <code>${uptimeSeconds()}s</code></p>
  <p>Endpoints: <a href="/healthz">/healthz</a> | <a href="/info">/info</a></p>
</body>
</html>`);
});

app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", uptimeSeconds: uptimeSeconds() });
});

app.get("/info", (_req: Request, res: Response) => {
  res.json({
    app: APP_NAME,
    hostname: os.hostname(),
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: uptimeSeconds(),
  });
});

const server = app.listen(PORT, () => {
  console.log(`${APP_NAME} listening on port ${PORT} (host: ${os.hostname()})`);
});

