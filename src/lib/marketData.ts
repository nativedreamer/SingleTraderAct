import { LiveTicker, MarketCandle } from '../types/signal';

const CACHE_KEY_CANDLES = 'singletrader_candles_cache_v1';
const CACHE_KEY_TICKER = 'singletrader_ticker_cache_v1';

const BINANCE_REST = [
  'https://api.binance.com',
  'https://data-api.binance.vision',
];

const WS_TICKER = 'wss://stream.binance.com:9443/ws/btcusdt@ticker';
const WS_KLINE = (interval: string) =>
  `wss://stream.binance.com:9443/ws/btcusdt@kline_${interval}`;

async function fetchBinance(path: string): Promise<Response | null> {
  for (const base of BINANCE_REST) {
    try {
      const res = await fetch(`${base}${path}`, { cache: 'no-store' });
      if (res.ok) return res;
    } catch {
      /* try next host */
    }
  }
  return null;
}

export async function fetchMarketCandles(
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' = '15m',
  twelveDataApiKey?: string
): Promise<{ candles: MarketCandle[]; source: string }> {
  if (twelveDataApiKey && twelveDataApiKey.trim().length > 5) {
    try {
      const intervalMap: Record<string, string> = {
        '1m': '1min',
        '5m': '5min',
        '15m': '15min',
        '1h': '1h',
        '4h': '4h',
      };
      const interval = intervalMap[timeframe] || '15min';
      const url = `https://api.twelvedata.com/time_series?symbol=BTC/USD&interval=${interval}&outputsize=100&apikey=${twelveDataApiKey.trim()}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.values && Array.isArray(json.values)) {
          const candles: MarketCandle[] = json.values
            .map((v: any) => ({
              time: Math.floor(new Date(v.datetime).getTime() / 1000),
              open: parseFloat(v.open),
              high: parseFloat(v.high),
              low: parseFloat(v.low),
              close: parseFloat(v.close),
              volume: parseFloat(v.volume || '0') || 10,
            }))
            .reverse()
            .filter((c: MarketCandle) => !isNaN(c.close) && !isNaN(c.time));
          if (candles.length > 0) {
            localStorage.setItem(CACHE_KEY_CANDLES, JSON.stringify(candles));
            return { candles, source: 'Twelve Data' };
          }
        }
      }
    } catch (e) {
      console.warn('Twelve Data fallback', e);
    }
  }

  const res = await fetchBinance(
    `/api/v3/klines?symbol=BTCUSDT&interval=${timeframe}&limit=120`
  );
  if (res) {
    const rawData = await res.json();
    if (Array.isArray(rawData) && rawData.length > 0) {
      const candles: MarketCandle[] = rawData.map((item: any) => ({
        time: Math.floor(item[0] / 1000),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
      }));
      localStorage.setItem(CACHE_KEY_CANDLES, JSON.stringify(candles));
      return { candles, source: 'Binance REST + WS' };
    }
  }

  const cached = localStorage.getItem(CACHE_KEY_CANDLES);
  if (cached) {
    try {
      const candles = JSON.parse(cached);
      if (Array.isArray(candles) && candles.length > 0) {
        return { candles, source: 'Offline cache' };
      }
    } catch {
      /* ignore */
    }
  }

  throw new Error('Could not fetch market data.');
}

export async function fetchLiveTicker(twelveDataApiKey?: string): Promise<LiveTicker> {
  if (twelveDataApiKey && twelveDataApiKey.trim().length > 5) {
    try {
      const priceRes = await fetch(
        `https://api.twelvedata.com/price?symbol=BTC/USD&apikey=${twelveDataApiKey.trim()}`
      );
      if (priceRes.ok) {
        const json = await priceRes.json();
        if (json.price) {
          const ticker: LiveTicker = {
            symbol: 'BTC/USD',
            price: parseFloat(json.price),
            change24h: 0,
            high24h: parseFloat(json.price) * 1.02,
            low24h: parseFloat(json.price) * 0.98,
            volume24h: 0,
            timestamp: Date.now(),
            source: 'Twelve Data',
          };
          localStorage.setItem(CACHE_KEY_TICKER, JSON.stringify(ticker));
          return ticker;
        }
      }
    } catch {
      /* fallback */
    }
  }

  const res = await fetchBinance('/api/v3/ticker/24hr?symbol=BTCUSDT');
  if (res) {
    const d = await res.json();
    const ticker: LiveTicker = {
      symbol: 'BTC/USD',
      price: parseFloat(d.lastPrice),
      change24h: parseFloat(d.priceChangePercent),
      high24h: parseFloat(d.highPrice),
      low24h: parseFloat(d.lowPrice),
      volume24h: parseFloat(d.volume),
      timestamp: Date.now(),
      source: 'Binance live',
    };
    localStorage.setItem(CACHE_KEY_TICKER, JSON.stringify(ticker));
    return ticker;
  }

  const cached = localStorage.getItem(CACHE_KEY_TICKER);
  if (cached) {
    try {
      return { ...JSON.parse(cached), source: 'Cached ticker' };
    } catch {
      /* */
    }
  }

  return {
    symbol: 'BTC/USD',
    price: 0,
    change24h: 0,
    high24h: 0,
    low24h: 0,
    volume24h: 0,
    timestamp: Date.now(),
    source: 'Waiting for stream…',
  };
}

export function subscribeBinanceTicker(
  onTick: (t: LiveTicker) => void,
  onStatus?: (s: 'connecting' | 'live' | 'error' | 'closed') => void
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    onStatus?.('connecting');
    try {
      ws = new WebSocket(WS_TICKER);
    } catch {
      onStatus?.('error');
      schedule();
      return;
    }

    ws.onopen = () => {
      retry = 0;
      onStatus?.('live');
    };

    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string);
        const price = parseFloat(d.c);
        if (!price || Number.isNaN(price)) return;
        const ticker: LiveTicker = {
          symbol: 'BTC/USD',
          price,
          change24h: parseFloat(d.P) || 0,
          high24h: parseFloat(d.h) || price,
          low24h: parseFloat(d.l) || price,
          volume24h: parseFloat(d.v) || 0,
          timestamp: d.E || Date.now(),
          source: 'Binance WebSocket',
        };
        localStorage.setItem(CACHE_KEY_TICKER, JSON.stringify(ticker));
        onTick(ticker);
      } catch {
        /* ignore malformed */
      }
    };

    ws.onerror = () => onStatus?.('error');
    ws.onclose = () => {
      onStatus?.('closed');
      if (!closed) schedule();
    };
  };

  const schedule = () => {
    if (closed) return;
    const delay = Math.min(15_000, 800 * Math.pow(1.6, retry++));
    timer = setTimeout(connect, delay);
  };

  connect();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    try {
      ws?.close();
    } catch {
      /* */
    }
  };
}

export function subscribeBinanceKline(
  interval: '1m' | '5m' | '15m' | '1h' | '4h',
  onCandle: (c: MarketCandle, isFinal: boolean) => void,
  onStatus?: (s: 'connecting' | 'live' | 'error' | 'closed') => void
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    onStatus?.('connecting');
    try {
      ws = new WebSocket(WS_KLINE(interval));
    } catch {
      onStatus?.('error');
      schedule();
      return;
    }

    ws.onopen = () => {
      retry = 0;
      onStatus?.('live');
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        const k = msg.k;
        if (!k) return;
        const candle: MarketCandle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        };
        onCandle(candle, !!k.x);
      } catch {
        /* */
      }
    };

    ws.onerror = () => onStatus?.('error');
    ws.onclose = () => {
      onStatus?.('closed');
      if (!closed) schedule();
    };
  };

  const schedule = () => {
    if (closed) return;
    const delay = Math.min(15_000, 800 * Math.pow(1.6, retry++));
    timer = setTimeout(connect, delay);
  };

  connect();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    try {
      ws?.close();
    } catch {
      /* */
    }
  };
}
