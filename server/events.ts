import type { Response } from 'express';

const clients = new Set<any>();

export function addClient(res: any) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(type: string, data: any) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch (e) { clients.delete(res); }
  }
}