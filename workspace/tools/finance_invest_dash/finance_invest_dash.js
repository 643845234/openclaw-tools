#!/usr/bin/env node
/**
 * finance_invest_dash - Investment Dashboard
 * Fetches data from BullaWare for multiple assets
 * Single table with sections for ETFs, Crypto, and Copy Traders
 * Sends summary + PDF to Telegram
 */

const https = require('https');
const fs = require('fs');
const http = require('http');
const PDFDocument = require('pdfkit');

const SYMBOLS = [
  { symbol: 'VTI', type: 'etf' },
  { symbol: 'VEA', type: 'etf' },
  { symbol: 'VWO', type: 'etf' },
  { symbol: 'COPX', type: 'etf' },
  { symbol: 'BTC', type: 'crypto' },
  { symbol: 'ETH', type: 'crypto' },
  { symbol: 'BNB', type: 'crypto' },
  { symbol: 'SOL', type: 'crypto' }
];

const COPY_TRADERS = [
  { symbol: 'JeppeKirkBonde', active: true },
  { symbol: 'thomaspj', active: true },
  { symbol: 'jaynemesis', active: false },
  { symbol: 'MarianoPardo', active: false },
  { symbol: 'STEFIINO', active: false },
  { symbol: 'AmitKup', active: false },
  { symbol: 'mgds1x07', active: false }
];

// ============================================================================
// CONFIG
// ============================================================================

function getTelegramChatId() {
  const fromEnv = (process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_USER_ID || "").trim();
  if (fromEnv) return fromEnv;
  const cfg = loadOpenClawConfig();
  return (cfg.channels?.telegram?.chatId || cfg.channels?.telegram?.defaultChatId || "").trim();
}

function getTelegramBotToken() {
  const fromEnv = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  const cfg = loadOpenClawConfig();
  return (cfg.channels?.telegram?.botToken || "").trim();
}

function loadOpenClawConfig() {
  const cfgPath = process.env.OPENCLAW_CONFIG || "/home/node/.openclaw/openclaw.json";
  try {
    if (fs.existsSync(cfgPath)) return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (e) {}
  return {};
}

// ============================================================================
// DATA FETCHING
// ============================================================================

async function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const newUrl = loc.startsWith('http') ? loc : 'https://bullaware.com' + loc;
        fetchUrl(newUrl).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject).setTimeout(30000, () => reject(new Error('Timeout')));
  });
}

function parseBullaWareData(html, symbol) {
  const result = { symbol, '1M': null, YTD: null, '2Y': null, '5Y': null, '10Y': null, Ann: null };
  const cleanHtml = html.replace(/<!-- -->/g, '');
  const summaryMatch = cleanHtml.match(/grid grid-cols-2 gap-4 my-auto text-center([\s\S]*?)<\/section>/);
  if (!summaryMatch) return result;
  
  const summaryHtml = summaryMatch[1];
  const metricPattern = /<span class="font-semibold text-(green|red)-600">([+-]?[\d.]+)%<\/span>[\s\S]*?<div class="text-sm text-slate-400">([^<]+)<\/div>/g;
  const metrics = {};
  let match;
  while ((match = metricPattern.exec(summaryHtml)) !== null) {
    metrics[match[3].trim()] = { color: match[1], value: match[2] };
  }
  
  const labelMap = { 'This Month': '1M', 'Year To Date': 'YTD', '2 Years': '2Y', '5 Years': '5Y', '10 Years': '10Y', 'Annualized': 'Ann' };
  for (const [label, key] of Object.entries(labelMap)) {
    if (metrics[label]) {
      const value = metrics[label].value;
      const numValue = Math.round(parseFloat(value));
      result[key] = numValue >= 0 ? '+' + numValue + '%' : numValue + '%';
    }
  }
  return result;
}

async function fetchSymbol(symbol) {
  try {
    const html = await fetchUrl(`https://bullaware.com/symbol/${symbol}`);
    return parseBullaWareData(html, symbol);
  } catch (error) {
    return { symbol, error: error.message };
  }
}

async function fetchCopyTrader(username) {
  try {
    const html = await fetchUrl(`https://bullaware.com/etoro/${username}`);
    return parseBullaWareData(html, username);
  } catch (error) {
    return { symbol: username, error: error.message };
  }
}

// ============================================================================
// FETCH TRADINGVIEW CHARTS
// ============================================================================

const TRADINGVIEW_CHARTS = [
  { url: 'https://www.tradingview.com/x/dKQcRv3v/', title: 'Investment Overview' },
  { url: 'https://www.tradingview.com/x/TWJ6xkXz/', title: 'BTC Analysis' },
  { url: 'https://www.tradingview.com/x/AoP6oGOq/', title: 'ETH Analysis' },
  { url: 'https://www.tradingview.com/x/dGyFvPUl/', title: 'BNB Analysis' }
];

async function fetchTradingViewChart(chartUrl, outputPath) {
  try {
    console.log('[TradingView] Fetching chart from:', chartUrl);
    
    const html = await new Promise((resolve, reject) => {
      https.get(chartUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject).setTimeout(30000, () => reject(new Error('Timeout')));
    });
    
    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
    const twitterImageMatch = html.match(/<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"/);
    
    let imageUrl = ogImageMatch ? ogImageMatch[1] : 
                    twitterImageMatch ? twitterImageMatch[1] : null;
    
    if (!imageUrl) {
      console.log('[TradingView] Could not find image URL in page');
      return false;
    }
    
    console.log('[TradingView] Found image URL:', imageUrl);
    
    return new Promise((resolve) => {
      const client = imageUrl.startsWith('https') ? https : http;
      client.get(imageUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectClient = res.headers.location.startsWith('https') ? https : http;
          redirectClient.get(res.headers.location, (res2) => {
            if (res2.statusCode !== 200) {
              resolve(false);
              return;
            }
            const chunks = [];
            res2.on('data', chunk => chunks.push(chunk));
            res2.on('end', () => {
              fs.writeFileSync(outputPath, Buffer.concat(chunks));
              console.log('[TradingView] Chart saved to', outputPath);
              resolve(true);
            });
          }).on('error', () => resolve(false));
          return;
        }
        if (res.statusCode !== 200) {
          resolve(false);
          return;
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          fs.writeFileSync(outputPath, Buffer.concat(chunks));
          console.log('[TradingView] Chart saved to', outputPath);
          resolve(true);
        });
      }).on('error', () => resolve(false)).setTimeout(30000, () => resolve(false));
    });
  } catch (error) {
    console.log('[TradingView] Error:', error.message);
    return false;
  }
}

async function fetchAllTradingViewCharts() {
  const results = [];
  for (let i = 0; i < TRADINGVIEW_CHARTS.length; i++) {
    const chart = TRADINGVIEW_CHARTS[i];
    const outputPath = `/tmp/tradingview_chart_${i}.png`;
    const success = await fetchTradingViewChart(chart.url, outputPath);
    results.push({
      path: outputPath,
      title: chart.title,
      url: chart.url,
      success: success
    });
  }
  return results;
}

// ============================================================================
// PDF GENERATION
// ============================================================================

function generatePDF(data) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: 20, right: 20 } });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    const pageWidth = doc.page.width - 40;
    const colWidths = { name: 80, m1: 40, ytd: 40, y2: 40, y5: 40, y10: 45, ann: 40, status: 50 };
    
    // Title
    doc.fontSize(16).font('Helvetica-Bold').text('Investment Dashboard', { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(8).font('Helvetica').text(`Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`, { align: 'center' });
    doc.moveDown(1);
    
    // Table header
    drawTableHeader(doc, colWidths, pageWidth);
    
    // Draw rows
    let rowIndex = 0;
    for (const item of data.etfs) {
      drawTableRow(doc, item.name || item.symbol, item, 'ETF', colWidths, pageWidth, rowIndex++);
    }
    drawSpacerRow(doc, pageWidth);
    
    for (const item of data.crypto) {
      drawTableRow(doc, item.symbol, item, 'Crypto', colWidths, pageWidth, rowIndex++);
    }
    drawSpacerRow(doc, pageWidth);
    
    for (const item of data.traders) {
      const status = item.active ? 'Active' : 'Watching';
      drawTableRow(doc, item.symbol, item, status, colWidths, pageWidth, rowIndex++);
    }
    
    // Footer
    doc.moveDown(1.5);
    doc.fontSize(7).font('Helvetica-Oblique').fillColor('gray').text('Data source: BullaWare (bullaware.com)', { align: 'center' });
    
    // Add chart pages - two charts per page, stacked vertically
    const chartFiles = [
      { path: '/tmp/tradingview_chart_0.png', title: 'Investment Overview' },
      { path: '/tmp/tradingview_chart_1.png', title: 'BTC Analysis' },
      { path: '/tmp/tradingview_chart_2.png', title: 'ETH Analysis' },
      { path: '/tmp/tradingview_chart_3.png', title: 'BNB Analysis' }
    ];
    
    const chartWidth = doc.page.width - 80;
    const chartHeight = (doc.page.height - 180) / 2;
    
    // Page 1: Investment Overview + BTC Analysis (stacked)
    doc.addPage();
    
    // Top chart
    if (fs.existsSync(chartFiles[0].path) && fs.statSync(chartFiles[0].path).size > 1000) {
      doc.fillColor('black');
      doc.fontSize(12).font('Helvetica-Bold').text(chartFiles[0].title, { align: 'center' });
      doc.moveDown(0.5);
      doc.image(chartFiles[0].path, 40, doc.y, { width: chartWidth, height: chartHeight });
      console.log('[PDF] Added chart:', chartFiles[0].title);
    }
    
    // Bottom chart
    if (fs.existsSync(chartFiles[1].path) && fs.statSync(chartFiles[1].path).size > 1000) {
      doc.y = chartHeight + 80;
      doc.fillColor('black');
      doc.fontSize(12).font('Helvetica-Bold').text(chartFiles[1].title, { align: 'center' });
      doc.moveDown(0.5);
      doc.image(chartFiles[1].path, 40, doc.y, { width: chartWidth, height: chartHeight });
      console.log('[PDF] Added chart:', chartFiles[1].title);
    }
    
    // Page 2: ETH Analysis + BNB Analysis (stacked)
    doc.addPage();
    
    // Top chart
    if (fs.existsSync(chartFiles[2].path) && fs.statSync(chartFiles[2].path).size > 1000) {
      doc.fillColor('black');
      doc.fontSize(12).font('Helvetica-Bold').text(chartFiles[2].title, { align: 'center' });
      doc.moveDown(0.5);
      doc.image(chartFiles[2].path, 40, doc.y, { width: chartWidth, height: chartHeight });
      console.log('[PDF] Added chart:', chartFiles[2].title);
    }
    
    // Bottom chart
    if (fs.existsSync(chartFiles[3].path) && fs.statSync(chartFiles[3].path).size > 1000) {
      doc.y = chartHeight + 80;
      doc.fillColor('black');
      doc.fontSize(12).font('Helvetica-Bold').text(chartFiles[3].title, { align: 'center' });
      doc.moveDown(0.5);
      doc.image(chartFiles[3].path, 40, doc.y, { width: chartWidth, height: chartHeight });
      console.log('[PDF] Added chart:', chartFiles[3].title);
    }
    
    doc.end();
  });
}

function drawTableHeader(doc, colWidths, pageWidth) {
  const startX = 20;
  let y = doc.y;
  
  doc.fillColor('#2d3748');
  doc.rect(startX, y, pageWidth, 16).fill();
  doc.fillColor('white');
  doc.font('Helvetica-Bold').fontSize(7);
  
  let x = startX + 3;
  doc.text('Name', x, y + 5, { width: colWidths.name });
  x += colWidths.name;
  doc.text('1M', x, y + 5, { width: colWidths.m1, align: 'right' });
  x += colWidths.m1;
  doc.text('YTD', x, y + 5, { width: colWidths.ytd, align: 'right' });
  x += colWidths.ytd;
  doc.text('2Y', x, y + 5, { width: colWidths.y2, align: 'right' });
  x += colWidths.y2;
  doc.text('5Y', x, y + 5, { width: colWidths.y5, align: 'right' });
  x += colWidths.y5;
  doc.text('10Y', x, y + 5, { width: colWidths.y10, align: 'right' });
  x += colWidths.y10;
  doc.text('Ann', x, y + 5, { width: colWidths.ann, align: 'right' });
  x += colWidths.ann;
  doc.text('Status', x, y + 5, { width: colWidths.status, align: 'center' });
  
  doc.y = y + 18;
}

function drawTableRow(doc, name, data, status, colWidths, pageWidth, rowIndex) {
  const startX = 20;
  let y = doc.y;
  
  if (rowIndex % 2 === 0) {
    doc.fillColor('#f7fafc');
    doc.rect(startX, y, pageWidth, 14).fill();
  }
  doc.fillColor('black');
  doc.font('Helvetica').fontSize(7);
  
  let x = startX + 3;
  doc.text(name, x, y + 3, { width: colWidths.name });
  x += colWidths.name;
  drawValue(doc, data['1M'], x, y + 3, colWidths.m1);
  x += colWidths.m1;
  drawValue(doc, data.YTD, x, y + 3, colWidths.ytd);
  x += colWidths.ytd;
  drawValue(doc, data['2Y'], x, y + 3, colWidths.y2);
  x += colWidths.y2;
  drawValue(doc, data['5Y'], x, y + 3, colWidths.y5);
  x += colWidths.y5;
  drawValue(doc, data['10Y'], x, y + 3, colWidths.y10);
  x += colWidths.y10;
  drawValue(doc, data.Ann, x, y + 3, colWidths.ann);
  x += colWidths.ann;
  
  const statusColor = status === 'ETF' ? '#3182ce' : status === 'Crypto' ? '#805ad5' : status === 'Active' ? '#38a169' : '#718096';
  doc.fillColor(statusColor).text(status, x, y + 3, { width: colWidths.status, align: 'center' });
  doc.fillColor('black');
  
  doc.y = y + 14;
}

function drawSpacerRow(doc, pageWidth) {
  const startX = 20;
  doc.fillColor('black');
  doc.rect(startX, doc.y + 3, pageWidth, 1).fill();
  doc.y += 10;
}

function drawValue(doc, value, x, y, width) {
  if (!value) {
    doc.fillColor('gray').text('-', x, y, { width, align: 'right' });
    return;
  }
  const isNegative = value.startsWith('-');
  doc.fillColor(isNegative ? '#c53030' : '#276749');
  doc.text(value, x, y, { width, align: 'right' });
  doc.fillColor('black');
}

// ============================================================================
// TELEGRAM SENDING
// ============================================================================

async function sendToTelegram(summary, pdfBuffer) {
  const botToken = getTelegramBotToken();
  const chatId = getTelegramChatId();
  
  if (!botToken || !chatId) {
    console.error('[ERROR] Missing Telegram config');
    return false;
  }
  
  const summaryUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    await httpsPost(summaryUrl, JSON.stringify({ chat_id: chatId, text: summary, parse_mode: 'Markdown' }));
    console.log('[Telegram] Summary sent');
  } catch (e) {
    console.log('[Telegram] Summary failed:', e.message);
  }
  
  const pdfUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;
  const boundary = '----Boundary' + Math.random().toString(36).substring(2);
  const pdfFilename = `investment_dashboard_${new Date().toISOString().slice(0,10)}.pdf`;
  
  const formData = buildMultipartFormData(boundary, {
    chat_id: chatId,
    document: { filename: pdfFilename, contentType: 'application/pdf', data: pdfBuffer }
  });
  
  try {
    await httpsPost(pdfUrl, formData, { 'Content-Type': `multipart/form-data; boundary=${boundary}` });
    console.log('[Telegram] PDF sent');
    return true;
  } catch (e) {
    console.log('[Telegram] PDF failed:', e.message);
    return false;
  }
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new (require('url').URL)(url);
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Length': bodyBuffer.length, ...headers }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}: ${data}`)));
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

function buildMultipartFormData(boundary, fields) {
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value && value.data) {
      chunks.push(Buffer.from(`--${boundary}\r\n`));
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"; filename="${value.filename}"\r\n`));
      chunks.push(Buffer.from(`Content-Type: ${value.contentType}\r\n\r\n`));
      chunks.push(value.data);
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(`--${boundary}\r\n`));
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
      chunks.push(Buffer.from(String(value)));
      chunks.push(Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function generateSummary(data) {
  const lines = ['📊 *Investment Dashboard Summary*', `Generated: ${new Date().toISOString().slice(0,19)} UTC`, ''];
  lines.push('📈 *ETFs:*');
  for (const r of data.etfs) lines.push(`  ${r.symbol}: YTD=${r.YTD||'-'}`);
  lines.push('\n₿ *Crypto:*');
  for (const r of data.crypto) lines.push(`  ${r.symbol}: YTD=${r.YTD||'-'}`);
  lines.push('\n👥 *Copy Traders:*');
  for (const r of data.traders) {
    const status = r.active ? '✓ Active' : '○ Watching';
    lines.push(`  ${status} ${r.symbol}: YTD=${r.YTD||'-'}`);
  }
  lines.push('\n📄 Full report attached as PDF.');
  return lines.join('\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log(`[${new Date().toISOString()}] Fetching investment data...`);
  
  const data = { etfs: [], crypto: [], traders: [] };
  
  for (const s of SYMBOLS) {
    const result = await fetchSymbol(s.symbol);
    if (s.type === 'etf') {
      result.name = result.symbol;
      data.etfs.push(result);
    } else {
      data.crypto.push(result);
    }
    console.log(`  ${s.symbol}: YTD=${result.YTD||'N/A'}`);
    await new Promise(r => setTimeout(r, 500));
  }
  
  for (const t of COPY_TRADERS) {
    const result = await fetchCopyTrader(t.symbol);
    result.active = t.active;
    data.traders.push(result);
    const marker = t.active ? '✓' : '○';
    console.log(`  ${marker} ${t.symbol}: YTD=${result.YTD||'N/A'}`);
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Fetch all TradingView charts
  await fetchAllTradingViewCharts();
  
  // Generate PDF
  console.log('\n[Generating PDF...]');
  const pdfBuffer = await generatePDF(data);
  console.log(`[${new Date().toISOString()}] PDF generated: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
  
  const outputPath = '/home/node/.openclaw/workspace/tools/finance_invest_dash/investment_dashboard.pdf';
  fs.writeFileSync(outputPath, pdfBuffer);
  console.log(`[${new Date().toISOString()}] PDF saved to: ${outputPath}`);
  
  const summary = generateSummary(data);
  const sent = await sendToTelegram(summary, pdfBuffer);
  
  if (sent) {
    console.log(`[${new Date().toISOString()}] ✓ Report sent to Telegram`);
  } else {
    console.log(`[${new Date().toISOString()}] ✗ Failed to send to Telegram`);
  }
}

main().catch(console.error);
