// Telegram Reporter - Sends trade updates to Telegram
const https = require('https');

// Get config from environment or openclaw.json
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function formatSydneyTime(timestampMs) {
  if (typeof timestampMs !== 'number' || Number.isNaN(timestampMs)) return '';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date(timestampMs));
}

function isTelegramConfigured() {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

// Send message to Telegram
function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    if (!isTelegramConfigured()) {
      reject(new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.'));
      return;
    }

    const data = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'Markdown',
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Telegram error: ${res.statusCode} ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Format trade alert
function formatTradeAlert(trade, summary) {
  const action = trade.action;
  const side = trade.side || (trade.trade && trade.trade.side) || '';
  const lev = trade.leverage ?? (trade.trade && trade.trade.leverage);
  const levLine = typeof lev === 'number' ? `Leverage: ${lev}x\n` : '';
  const sideLine = side ? `Side: ${side}\n` : '';

  if (action === 'OPEN') {
    const time = formatSydneyTime(trade.timestamp);
    const timeLine = time ? `Time (Sydney): ${time}\n` : '';
    return `🟢 OPEN ${trade.symbol}
${timeLine}${sideLine}${levLine}Price: $${parseFloat(trade.price).toFixed(6)}
Strategy: ${trade.strategy} (${trade.consensus} consensus)

Portfolio: $${summary.totalValue.toFixed(2)}
P/L: ${summary.returnPercent >= 0 ? '+' : ''}${summary.returnPercent.toFixed(2)}%`;
  } else {
    const pct = typeof trade.profitPercent === 'number' ? trade.profitPercent : trade.profit;
    const time = formatSydneyTime(trade.timestamp);
    const timeLine = time ? `Time (Sydney): ${time}\n` : '';
    const held = typeof trade.heldMs === 'number' ? `
Held: ${Math.floor(trade.heldMs / 60000)}m` : '';
    return `🔴 CLOSE ${trade.symbol}
${timeLine}${sideLine}${levLine}Price: $${parseFloat(trade.price).toFixed(6)}
Profit: ${typeof pct === 'number' ? pct.toFixed(2) : pct}%${held}
Reason: ${trade.reason}

Portfolio: $${summary.totalValue.toFixed(2)}
P/L: ${summary.returnPercent >= 0 ? '+' : ''}${summary.returnPercent.toFixed(2)}%`;
  }
}

// Format periodic update
function formatUpdate(summary, recentTrades = []) {
  const remaining = Math.floor(summary.remainingTime / 60000);
  const time = formatSydneyTime(Date.now());
  const timeLine = time ? `Time (Sydney): ${time}` : '';
  let msg = `📊 Paper Trader Update
${timeLine}
Time Remaining: ${remaining}m

💵 Portfolio: $${summary.totalValue.toFixed(2)}
📈 P/L: ${summary.returnPercent >= 0 ? '+' : ''}${summary.returnPercent.toFixed(2)}% ($${summary.totalReturn.toFixed(2)})

🔄 Trades: ${summary.tradesCount} (${summary.buys} buys, ${summary.sells} sells)
🏆 Win Rate: ${summary.winRate.toFixed(1)}%`;

  if (summary.openPositions.length > 0) {
    msg += `\n\n📌 Open Positions:`;
    for (const pos of summary.openPositions.slice(0, 5)) {
      const pnl = pos.unrealizedPercent >= 0 ? '+' : '';
      msg += `\n• ${pos.symbol}: ${pnl}${pos.unrealizedPercent.toFixed(2)}%`;
    }
  }

  return msg;
}

// Send trade alert
async function sendTradeAlert(trade, summary) {
  if (!isTelegramConfigured()) return false;
  const msg = formatTradeAlert(trade, summary);
  try {
    await sendTelegramMessage(msg);
    return true;
  } catch (e) {
    console.error('Failed to send Telegram alert:', e.message);
    return false;
  }
}

// Send periodic update
async function sendUpdate(summary) {
  if (!isTelegramConfigured()) return false;
  const msg = formatUpdate(summary);
  try {
    await sendTelegramMessage(msg);
    return true;
  } catch (e) {
    console.error('Failed to send Telegram update:', e.message);
    return false;
  }
}

module.exports = {
  isTelegramConfigured,
  sendTelegramMessage,
  sendTradeAlert,
  sendUpdate,
  formatTradeAlert,
  formatUpdate,
};
