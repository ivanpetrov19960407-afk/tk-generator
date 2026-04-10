'use strict';

const fs = require('fs');
const path = require('path');

class Telegraf {
  constructor(token) {
    if (!token) throw new Error('Telegram bot token is required');
    this.token = token;
    this.handlers = { start: null, commands: new Map(), events: new Map() };
    this.offset = 0;
    this.running = false;
    this.pollTimer = null;

    this.telegram = {
      getFileLink: async (fileId) => {
        const fileRes = await this._api('getFile', { file_id: fileId });
        const filePath = fileRes && fileRes.file_path;
        if (!filePath) throw new Error('Telegram API did not return file path');
        return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
      }
    };
  }

  start(handler) {
    this.handlers.start = handler;
  }

  command(name, handler) {
    this.handlers.commands.set(name, handler);
  }

  on(event, handler) {
    this.handlers.events.set(event, handler);
  }

  async launch() {
    this.running = true;
    this._poll();
  }

  stop() {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async _poll() {
    if (!this.running) return;
    try {
      const updates = await this._api('getUpdates', { timeout: 20, offset: this.offset });
      for (const upd of updates || []) {
        this.offset = upd.update_id + 1;
        await this._dispatch(upd);
      }
    } catch (err) {
      // keep polling
      console.error('[telegraf-shim] poll error:', err.message);
    }

    if (this.running) {
      this.pollTimer = setTimeout(() => this._poll(), 300);
    }
  }

  async _dispatch(update) {
    const msg = update.message;
    if (!msg) return;

    const ctx = this._buildContext(msg);

    if (typeof msg.text === 'string') {
      const text = msg.text.trim();
      if (text.startsWith('/start') && this.handlers.start) {
        await this.handlers.start(ctx);
        return;
      }
      if (text.startsWith('/')) {
        const cmd = text.split(' ')[0].slice(1).split('@')[0];
        const h = this.handlers.commands.get(cmd);
        if (h) {
          await h(ctx);
          return;
        }
      }
      const textHandler = this.handlers.events.get('text');
      if (textHandler) {
        await textHandler(ctx);
      }
      return;
    }

    if (msg.document) {
      const docHandler = this.handlers.events.get('document');
      if (docHandler) {
        await docHandler(ctx);
      }
    }
  }

  _buildContext(message) {
    const chatId = message.chat.id;
    return {
      message,
      chat: message.chat,
      telegram: this.telegram,
      reply: async (text) => this._api('sendMessage', { chat_id: chatId, text: String(text) }),
      replyWithDocument: async ({ source }) => {
        if (!source) throw new Error('source is required');
        const fileName = path.basename(source);
        const data = fs.readFileSync(source);
        return this._sendMultipart('sendDocument', chatId, fileName, data);
      }
    };
  }

  async _sendMultipart(method, chatId, fileName, fileBuffer) {
    const boundary = `----NodeTelegramBoundary${Date.now()}`;
    const chunks = [];
    const push = (v) => chunks.push(Buffer.isBuffer(v) ? v : Buffer.from(v));

    push(`--${boundary}\r\n`);
    push('Content-Disposition: form-data; name="chat_id"\r\n\r\n');
    push(String(chatId));
    push('\r\n');

    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="document"; filename="${fileName}"\r\n`);
    push('Content-Type: application/octet-stream\r\n\r\n');
    push(fileBuffer);
    push('\r\n');

    push(`--${boundary}--\r\n`);

    const body = Buffer.concat(chunks);

    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });

    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.description || `Telegram API error ${method}`);
    }
    return json.result;
  }

  async _api(method, payload) {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.description || `Telegram API error ${method}`);
    }
    return json.result;
  }
}

module.exports = { Telegraf };
