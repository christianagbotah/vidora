import net from "node:net";
import tls from "node:tls";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

function config(): SmtpConfig {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || "587");
  const user = (process.env.SMTP_USER || "").trim();
  const password = process.env.SMTP_PASSWORD || "";
  const from = (process.env.SMTP_FROM || user).trim();
  if (!host || !Number.isInteger(port) || !user || !password || !from) {
    throw new Error("SMTP configuration is incomplete");
  }
  return { host, port, user, password, from };
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

class SmtpConnection {
  private socket: Socket | TLSSocket;
  private buffer = "";
  private waiters: Array<(value: string) => void> = [];

  constructor(socket: Socket | TLSSocket) {
    this.socket = socket;
    this.bind();
  }

  private bind() {
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => {
      this.buffer += String(chunk);
      this.flush();
    });
  }

  private flush() {
    const lines = this.buffer.split("\r\n");
    this.buffer = lines.pop() || "";
    let response = "";
    for (const line of lines) {
      response += `${line}\r\n`;
      if (/^\d{3} /.test(line) && this.waiters.length) {
        const resolve = this.waiters.shift()!;
        const complete = response;
        response = "";
        resolve(complete);
      }
    }
  }

  response(timeoutMs = 15_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("SMTP response timeout")), timeoutMs);
      this.waiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  async command(command: string, expected: number[]): Promise<string> {
    this.socket.write(`${command}\r\n`);
    const response = await this.response();
    const code = Number(response.slice(0, 3));
    if (!expected.includes(code)) throw new Error(`SMTP command failed with code ${code}`);
    return response;
  }

  replaceSocket(socket: TLSSocket) {
    this.socket.removeAllListeners("data");
    this.socket = socket;
    this.buffer = "";
    this.bind();
  }

  write(data: string) { this.socket.write(data); }
  end() { this.socket.end(); }
}

async function connectSocket(cfg: SmtpConfig): Promise<SmtpConnection> {
  const socket: Socket | TLSSocket = cfg.port === 465
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: true })
    : net.createConnection({ host: cfg.host, port: cfg.port });

  await new Promise<void>((resolve, reject) => {
    const event = cfg.port === 465 ? "secureConnect" : "connect";
    socket.once(event, () => resolve());
    socket.once("error", reject);
    setTimeout(() => reject(new Error("SMTP connection timeout")), 15_000).unref();
  });

  const smtp = new SmtpConnection(socket);
  const greeting = await smtp.response();
  if (Number(greeting.slice(0, 3)) !== 220) throw new Error("SMTP server rejected connection");

  if (cfg.port !== 465) {
    await smtp.command(`EHLO vidora`, [250]);
    await smtp.command("STARTTLS", [220]);
    const secureSocket = tls.connect({ socket: socket as Socket, servername: cfg.host, rejectUnauthorized: true });
    await new Promise<void>((resolve, reject) => {
      secureSocket.once("secureConnect", () => resolve());
      secureSocket.once("error", reject);
    });
    smtp.replaceSocket(secureSocket);
  }

  await smtp.command("EHLO vidora", [250]);
  await smtp.command("AUTH LOGIN", [334]);
  await smtp.command(Buffer.from(cfg.user).toString("base64"), [334]);
  await smtp.command(Buffer.from(cfg.password).toString("base64"), [235]);
  return smtp;
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name?: string | null;
  resetUrl: string;
  expiresMinutes: number;
}): Promise<void> {
  const cfg = config();
  const smtp = await connectSocket(cfg);
  try {
    await smtp.command(`MAIL FROM:<${sanitizeHeader(cfg.from)}>`, [250]);
    await smtp.command(`RCPT TO:<${sanitizeHeader(opts.to)}>`, [250, 251]);
    await smtp.command("DATA", [354]);

    const subject = "Reset your Vidora password";
    const greeting = opts.name ? `Hello ${opts.name},` : "Hello,";
    const body = `${greeting}\n\nWe received a request to reset your Vidora password.\n\nOpen this secure link to choose a new password:\n${opts.resetUrl}\n\nThis link expires in ${opts.expiresMinutes} minutes and can be used only once.\n\nIf you did not request this reset, you can ignore this email.\n\nVidora`;
    const message = [
      `From: Vidora <${sanitizeHeader(cfg.from)}>`,
      `To: <${sanitizeHeader(opts.to)}>`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      dotStuff(body),
      ".",
      "",
    ].join("\r\n");
    smtp.write(message);
    const accepted = await smtp.response();
    if (Number(accepted.slice(0, 3)) !== 250) throw new Error("SMTP server rejected message");
    await smtp.command("QUIT", [221]).catch(() => undefined);
  } finally {
    smtp.end();
  }
}
