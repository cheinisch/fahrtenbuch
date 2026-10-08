import net from "node:net";

const host = process.env.REDIS_HOST || "redis";
const port = Number(process.env.REDIS_PORT || 6379);
const password = process.env.REDIS_PASSWORD || "";

function parse(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return null;
  const head = buffer.toString("utf8", offset + 1, end);
  let next = end + 2;
  if (type === "+" || type === "-" || type === ":") return { value: type === ":" ? Number(head) : head, next, error: type === "-" };
  if (type === "$") {
    const size = Number(head);
    if (size === -1) return { value: null, next };
    if (buffer.length < next + size + 2) return null;
    return { value: buffer.toString("utf8", next, next + size), next: next + size + 2 };
  }
  if (type === "*") {
    const count = Number(head);
    if (count === -1) return { value: null, next };
    const values = [];
    for (let i = 0; i < count; i++) {
      const item = parse(buffer, next);
      if (!item) return null;
      if (item.error) return item;
      values.push(item.value);
      next = item.next;
    }
    return { value: values, next };
  }
  throw new Error("Unsupported Redis reply");
}

export async function redisCommand(...args) {
  const socket = net.createConnection({ host, port });
  socket.setTimeout(10000);
  const encode = (parts) => "*" + parts.length + "\r\n" + parts.map((part) => {
    const value = Buffer.from(String(part));
    return "$" + value.length + "\r\n" + value.toString("utf8") + "\r\n";
  }).join("");
  return new Promise((resolve, reject) => {
    let pending = password ? 2 : 1;
    let received = Buffer.alloc(0);
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    socket.on("connect", () => {
      if (password) socket.write(encode(["AUTH", password]));
      socket.write(encode(args));
    });
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      try {
        while (true) {
          const item = parse(received);
          if (!item) break;
          received = received.subarray(item.next);
          if (item.error) return finish(new Error("Redis: " + item.value));
          if (--pending === 0) return finish(null, item.value);
        }
      } catch (error) { finish(error); }
    });
    socket.on("timeout", () => finish(new Error("Redis timeout")));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => { if (!settled) finish(new Error("Redis connection closed")); });
  });
}
