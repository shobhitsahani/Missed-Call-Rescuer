import type { Response } from 'express';

const clients = new Set<Response>();

export function addClient(res: Response): void {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(type: string, data: unknown): void {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}
